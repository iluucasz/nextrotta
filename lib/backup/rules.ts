// The pure rules of the backups: which copies have expired, and the statements that put a backup back. Dependency-free
// (read by the tests); the database work is in service.ts.

import { RESTORE_TABLES, type RestoreTable } from './tables';

// ---------------------------------------------------------------- retention

export type CopyInfo = { id: string; status: string; createdAt: Date };

/**
 * Which completed copies go: older than the retention, except the most recent completed one, which always stays
 * (an organization is never left without a backup). `null` retention = keep them all.
 */
export function expiredCopyIds(copies: CopyInfo[], retentionDays: number | null, now: Date): string[] {
  if (retentionDays === null) return [];
  const completed = copies.filter((copy) => copy.status === 'completed').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (completed.length <= 1) return [];
  const limit = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return completed.slice(1).filter((copy) => copy.createdAt.getTime() < limit).map((copy) => copy.id);
}

// ---------------------------------------------------------------- restore

export type Statement = {
  text: string;
  params: unknown[];
  table: string;
  step: 'archive' | 'upsert' | 'zero';
  /** The archive step hit every row (so it returns the keys, to tell which ones the backup did not have). */
  archivesAll?: boolean;
  keys?: string[];
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const identifier = (name: string) => {
  if (!IDENTIFIER.test(name)) throw new Error(`Nome inválido na restauração: ${name}`);
  return name;
};

/**
 * The statements of a restore, in order, for one organization. Nothing is deleted: what the backup does not have is
 * archived (deleted_at), what it has is written back over what is there (including its deleted_at, so an OS that was
 * archived at that time is archived again).
 *
 * `tables` is the backup's rows by table, `columns` the columns each table has today (a column added after the
 * backup keeps its current value, a column removed since is ignored).
 */
export function buildRestoreStatements(input: {
  organizationId: string;
  actorId: string;
  tables: Record<string, Array<Record<string, unknown>>>;
  columns: Record<string, string[]>;
  plan?: RestoreTable[];
}): Statement[] {
  const statements: Statement[] = [];

  for (const config of input.plan ?? RESTORE_TABLES) {
    const table = identifier(config.table);
    const rows = input.tables[config.table] ?? [];
    const existing = new Set(input.columns[config.table] ?? []);
    if (!existing.size) continue;

    // A backup that holds a row of another organization is not ours: stop before touching anything.
    for (const row of rows) {
      if (String(row.organization_id) !== input.organizationId) throw new Error(`O backup tem registros de outra empresa em ${config.table}.`);
    }

    const json = JSON.stringify(rows);
    const keys = config.keys.map(identifier);
    const sameKey = keys.map((key) => `s.${key} = ${table}.${key}`).join(' AND ');

    if (config.soft) {
      // Each statement carries only the parameters it uses (the server refuses a bind with extras).
      const params: unknown[] = [input.organizationId];
      const addParam = (value: unknown, cast: string) => {
        params.push(value);
        return `$${params.length}::${cast}`;
      };
      const archivedBy = existing.has('deleted_by') ? `, deleted_by = ${addParam(input.actorId, 'uuid')}` : '';
      const notInBackup = config.archiveAllFirst ? '' : `AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::${table}, ${addParam(json, 'jsonb')}) s WHERE ${sameKey})`;
      statements.push({
        step: 'archive',
        table: config.table,
        text: `UPDATE ${table} SET deleted_at = NOW()${archivedBy}
               WHERE organization_id = $1::uuid AND deleted_at IS NULL ${notInBackup}
               RETURNING ${config.archiveAllFirst ? keys.join(', ') : '1 AS archived'}`,
        params,
        archivesAll: Boolean(config.archiveAllFirst),
        keys,
      });
    } else if (config.zeroColumn) {
      const zero = identifier(config.zeroColumn);
      statements.push({
        step: 'zero',
        table: config.table,
        text: `UPDATE ${table} SET ${zero} = 0${existing.has('updated_at') ? ', updated_at = NOW()' : ''}
               WHERE organization_id = $1::uuid AND ${zero} <> 0
               AND NOT EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::${table}, $2::jsonb) s WHERE ${sameKey})
               RETURNING 1 AS archived`,
        params: [input.organizationId, json],
      });
    }

    if (!rows.length) continue;
    const present = new Set<string>();
    for (const row of rows) for (const column of Object.keys(row)) present.add(column);
    const columns = [...present].filter((column) => existing.has(column)).map(identifier);
    for (const key of keys) if (!columns.includes(key)) throw new Error(`O backup não tem a coluna ${key} de ${config.table}.`);
    if (!columns.includes('organization_id')) columns.push('organization_id');

    const list = columns.join(', ');
    const updates = columns.filter((column) => !keys.includes(column) && column !== 'organization_id').map((column) => `${column} = EXCLUDED.${column}`);
    statements.push({
      step: 'upsert',
      table: config.table,
      text: `INSERT INTO ${table} (${list})
             SELECT ${columns.map((column) => `s.${column}`).join(', ')} FROM jsonb_populate_recordset(NULL::${table}, $2::jsonb) s
             WHERE s.organization_id = $1::uuid
             ON CONFLICT (${keys.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')} WHERE ${table}.organization_id = EXCLUDED.organization_id` : 'NOTHING'}
             RETURNING 1 AS written`,
      params: [input.organizationId, json],
    });
  }

  return statements;
}

// ---------------------------------------------------------------- preview

/**
 * What restoring a backup would do to one table, before doing it: how many rows come back as they were, and how many rows
 * that exist today would be archived (they were made after the backup, or were archived in it). Rows are matched by id.
 */
export function previewCounts(currentActiveIds: string[], backupRows: Array<Record<string, unknown>>): { inBackup: number; willArchive: number } {
  const activeInBackup = new Set(backupRows.filter((row) => !row.deleted_at).map((row) => String(row.id)));
  return { inBackup: activeInBackup.size, willArchive: currentActiveIds.filter((id) => !activeInBackup.has(id)).length };
}
