import { sql } from '../db';
import { previewCounts } from './rules';
import { BackupError, getBackup, loadBackupFile } from './service';
import { RESTORE_LABELS, RESTORE_TABLES } from './tables';

export type RestorePreview = {
  backupCreatedAt: string;
  /** Whole days between the backup and now. */
  daysBack: number;
  tables: Array<{ table: string; label: string; inBackup: number; willArchive: number }>;
};

/**
 * What restoring this backup would change right now, counted and not done: for each table that comes back, the records
 * that stay as they were and the ones made after the backup (or archived in it) that would be archived. Read only.
 */
export async function previewRestore(organizationId: string, backupId: string): Promise<RestorePreview> {
  const backup = await getBackup(organizationId, backupId);
  if (!backup) throw new BackupError('Backup não encontrado.', 404);
  if (backup.status !== 'completed' || !backup.storageUrl) throw new BackupError('Este backup não está disponível.', 409);

  const file = await loadBackupFile(backup.storageUrl);
  if (file.organization.id !== organizationId) throw new BackupError('Este backup é de outra empresa.', 403);

  const tables: RestorePreview['tables'] = [];
  for (const entry of RESTORE_TABLES) {
    // Only the tables identified by id carry records worth counting (the settings are just rewritten).
    if (entry.keys.length !== 1 || entry.keys[0] !== 'id' || !entry.soft) continue;
    const rows = await sql.query(`SELECT id FROM ${entry.table} WHERE organization_id = $1 AND deleted_at IS NULL`, [organizationId]);
    const counts = previewCounts(
      rows.map((row) => String(row.id)),
      file.tables[entry.table] ?? [],
    );
    tables.push({ table: entry.table, label: RESTORE_LABELS[entry.table] ?? entry.table, ...counts });
  }

  return { backupCreatedAt: backup.createdAt, daysBack: Math.max(0, Math.floor((Date.now() - new Date(backup.createdAt).getTime()) / 86_400_000)), tables };
}
