import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db';

/** Long enough for the browser redirect, short enough that a leaked link is useless. */
const HANDOFF_TTL_SECONDS = 120;

function hashCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Issues a single-use code that carries a login from the root domain to the organization's
 * subdomain. Only the hash is stored, so reading the table doesn't yield usable codes. With
 * `impersonationId`, `userId` is the platform owner entering the organization.
 */
export async function createLoginHandoff(
  userId: string,
  organizationId: string,
  impersonationId: string | null = null,
): Promise<string> {
  const code = randomBytes(32).toString('base64url');

  await sql`
    INSERT INTO auth_handoffs (code_hash, user_id, organization_id, impersonation_id, expires_at)
    VALUES (
      ${hashCode(code)}, ${userId}, ${organizationId}, ${impersonationId},
      NOW() + make_interval(secs => ${HANDOFF_TTL_SECONDS})
    )
  `;

  return code;
}

export type HandoffUser = {
  id: string;
  email: string;
  role: 'admin' | 'technician';
  organization_id: string;
  organization_slug: string;
  impersonation_id: string | null;
};

/**
 * Consumes a handoff code. Returns null when the code is unknown, expired, already used, issued
 * for a different organization than the subdomain it is being redeemed on, or — for the owner
 * entering an organization — when that session is no longer open.
 */
export async function redeemLoginHandoff(code: string, organizationSlug: string): Promise<HandoffUser | null> {
  const claimed = await sql`
    UPDATE auth_handoffs h
    SET used_at = NOW()
    FROM organizations o
    WHERE h.code_hash = ${hashCode(code)}
      AND h.used_at IS NULL
      AND h.expires_at > NOW()
      AND o.id = h.organization_id
      AND o.slug = ${organizationSlug}
      AND o.deleted_at IS NULL
    RETURNING h.user_id, h.organization_id, h.impersonation_id, o.slug
  `;

  const handoff = claimed[0];
  if (!handoff) return null;

  if (handoff.impersonation_id) {
    const owners = await sql`
      SELECT u.id, u.email
      FROM impersonation_sessions i
      JOIN users u ON u.id = i.owner_id
      WHERE i.id = ${handoff.impersonation_id}
        AND i.owner_id = ${handoff.user_id}
        AND i.organization_id = ${handoff.organization_id}
        AND i.ended_at IS NULL
        AND (i.expires_at IS NULL OR i.expires_at > NOW())
        AND u.role = 'platform_owner'
        AND u.status = 'active'
        AND u.deleted_at IS NULL
    `;
    if (!owners[0]) return null;

    return {
      id: String(owners[0].id),
      email: String(owners[0].email),
      role: 'admin',
      organization_id: String(handoff.organization_id),
      organization_slug: String(handoff.slug),
      impersonation_id: String(handoff.impersonation_id),
    };
  }

  const users = await sql`
    SELECT id, email, role
    FROM users
    WHERE id = ${handoff.user_id}
      AND organization_id = ${handoff.organization_id}
      AND deleted_at IS NULL
      AND status = 'active'
  `;
  if (!users[0]) return null;

  return {
    id: String(users[0].id),
    email: String(users[0].email),
    role: users[0].role as 'admin' | 'technician',
    organization_id: String(handoff.organization_id),
    organization_slug: String(handoff.slug),
    impersonation_id: null,
  };
}
