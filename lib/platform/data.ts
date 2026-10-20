import { recordAudit } from '../audit';
import { sql } from '../db';
import { PlatformError } from './errors';

/**
 * An organization's own data, as exported: every table it owns (archived rows included, marked by
 * deleted_at). Platform-internal tables (the owner's notes, impersonation sessions, provisioning,
 * leads) stay out.
 */
const EXPORT_TABLES = [
  'users', 'technicians', 'services', 'work_hours', 'schedule', 'payroll', 'discounts', 'financial_entries',
  'library_documents', 'organization_settings', 'technician_visibility_settings', 'porto_config', 'porto_sync_log',
  'whatsapp_config', 'whatsapp_messages', 'subscriptions', 'billing_charges', 'ai_credit_ledger', 'bug_reports', 'audit_events',
  'parts', 'part_images', 'part_transfers', 'part_sales', 'part_sale_items', 'part_inventories', 'part_inventory_items', 'part_debts',
  'part_movements', 'part_account_entries', 'parts_settings', 'mercadopago_accounts',
] as const;

/** Secrets never leave the database, not even in the organization's own export. */
const SECRET_COLUMNS = new Set(['password_hash', 'encrypted_password', 'access_token_enc', 'refresh_token_enc']);

export async function exportOrganizationData(organizationId: string, actor: { id: string; role: string; impersonationId?: string | null }) {
  const organization = (await sql`SELECT * FROM organizations WHERE id = ${organizationId}`)[0];
  if (!organization) throw new PlatformError('Organização não encontrada.', 404);

  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of EXPORT_TABLES) {
    const rows = await sql.query(`SELECT * FROM ${table} WHERE organization_id = $1`, [organizationId]);
    tables[table] = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !SECRET_COLUMNS.has(column))));
  }

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    impersonationId: actor.impersonationId ?? null,
    action: 'data.exported',
    targetType: 'organization',
    targetId: organizationId,
    details: { rows: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])) },
  });

  return {
    format: 'nextrotta-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    organization,
    tables,
  };
}

/** Tables with a trash (soft delete) and how to describe one of their rows. */
const TRASH_TABLES: Record<string, { label: string; summary: string; technician: boolean }> = {
  technicians: { label: 'Técnicos', summary: `concat_ws(' · ', t.name, t.email)`, technician: false },
  users: { label: 'Usuários', summary: `concat_ws(' · ', t.name, t.email)`, technician: false },
  services: { label: 'Ordens de serviço', summary: `concat_ws(' · ', t.order_code, t.service_type, to_char(t.date_performed, 'DD/MM/YYYY'), 'R$ ' || t.value)`, technician: true },
  work_hours: { label: 'Horas', summary: `concat_ws(' · ', to_char(t.date, 'DD/MM/YYYY'), t.hours_worked || ' h')`, technician: true },
  schedule: { label: 'Escala', summary: `concat_ws(' · ', to_char(t.date, 'DD/MM/YYYY'), t.status::text)`, technician: true },
  payroll: { label: 'Folhas', summary: `concat_ws(' · ', 'Competência ' || t.competence_month, t.status)`, technician: true },
  discounts: { label: 'Descontos', summary: `concat_ws(' · ', t.type, t.competence_month, 'R$ ' || t.amount)`, technician: true },
  financial_entries: { label: 'Lançamentos financeiros', summary: `concat_ws(' · ', t.description, 'R$ ' || t.amount, to_char(t.due_date, 'DD/MM/YYYY'))`, technician: false },
  library_documents: { label: 'Documentos', summary: `concat_ws(' · ', t.title, t.file_name)`, technician: false },
};

/** Everything archived in the organization, newest first. */
export async function listTrash(organizationId: string) {
  const parts = Object.entries(TRASH_TABLES).map(
    ([table, config]) => `
      SELECT '${table}' AS table_name, t.id::text AS id, ${config.summary} AS summary,
             ${config.technician ? 'tech.name' : 'NULL::text'} AS technician_name, t.deleted_at, u.name AS deleted_by_name
      FROM ${table} t
      ${config.technician ? 'LEFT JOIN technicians tech ON tech.id = t.technician_id' : ''}
      LEFT JOIN users u ON u.id = t.deleted_by
      WHERE t.organization_id = $1 AND t.deleted_at IS NOT NULL`,
  );
  const rows = await sql.query(`${parts.join(' UNION ALL ')} ORDER BY deleted_at DESC LIMIT 500`, [organizationId]);
  return rows.map((row) => ({
    id: `${row.table_name}:${row.id}`,
    table: String(row.table_name),
    tableLabel: TRASH_TABLES[String(row.table_name)].label,
    recordId: String(row.id),
    summary: String(row.summary ?? ''),
    technicianName: (row.technician_name as string | null) ?? null,
    deletedAt: new Date(row.deleted_at).toISOString(),
    deletedByName: (row.deleted_by_name as string | null) ?? null,
  }));
}

/** Brings an archived row back. */
export async function restoreFromTrash(
  organizationId: string,
  table: unknown,
  recordId: unknown,
  actor: { id: string; role: string; impersonationId?: string | null },
) {
  if (typeof table !== 'string' || !(table in TRASH_TABLES)) throw new PlatformError('Tipo de registro inválido.');
  if (typeof recordId !== 'string' || !recordId) throw new PlatformError('Registro inválido.');

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await sql.query(
      `UPDATE ${table} SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
       WHERE organization_id = $1 AND id::text = $2 AND deleted_at IS NOT NULL
       RETURNING id`,
      [organizationId, recordId],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new PlatformError('Já existe um registro ativo igual (por exemplo, o mesmo e-mail). Resolva o conflito antes de restaurar.', 409);
    }
    throw error;
  }
  if (!rows[0]) throw new PlatformError('Registro não encontrado na lixeira.', 404);

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    impersonationId: actor.impersonationId ?? null,
    action: 'data.restored',
    targetType: table,
    targetId: recordId,
    details: { table: TRASH_TABLES[table].label },
  });
}
