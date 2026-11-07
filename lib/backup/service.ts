import { gunzipSync, gzipSync } from 'node:zlib';
import { sql } from '../db';
import { notifyPlatform } from '../platform/notice-alerts';
import { resolveNotices } from '../platform/notices';
import { brasiliaDay, nextBackupTime } from './dates';
import { expiredCopyIds } from './rules';
import { backupStorageConfigured, readBackupFile, removeBackupFile, saveBackupFile } from './storage';
import { BACKUP_SECRET_COLUMNS, BACKUP_TABLES, backupRowFilter, type BackupFile, type BackupKind, type BackupStatus } from './tables';

// Making, listing and cleaning the backups of an organization. The worker runs the nightly job; the app calls the same
// functions for "Fazer backup agora". Restoring is in restore.ts.

export class BackupError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type BackupRecord = {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
  backupDate: string;
  createdAt: string;
  completedAt: string | null;
  sizeBytes: number;
  rowCounts: Record<string, number>;
  error: string | null;
  restoredAt: string | null;
};

/** Without a plan the organization still gets backups, kept for this many days. */
export const DEFAULT_RETENTION_DAYS = 90;

/** Statuses that keep getting a nightly backup: a suspended or canceled organization does not change, so it stops. */
const BACKED_UP_STATUSES = ['active', 'past_due'];

function toRecord(row: Record<string, unknown>): BackupRecord {
  const date = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);
  return {
    id: String(row.id),
    kind: row.kind as BackupKind,
    status: row.status as BackupStatus,
    backupDate: String(row.backup_date_text ?? '').slice(0, 10),
    createdAt: date(row.created_at) as string,
    completedAt: date(row.completed_at),
    sizeBytes: Number(row.size_bytes ?? 0),
    rowCounts: (row.row_counts as Record<string, number>) ?? {},
    error: (row.error as string | null) ?? null,
    restoredAt: date(row.restored_at),
  };
}

const COLUMNS = `id, kind, status, TO_CHAR(backup_date, 'YYYY-MM-DD') AS backup_date_text, created_at, completed_at, size_bytes, row_counts, error, restored_at`;

/** The days a copy is kept: the plan's retention, null for "unlimited". */
export async function retentionDaysFor(organizationId: string): Promise<number | null> {
  const rows = await sql`
    SELECT p.backup_retention_days
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id
    WHERE s.organization_id = ${organizationId}
  `;
  if (!rows[0]) return DEFAULT_RETENTION_DAYS;
  const days = rows[0].backup_retention_days;
  return days === null || days === undefined ? null : Number(days);
}

