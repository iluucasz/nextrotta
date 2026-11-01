import { recordAudit } from '../audit';
import { sql } from '../db';
import { BackupError, createBackup, getBackup, loadBackupFile } from './service';
import { buildRestoreStatements } from './rules';
import { RESTORE_LABELS, RESTORE_TABLES } from './tables';

export type RestoreActor = { id: string; role: string; impersonationId?: string | null };

export type RestoreResult = {
  backupId: string;
  backupCreatedAt: string;
  /** The copy of the state right before the restore, to undo it. */
  safetyBackupId: string | null;
  /** By table: rows put back from the backup, and rows that did not exist then and were archived now. */
  tables: Array<{ table: string; label: string; restored: number; archived: number }>;
};

/**
 * Puts the organization back as it was in a backup. A copy of the present is made first (so the restore can be undone);
 * then, in ONE transaction: what the backup does not have is archived (never erased) and what it has is written back.
 * Either everything is restored or nothing changes. Billing, accounts, credits, integrations and Venda de Peças stay as they are.
 */
export async function restoreBackup(organizationId: string, backupId: string, actor: RestoreActor): Promise<RestoreResult> {
  const backup = await getBackup(organizationId, backupId);
  if (!backup) throw new BackupError('Backup não encontrado.', 404);
  if (backup.status !== 'completed' || !backup.storageUrl) throw new BackupError('Este backup não está disponível para restaurar.', 409);

  const file = await loadBackupFile(backup.storageUrl);
  if (file.organization.id !== organizationId) throw new BackupError('Este backup é de outra empresa.', 403);

  // Safety first: the present is saved before anything changes. If that fails, nothing is touched.
  const safety = await createBackup(organizationId, 'before_restore', actor.id);

  const columnRows = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ANY(${RESTORE_TABLES.map((entry) => entry.table)})
  `;
  const columns: Record<string, string[]> = {};
  for (const row of columnRows) (columns[String(row.table_name)] ??= []).push(String(row.column_name));

  const statements = buildRestoreStatements({ organizationId, actorId: actor.id, tables: file.tables, columns });

  let results: unknown[];
  try {
    results = await sql.transaction([
      // one restore at a time per organization
      sql`SELECT pg_advisory_xact_lock(hashtext(${`backup-restore:${organizationId}`}))`,
      ...statements.map((statement) => sql.query(statement.text, statement.params)),
    ]);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') throw new BackupError('A restauração parou porque um dado do backup conflita com outro que existe hoje (por exemplo, o mesmo e-mail). Nada foi alterado.', 409);
    throw error;
  }

  const summary = new Map<string, { restored: number; archived: number }>();
  statements.forEach((statement, index) => {
    const rows = ((results[index + 1] as Array<Record<string, unknown>>) ?? []);
    const entry = summary.get(statement.table) ?? { restored: 0, archived: 0 };
    if (statement.step === 'upsert') entry.restored += rows.length;
    else if (statement.archivesAll && statement.keys) {
      // Everything was archived first so nothing could collide; only what the backup does not have stays archived.
      const inBackup = new Set((file.tables[statement.table] ?? []).map((row) => statement.keys!.map((key) => String(row[key])).join('|')));
      entry.archived += rows.filter((row) => !inBackup.has(statement.keys!.map((key) => String(row[key])).join('|'))).length;
    } else entry.archived += rows.length;
    summary.set(statement.table, entry);
  });
  const tables = RESTORE_TABLES.filter((entry) => summary.has(entry.table)).map((entry) => ({
    table: entry.table,
    label: RESTORE_LABELS[entry.table] ?? entry.table,
    ...summary.get(entry.table)!,
  }));

  await sql`
    UPDATE organization_backups
    SET restored_at = NOW(), restored_by = ${actor.id}, restore_summary = ${JSON.stringify({ tables, safetyBackupId: safety?.id ?? null })}::jsonb
    WHERE id = ${backupId} AND organization_id = ${organizationId}
  `;
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    impersonationId: actor.impersonationId ?? null,
    action: 'backup.restored',
    targetType: 'organization_backup',
    targetId: backupId,
    details: { backupCreatedAt: backup.createdAt, safetyBackupId: safety?.id ?? null, tables },
  });

  return { backupId, backupCreatedAt: backup.createdAt, safetyBackupId: safety?.id ?? null, tables };
}
