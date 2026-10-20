import { sql } from './db';

export type AuditEvent = {
  organizationId: string | null;
  actorId: string | null;
  actorRole: string | null;
  impersonationId?: string | null;
  /** Dotted verb, e.g. "organization.suspended", "impersonation.request". */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
};

/** Appends to the audit trail. Never throws: a failed audit write is logged, not surfaced to the user. */
export async function recordAudit(event: AuditEvent) {
  try {
    await sql`
      INSERT INTO audit_events (
        organization_id, actor_id, actor_role, impersonation_id, action, target_type, target_id, details
      )
      VALUES (
        ${event.organizationId}, ${event.actorId}, ${event.actorRole}, ${event.impersonationId ?? null},
        ${event.action}, ${event.targetType ?? null}, ${event.targetId ?? null},
        ${event.details ? JSON.stringify(event.details) : null}::jsonb
      )
    `;
  } catch (error) {
    console.error('[audit] failed to record event:', event.action, error);
  }
}

export type AuditQuery = {
  organizationId?: string | null;
  action?: string | null;
  limit?: number;
  before?: string | null;
};

/** Newest first. `before` (an ISO timestamp) pages backwards. */
export async function listAuditEvents(query: AuditQuery) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (query.organizationId) conditions.push(`a.organization_id = ${add(query.organizationId)}`);
  if (query.action) conditions.push(`a.action LIKE ${add(`${query.action}%`)}`);
  if (query.before) conditions.push(`a.created_at < ${add(query.before)}::timestamptz`);

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

  return sql.query(
    `
      SELECT a.id, a.organization_id AS "organizationId", o.name AS "organizationName", a.actor_id AS "actorId",
             u.name AS "actorName", u.email AS "actorEmail", a.actor_role AS "actorRole",
             a.impersonation_id AS "impersonationId", a.action, a.target_type AS "targetType",
             a.target_id AS "targetId", a.details, a.created_at AS "createdAt"
      FROM audit_events a
      LEFT JOIN organizations o ON o.id = a.organization_id
      LEFT JOIN users u ON u.id = a.actor_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `,
    params,
  );
}
