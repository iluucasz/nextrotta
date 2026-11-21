// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { createGzip } from 'node:zlib';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { brasiliaDay } from '../backup/dates';
import { backupStorageConfigured, openBackupFile, removeBackupFile, savePlatformBackupFile } from '../backup/storage';
import { recordAudit } from '../audit';
import { sql } from '../db';
import {
  encryptBackup,
  expiredPlatformCopyIds,
  openPlatformBackup,
  PLATFORM_BACKUP_EXCLUDED_TABLES,
  PLATFORM_BACKUP_FORMAT,
  PLATFORM_BACKUP_RETENTION_DAYS,
  PLATFORM_BACKUP_VERSION,
  platformBackupKey,
} from './backup-format';
import { PlatformError } from './errors';
import { notifyPlatform } from './notice-alerts';
import { resolveNotices } from './notices';

/**
 * Backup of the whole platform: every table of the database (all companies, users, plans, billing, the site...), in one
 * file kept encrypted in the private storage. The worker makes one every night after the companies' own backups; the owner
 * can make one at any time. Restoring is a scripted operation (scripts/restore-platform-backup.cjs, docs/backups.md).
 */

export type PlatformBackupKind = 'daily' | 'manual';

export type PlatformBackupRecord = {
  id: string;
  kind: PlatformBackupKind;
  status: 'running' | 'completed' | 'failed' | 'expired';
  backupDate: string;
  createdAt: string;
  completedAt: string | null;
  sizeBytes: number;
  tableCount: number;
  rowCount: number;
  error: string | null;
};

const COLUMNS = `id, kind, status, TO_CHAR(backup_date, 'YYYY-MM-DD') AS backup_date_text, created_at, completed_at, size_bytes, table_counts, error`;

function toRecord(row: Record<string, unknown>): PlatformBackupRecord {
  const counts = (row.table_counts as Record<string, number>) ?? {};
  const date = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
  return {
    id: String(row.id),
    kind: row.kind as PlatformBackupKind,
    status: row.status as PlatformBackupRecord['status'],
    backupDate: String(row.backup_date_text ?? '').slice(0, 10),
    createdAt: date(row.created_at) as string,
    completedAt: date(row.completed_at),
    sizeBytes: Number(row.size_bytes ?? 0),
    tableCount: Object.keys(counts).length,
    rowCount: Object.values(counts).reduce((total, value) => total + Number(value), 0),
    error: (row.error as string | null) ?? null,
  };
}

/** Why a backup can't be made here right now, or null when it can. */
export function platformBackupBlocker(): string | null {
  if (!backupStorageConfigured()) return 'O armazenamento dos backups (BLOB_READ_WRITE_TOKEN) não está configurado neste ambiente.';
  try {
    if (!platformBackupKey()) return 'Falta a chave do backup (PLATFORM_BACKUP_KEY ou PORTO_CREDENTIALS_KEY) neste ambiente.';
  } catch (error) {
    return error instanceof Error ? error.message : 'Chave do backup inválida.';
  }
  return null;
}

function pool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  // Node 22 has a global WebSocket; the pooled driver needs it for a transaction that spans many statements.
  if (!neonConfig.webSocketConstructor && typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

const quote = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;
const CURSOR_BATCH = 2000;

/**
 * Reads every table of the public schema inside ONE read-only repeatable-read transaction (so the file is a consistent
 * picture across tables), streaming rows through gzip, then locks the result. Returns the file and each table's row count.
 */
export async function buildPlatformBackup(): Promise<{ file: Buffer; tableCounts: Record<string, number>; createdAt: string }> {
  const key = platformBackupKey();
  if (!key) throw new PlatformError('Falta a chave do backup neste ambiente.', 503);

  const connections = pool();
  const client = await connections.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const listed = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const tables = (listed.rows as Array<{ table_name: string }>)
      .map((row) => row.table_name)
      .filter((table) => !PLATFORM_BACKUP_EXCLUDED_TABLES.includes(table));

    const createdAt = new Date().toISOString();
    const gzip = createGzip({ level: 6 });
    const chunks: Buffer[] = [];
    gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      gzip.on('end', resolve);
      gzip.on('error', reject);
    });

    gzip.write(`${JSON.stringify({ format: PLATFORM_BACKUP_FORMAT, version: PLATFORM_BACKUP_VERSION, createdAt, tables })}\n`);
    const tableCounts: Record<string, number> = {};
    for (const table of tables) {
      let count = 0;
      await client.query(`DECLARE platform_backup_cursor NO SCROLL CURSOR FOR SELECT to_jsonb(t)::text AS r FROM public.${quote(table)} t`);
      for (;;) {
        const batch = await client.query(`FETCH ${CURSOR_BATCH} FROM platform_backup_cursor`);
        if (!batch.rows.length) break;
        let text = '';
        for (const row of batch.rows as Array<{ r: string }>) text += `{"t":${JSON.stringify(table)},"r":${row.r}}\n`;
        gzip.write(text);
        count += batch.rows.length;
      }
      await client.query('CLOSE platform_backup_cursor');
      tableCounts[table] = count;
    }
    await client.query('COMMIT');
    gzip.end(`${JSON.stringify({ end: true, counts: tableCounts })}\n`);
    await finished;
    return { file: encryptBackup(Buffer.concat(chunks), key), tableCounts, createdAt };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await connections.end();
  }
}

/**
 * Makes one copy and registers it. A nightly one that already exists for today is not made twice (returns null). The copy is
 * opened again from memory and checked against its own trailer before being stored, so a bad file never counts as a backup.
 */
