import { sql } from '../db';
import { isPlatformRole } from '../platform-access';
import { isUuid, PlatformError } from '../platform/errors';

/** The people a case can be given to: the active people of the team (admins and attendants), by name only. */
export async function listAssignees() {
  const rows = await sql`
    SELECT id, name, role FROM users
    WHERE organization_id IS NULL AND role IN ('platform_owner', 'platform_support') AND status = 'active' AND deleted_at IS NULL
    ORDER BY name
  `;
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.role) }));
}

/** An active person of the team, or the reason a case cannot be given to them. */
export async function assignee(userId: string): Promise<{ id: string; name: string }> {
  if (!isUuid(userId)) throw new PlatformError('Responsável inválido.');
  const rows = await sql`SELECT id, name, role, status FROM users WHERE id = ${userId} AND organization_id IS NULL AND deleted_at IS NULL`;
  const row = rows[0];
  if (!row || !isPlatformRole(row.role) || row.status !== 'active') throw new PlatformError('Escolha uma pessoa ativa da equipe como responsável.');
  return { id: String(row.id), name: String(row.name) };
}