/** The whole organization as one consistent picture (one read-only transaction), without secrets. */
export async function buildBackupFile(organizationId: string): Promise<{ file: BackupFile; rowCounts: Record<string, number> }> {
  const organization = (await sql`SELECT id, name, slug FROM organizations WHERE id = ${organizationId}`)[0];
  if (!organization) throw new BackupError('Organização não encontrada.', 404);

  const results = await sql.transaction(
    BACKUP_TABLES.map((table) =>
      sql.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t) - $2::text[]), '[]'::jsonb) AS rows FROM ${table} t WHERE t.organization_id = $1${backupRowFilter(table, 't') ? ` AND ${backupRowFilter(table, 't')}` : ''}`, [
        organizationId,
        [...BACKUP_SECRET_COLUMNS],
      ]),
    ),
    { isolationLevel: 'RepeatableRead', readOnly: true },
  );

  const tables: BackupFile['tables'] = {};
  const rowCounts: Record<string, number> = {};
  BACKUP_TABLES.forEach((table, index) => {
    const rows = (results[index] as Array<{ rows: Array<Record<string, unknown>> }>)[0]?.rows ?? [];
    tables[table] = rows;
    rowCounts[table] = rows.length;
  });

  return {
    file: {
      format: 'nextrotta-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      organization: { id: String(organization.id), name: String(organization.name), slug: String(organization.slug) },
      tables,
    },
    rowCounts,
  };
}

/**
 * Makes one backup and registers it. A nightly one that already exists for today is not made twice (returns null).
 * On failure the row is kept as 'failed' with the reason, and the error goes up.
 */
export async function createBackup(organizationId: string, kind: BackupKind, createdBy: string | null): Promise<BackupRecord | null> {
  if (!backupStorageConfigured()) throw new BackupError('O armazenamento dos backups não está configurado.', 503);

  if (kind !== 'daily') {
    const recent = await sql`
      SELECT 1 FROM organization_backups
      WHERE organization_id = ${organizationId} AND kind IN ('manual', 'before_restore') AND status IN ('running', 'completed')
        AND created_at > NOW() - INTERVAL '2 minutes'
      LIMIT 1
    `;
    if (recent[0] && kind === 'manual') throw new BackupError('Já foi feito um backup agora há pouco. Aguarde dois minutos para fazer outro.', 429);
  }

  const today = brasiliaDay(new Date());
  const inserted =
    kind === 'daily'
      ? await sql`
          INSERT INTO organization_backups (organization_id, kind, backup_date, created_by)
          VALUES (${organizationId}, 'daily', ${today}, ${createdBy})
          ON CONFLICT (organization_id, backup_date) WHERE kind = 'daily' AND status IN ('running', 'completed') DO NOTHING
          RETURNING id
        `
      : await sql`
          INSERT INTO organization_backups (organization_id, kind, backup_date, created_by)
          VALUES (${organizationId}, ${kind}, ${today}, ${createdBy})
          RETURNING id
        `;
  if (!inserted[0]) return null;
  const id = String(inserted[0].id);

  try {
    const { file, rowCounts } = await buildBackupFile(organizationId);
    const compressed = gzipSync(Buffer.from(JSON.stringify(file)));
    const stamp = file.createdAt.replace(/[:.]/g, '-');
    const url = await saveBackupFile(organizationId, `${stamp}-${kind}-${id}.json.gz`, compressed);
    const rows = await sql.query(
      `UPDATE organization_backups
       SET status = 'completed', completed_at = NOW(), storage_url = $1, size_bytes = $2, row_counts = $3::jsonb
       WHERE id::text = $4
       RETURNING ${COLUMNS}`,
      [url, compressed.length, JSON.stringify(rowCounts), id],
    );
    return toRecord(rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`UPDATE organization_backups SET status = 'failed', completed_at = NOW(), error = ${message.slice(0, 1000)} WHERE id = ${id}`;
    throw error;
  }
}

/**
 * The copy made right before a company is locked (the day before the grace period ends, and when it is suspended or
 * canceled), so what it can still download is as recent as possible. Never throws: a failing storage must not stop
 * the lock, the company then gets the latest copy it already has. Not made twice within 6 hours.
 */
export async function createClosingBackup(organizationId: string): Promise<BackupRecord | null> {
  try {
    if (!backupStorageConfigured()) {
      console.warn(`[backup] closing copy of ${organizationId} skipped: the storage is not configured here.`);
      return null;
    }
    const recent = await sql`
      SELECT 1 FROM organization_backups
      WHERE organization_id = ${organizationId} AND kind = 'closing' AND status IN ('running', 'completed')
        AND created_at > NOW() - INTERVAL '6 hours'
      LIMIT 1
    `;
    if (recent[0]) return null;
    return await createBackup(organizationId, 'closing', null);
  } catch (error) {
    console.error(`[backup] closing copy of ${organizationId} failed:`, error);
    return null;
  }
}

export type LastRestore = { backupCreatedAt: string; restoredAt: string; safetyBackupId: string };

/**
 * The newest restore that can still be undone: the copy of "before" is still there and has not been restored since.
 * (Undoing is restoring that copy, which makes its own copy of "before the undo", so it can be redone.)
 */
export async function getLastRestore(organizationId: string): Promise<LastRestore | null> {
  const rows = await sql`
    SELECT b.created_at AS backup_created_at, b.restored_at, s.id AS safety_id, s.status AS safety_status, s.restored_at AS safety_restored_at
    FROM organization_backups b
    LEFT JOIN organization_backups s ON s.id::text = b.restore_summary->>'safetyBackupId' AND s.organization_id = b.organization_id
    WHERE b.organization_id = ${organizationId} AND b.restored_at IS NOT NULL
    ORDER BY b.restored_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.safety_id || row.safety_status !== 'completed') return null;
  if (row.safety_restored_at && new Date(String(row.safety_restored_at)) > new Date(String(row.restored_at))) return null;
  return {
    backupCreatedAt: new Date(String(row.backup_created_at)).toISOString(),
    restoredAt: new Date(String(row.restored_at)).toISOString(),
    safetyBackupId: String(row.safety_id),
  };
}

