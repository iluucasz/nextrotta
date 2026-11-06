import { recordAudit } from '../audit';
import { hashPassword } from '../auth';
import { sql } from '../db';
import { isPlatformRole } from '../platform-access';
import { isUuid, PlatformError, type Actor } from './errors';
import { temporaryPassword } from './organizations';

/**
 * The NextRotta's own team: admins (role `platform_owner`, full access, shown as "Admin") and support users ("atendentes"). Only an
 * admin manages it. A support user answers the Reports and the Livechat and looks at the companies; nothing else (the panel and the
 * API enforce it, see lib/platform-access.ts). Nobody is ever deleted: a person who leaves is made inactive, which ends their
 * session on the next request. The first admin (the founder) can't be changed or made inactive by anyone else, so the platform can
 * never be locked away from its owner.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function founderId(): Promise<string | null> {
  const rows = await sql`SELECT id FROM users WHERE organization_id IS NULL AND role = 'platform_owner' AND deleted_at IS NULL ORDER BY created_at, id LIMIT 1`;
  return rows[0] ? String(rows[0].id) : null;
}

export async function listTeam(currentUserId?: string) {
  const founder = await founderId();
  const rows = await sql`
    SELECT id, name, email, role, status, last_login_at AS "lastLoginAt", created_at AS "createdAt", must_change_password AS "mustChangePassword"
    FROM users
    WHERE organization_id IS NULL AND role IN ('platform_owner', 'platform_support') AND deleted_at IS NULL
    ORDER BY (role = 'platform_owner') DESC, status, name
  `;
  return rows.map((row) => ({ ...row, isYou: String(row.id) === currentUserId, isFounder: String(row.id) === founder }));
}

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

async function emailTaken(email: string, exceptId?: string) {
  const rows = await sql`SELECT 1 FROM users WHERE email = ${email} AND deleted_at IS NULL AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)`;
  return rows.length > 0;
}

/** An admin or a support user (default), with a temporary password shown once: at the first access they must choose their own. */
export async function createTeamMember(input: Record<string, unknown>, actor: Actor) {
  const name = clean(input.name);
  const email = clean(input.email).toLowerCase();
  if (name.length < 2) throw new PlatformError('Informe o nome da pessoa.');
  if (!EMAIL_PATTERN.test(email)) throw new PlatformError('Informe um e-mail válido.');
  const role = input.role === undefined ? 'platform_support' : input.role;
  if (role !== 'platform_support' && role !== 'platform_owner') throw new PlatformError('Escolha Admin ou Atendente.');
  if (await emailTaken(email)) throw new PlatformError('Este e-mail já é usado por outra conta.', 409);

  const password = temporaryPassword();
  const rows = await sql`
    INSERT INTO users (organization_id, email, name, password_hash, role, must_change_password)
    VALUES (NULL, ${email}, ${name}, ${await hashPassword(password)}, ${role}, TRUE)
    RETURNING id, name, email, role, status
  `;
  await recordAudit({ organizationId: null, actorId: actor.id, actorRole: 'platform_owner', action: 'team.created', targetType: 'user', targetId: String(rows[0].id), details: { email, role } });
  return { user: rows[0], temporaryPassword: password };
}

/** Anyone of the team except the person acting (their own data is in Minha conta) and the founder (who nobody else changes). */
async function requireMember(id: string, actor: Actor) {
  if (!isUuid(id)) throw new PlatformError('Pessoa não encontrada.', 404);
  const rows = await sql`SELECT id, name, email, role, status FROM users WHERE id = ${id} AND organization_id IS NULL AND deleted_at IS NULL`;
  const row = rows[0];
  if (!row || !isPlatformRole(row.role)) throw new PlatformError('Pessoa não encontrada.', 404);
  if (id === actor.id) throw new PlatformError('Seus próprios dados ficam em Configurações → Minha conta.', 403);
  if (id === (await founderId())) throw new PlatformError('A conta do primeiro admin não é alterada por outra pessoa.', 403);
  return row;
}

/** { name?, email?, status?: 'active' | 'inactive' } */
export async function updateTeamMember(id: string, input: Record<string, unknown>, actor: Actor) {
  const current = await requireMember(id, actor);
  const name = 'name' in input ? clean(input.name) : String(current.name);
  const email = 'email' in input ? clean(input.email).toLowerCase() : String(current.email);
  const status = 'status' in input ? input.status : current.status;
  if (name.length < 2) throw new PlatformError('Informe o nome da pessoa.');
  if (!EMAIL_PATTERN.test(email)) throw new PlatformError('Informe um e-mail válido.');
  if (status !== 'active' && status !== 'inactive') throw new PlatformError('Situação inválida.');
  if (email !== current.email && (await emailTaken(email, id))) throw new PlatformError('Este e-mail já é usado por outra conta.', 409);

  const rows = await sql`
    UPDATE users SET name = ${name}, email = ${email}, status = ${status}, updated_at = NOW()
    WHERE id = ${id} RETURNING id, name, email, role, status
  `;
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: status !== current.status ? (status === 'active' ? 'team.activated' : 'team.deactivated') : 'team.updated',
    targetType: 'user',
    targetId: id,
    details: { before: { name: current.name, email: current.email, status: current.status }, after: { name, email, status } },
  });
  return rows[0];
}

/** A new temporary password, shown once; the person must choose their own at the next access. */
export async function resetTeamPassword(id: string, actor: Actor) {
  await requireMember(id, actor);
  const password = temporaryPassword();
  await sql`UPDATE users SET password_hash = ${await hashPassword(password)}, must_change_password = TRUE, updated_at = NOW() WHERE id = ${id}`;
  await recordAudit({ organizationId: null, actorId: actor.id, actorRole: 'platform_owner', action: 'team.password_reset', targetType: 'user', targetId: id });
  return { temporaryPassword: password };
}
