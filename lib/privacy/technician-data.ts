import { randomUUID } from 'node:crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { isUuid, PlatformError } from '../platform/errors';

// What a company (the controller) needs to answer a technician who exercises their LGPD rights: a copy of the personal
// data held about them, and anonymization. Anonymization removes who the person is (name, contact, QRA, access) and keeps
// the figures the company must retain (hours, services, payroll), now tied to an anonymous record. Nothing is deleted.

export const ANONYMIZED_NAME = 'Titular anonimizado';

async function requireTechnician(organizationId: string, technicianId: string) {
  if (!isUuid(technicianId)) throw new PlatformError('Técnico não encontrado.', 404);
  const rows = await sql`
    SELECT id, user_id, name FROM technicians WHERE id = ${technicianId} AND organization_id = ${organizationId}
  `;
  if (!rows[0]) throw new PlatformError('Técnico não encontrado.', 404);
  return rows[0];
}

/** A copy of the personal data kept about one technician, as a JSON document (never includes the password hash). */
export async function exportTechnicianData(organizationId: string, technicianId: string) {
  const technician = await requireTechnician(organizationId, technicianId);
  const [record, access, hours, services, schedule, payroll, discounts] = await Promise.all([
    sql`SELECT to_jsonb(t) AS row FROM technicians t WHERE t.id = ${technicianId} AND t.organization_id = ${organizationId}`,
    technician.user_id
      ? sql`SELECT email, name, status, last_login_at, created_at FROM users WHERE id = ${technician.user_id} AND organization_id = ${organizationId}`
      : Promise.resolve([]),
    sql`SELECT to_jsonb(r) AS row FROM work_hours r WHERE r.technician_id = ${technicianId} AND r.organization_id = ${organizationId} ORDER BY 1`,
    sql`SELECT to_jsonb(r) AS row FROM services r WHERE r.technician_id = ${technicianId} AND r.organization_id = ${organizationId} ORDER BY 1`,
    sql`SELECT to_jsonb(r) AS row FROM schedule r WHERE r.technician_id = ${technicianId} AND r.organization_id = ${organizationId} ORDER BY 1`,
    sql`SELECT to_jsonb(r) AS row FROM payroll r WHERE r.technician_id = ${technicianId} AND r.organization_id = ${organizationId} ORDER BY 1`,
    sql`SELECT to_jsonb(r) AS row FROM discounts r WHERE r.technician_id = ${technicianId} AND r.organization_id = ${organizationId} ORDER BY 1`,
  ]);
  const rows = (list: Array<Record<string, unknown>>) => list.map((item) => item.row);
  return {
    generatedAt: new Date().toISOString(),
    technician: record[0]?.row ?? null,
    access: access[0] ?? null,
    workHours: rows(hours),
    services: rows(services),
    schedule: rows(schedule),
    payroll: rows(payroll),
    discounts: rows(discounts),
  };
}

/** Removes who the person is from the technician and from their login; keeps the retained figures. */
export async function anonymizeTechnician(organizationId: string, technicianId: string, actor: { id: string; role: string }) {
  const technician = await requireTechnician(organizationId, technicianId);
  if (String(technician.name) === ANONYMIZED_NAME) throw new PlatformError('Este cadastro já foi anonimizado.', 409);

  const statements = [
    sql`
      UPDATE technicians
      SET name = ${ANONYMIZED_NAME}, email = NULL, phone = NULL, qra = NULL, porto_name_hint = NULL, status = 'inactive', updated_at = NOW()
      WHERE id = ${technicianId} AND organization_id = ${organizationId}
    `,
  ];
  if (technician.user_id) {
    // An unusable e-mail and password hash: the login can never be used again and the address is free for reuse.
    statements.push(sql`
      UPDATE users
      SET name = ${ANONYMIZED_NAME}, email = ${`anonimizado-${randomUUID()}@anonimizado.invalid`}, password_hash = '!', status = 'inactive', updated_at = NOW()
      WHERE id = ${technician.user_id} AND organization_id = ${organizationId}
    `);
  }
  await sql.transaction(statements);

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    action: 'technician.anonymized',
    targetType: 'technician',
    targetId: technicianId,
  });
}