/** The newest finished copy of any kind (what a locked company downloads). */
export async function getLastBackup(organizationId: string): Promise<BackupRecord | null> {
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM organization_backups WHERE organization_id = $1 AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [organizationId],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/** The copies the admin sees, newest first: finished ones and the one being made. */
export async function listBackups(organizationId: string): Promise<BackupRecord[]> {
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM organization_backups
     WHERE organization_id = $1 AND status IN ('completed', 'running')
     ORDER BY created_at DESC LIMIT 200`,
    [organizationId],
  );
  return rows.map(toRecord);
}

export async function getBackup(organizationId: string, backupId: string): Promise<(BackupRecord & { storageUrl: string | null }) | null> {
  const rows = await sql.query(`SELECT ${COLUMNS}, storage_url FROM organization_backups WHERE id::text = $1 AND organization_id = $2`, [backupId, organizationId]);
  return rows[0] ? { ...toRecord(rows[0]), storageUrl: (rows[0].storage_url as string | null) ?? null } : null;
}

/** The backup's content, read back from the storage. */
export async function loadBackupFile(storageUrl: string): Promise<BackupFile> {
  const raw = await readBackupFile(storageUrl);
  if (!raw) throw new BackupError('O arquivo deste backup não foi encontrado no armazenamento.', 404);
  const file = JSON.parse(gunzipSync(raw).toString('utf8')) as BackupFile;
  if (file.format !== 'nextrotta-backup' || file.version !== 1) throw new BackupError('Este arquivo não é um backup do NextRotta.', 422);
  return file;
}

/** The nightly job: a backup for every organization that is being used and has none yet today. Returns how many were made. */
export async function runDailyBackups(): Promise<{ made: number; failed: number }> {
  if (!backupStorageConfigured()) return { made: 0, failed: 0 };

  const today = brasiliaDay(new Date());
  const organizations = await sql`
    SELECT o.id FROM organizations o
    WHERE o.status = ANY(${BACKED_UP_STATUSES})
      AND NOT EXISTS (SELECT 1 FROM organization_backups b WHERE b.organization_id = o.id AND b.kind = 'daily' AND b.backup_date = ${today} AND b.status IN ('running', 'completed'))
      AND (SELECT COUNT(*) FROM organization_backups b WHERE b.organization_id = o.id AND b.kind = 'daily' AND b.backup_date = ${today} AND b.status = 'failed') < 3
    ORDER BY o.created_at
  `;

  let made = 0;
  let failed = 0;
  for (const organization of organizations) {
    try {
      if (await createBackup(String(organization.id), 'daily', null)) made += 1;
      await resolveNotices(`backup:fail:${organization.id}:`).catch(() => undefined);
    } catch (error) {
      failed += 1;
      console.error(`[backup] ${organization.id}:`, error);
      // Told at once (the platform check only notices after 36 hours without a copy).
      await notifyPlatform({
        organizationId: String(organization.id),
        category: 'backup',
        severity: 'warning',
        title: 'O backup diário da empresa falhou',
        body: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        href: `/plataforma/organizacoes/${organization.id}`,
        dedupeKey: `backup:fail:${organization.id}:${today}`,
      });
    }
  }
  return { made, failed };
}

/**
 * Removes the copies past their plan's retention, from the storage (the only hard deletion in the system) and marks them
 * 'expired'. The latest completed copy of an organization is never removed; a suspended or canceled one stops expiring.
 */
export async function cleanupExpiredBackups(now = new Date()): Promise<number> {
  const organizations = await sql`
    SELECT DISTINCT b.organization_id FROM organization_backups b
    JOIN organizations o ON o.id = b.organization_id
    WHERE b.status = 'completed' AND o.status = ANY(${BACKED_UP_STATUSES})
  `;

  let removed = 0;
  for (const { organization_id: organizationId } of organizations) {
    const retention = await retentionDaysFor(String(organizationId));
    const copies = await sql`
      SELECT id, status, created_at, storage_url FROM organization_backups WHERE organization_id = ${organizationId} AND status = 'completed'
    `;
    const expired = new Set(
      expiredCopyIds(
        copies.map((copy) => ({ id: String(copy.id), status: String(copy.status), createdAt: new Date(String(copy.created_at)) })),
        retention,
        now,
      ),
    );
    for (const copy of copies) {
      if (!expired.has(String(copy.id))) continue;
      try {
        if (copy.storage_url) await removeBackupFile(String(copy.storage_url));
        await sql`UPDATE organization_backups SET status = 'expired', expired_at = NOW(), storage_url = NULL WHERE id = ${copy.id}`;
        removed += 1;
      } catch (error) {
        console.error(`[backup] could not remove ${copy.id}:`, error);
      }
    }
  }
  return removed;
}

/** When the next nightly backup runs, for the screen. */
export function nextBackupAt(now = new Date()): string {
  return nextBackupTime(now).toISOString();
}