export async function createPlatformBackup(kind: PlatformBackupKind, createdBy: string | null): Promise<PlatformBackupRecord | null> {
  const blocker = platformBackupBlocker();
  if (blocker) throw new PlatformError(blocker, 503);

  if (kind === 'manual') {
    const recent = await sql`
      SELECT 1 FROM platform_backups
      WHERE kind = 'manual' AND status IN ('running', 'completed') AND created_at > NOW() - INTERVAL '2 minutes' LIMIT 1
    `;
    if (recent[0]) throw new PlatformError('Já foi feito um backup agora há pouco. Aguarde dois minutos para fazer outro.', 429);
  }

  const today = brasiliaDay(new Date());
  const inserted =
    kind === 'daily'
      ? await sql`
          INSERT INTO platform_backups (kind, backup_date, created_by) VALUES ('daily', ${today}, ${createdBy})
          ON CONFLICT (backup_date) WHERE kind = 'daily' AND status IN ('running', 'completed') DO NOTHING
          RETURNING id
        `
      : await sql`INSERT INTO platform_backups (kind, backup_date, created_by) VALUES ('manual', ${today}, ${createdBy}) RETURNING id`;
  if (!inserted[0]) return null;
  const id = String(inserted[0].id);

  try {
    const { file, tableCounts, createdAt } = await buildPlatformBackup();
    const key = platformBackupKey()!;
    const check = openPlatformBackup(file, key);
    for (const [table, count] of Object.entries(tableCounts)) {
      if (check.counts[table] !== count) throw new Error(`A conferência do arquivo falhou na tabela ${table}.`);
    }
    const url = await savePlatformBackupFile(`${createdAt.replace(/[:.]/g, '-')}-${kind}-${id}.nrpb`, file);
    const rows = await sql.query(
      `UPDATE platform_backups SET status = 'completed', completed_at = NOW(), storage_url = $1, size_bytes = $2, table_counts = $3::jsonb
       WHERE id::text = $4 RETURNING ${COLUMNS}`,
      [url, file.length, JSON.stringify(tableCounts), id],
    );
    return toRecord(rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`UPDATE platform_backups SET status = 'failed', completed_at = NOW(), error = ${message.slice(0, 1000)} WHERE id = ${id}`;
    throw error;
  }
}

/** The owner's "Fazer backup agora": same copy, with an audit record. */
export async function createManualPlatformBackup(ownerId: string) {
  const backup = await createPlatformBackup('manual', ownerId);
  await recordAudit({
    organizationId: null,
    actorId: ownerId,
    actorRole: 'platform_owner',
    action: 'platform_backup.created',
    targetType: 'platform_backup',
    targetId: backup?.id ?? null,
    details: backup ? { sizeBytes: backup.sizeBytes, tables: backup.tableCount, rows: backup.rowCount } : null,
  });
  return backup;
}

/** The nightly job. Returns true when a copy was made (false when today's already existed). A failure also warns the owner. */
export async function runDailyPlatformBackup(): Promise<boolean> {
  const today = brasiliaDay(new Date());
  const failures = await sql`SELECT COUNT(*)::int AS total FROM platform_backups WHERE kind = 'daily' AND backup_date = ${today} AND status = 'failed'`;
  if (Number(failures[0].total) >= 3) return false;
  try {
    const made = Boolean(await createPlatformBackup('daily', null));
    if (made) await resolveNotices('backup:platform:').catch(() => undefined);
    return made;
  } catch (error) {
    await notifyPlatform({
      organizationId: null,
      category: 'backup',
      severity: 'critical',
      title: 'O backup da plataforma inteira falhou',
      body: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      href: '/plataforma/operacao',
      dedupeKey: `backup:platform:${today}`,
    });
    throw error;
  }
}

/** Removes the copies past the retention from the storage (a backup copy is the only thing the system erases for good). */
export async function cleanupExpiredPlatformBackups(now = new Date()): Promise<number> {
  const copies = await sql`SELECT id, created_at, storage_url FROM platform_backups WHERE status = 'completed'`;
  const expired = new Set(
    expiredPlatformCopyIds(
      copies.map((copy) => ({ id: String(copy.id), createdAt: new Date(String(copy.created_at)) })),
      PLATFORM_BACKUP_RETENTION_DAYS,
      now,
    ),
  );
  let removed = 0;
  for (const copy of copies) {
    if (!expired.has(String(copy.id))) continue;
    try {
      if (copy.storage_url) await removeBackupFile(String(copy.storage_url));
      await sql`UPDATE platform_backups SET status = 'expired', expired_at = NOW(), storage_url = NULL WHERE id = ${copy.id}`;
      removed += 1;
    } catch (error) {
      console.error(`[platform-backup] could not remove ${copy.id}:`, error);
    }
  }
  return removed;
}

/** What the owner's panel shows: the copies (newest first) and what keeps a new one from being made here. */
export async function getPlatformBackups() {
  const rows = await sql.query(`SELECT ${COLUMNS} FROM platform_backups WHERE status IN ('completed', 'running', 'failed') ORDER BY created_at DESC LIMIT 60`);
  const records = rows.map(toRecord);
  return {
    backups: records,
    last: records.find((backup) => backup.status === 'completed') ?? null,
    retentionDays: PLATFORM_BACKUP_RETENTION_DAYS,
    blocker: platformBackupBlocker(),
  };
}

/** The encrypted file for the owner to download and keep elsewhere. */
export async function openPlatformBackupDownload(id: string) {
  const rows = await sql.query(`SELECT ${COLUMNS}, storage_url FROM platform_backups WHERE id::text = $1`, [id]);
  const row = rows[0];
  if (!row || row.status !== 'completed' || !row.storage_url) throw new PlatformError('Backup não encontrado.', 404);
  const stream = await openBackupFile(String(row.storage_url));
  if (!stream) throw new PlatformError('O arquivo deste backup não foi encontrado no armazenamento.', 404);
  return { record: toRecord(row), stream };
}
