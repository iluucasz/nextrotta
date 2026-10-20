// Relative imports only: used by the middleware (edge) as well as routes.
import { sql } from './db';

/**
 * What a suspended or canceled organization can still do. Nothing is ever deleted:
 * - full: active or past due (normal use);
 * - read_only: for `readOnlyDays` after the suspension/cancellation, everything can be viewed and
 *   exported but not changed;
 * - export_only: after that, users only reach a page to download the organization's data.
 * Reactivating (or paying, for a billing suspension) gives full access back at any time.
 */
export type AccessLevel = 'full' | 'read_only' | 'export_only';

export const DEFAULT_READ_ONLY_DAYS = 90;

const DAY_MS = 86_400_000;

export function computeAccess(status: string, changedAt: string | Date | null, readOnlyDays: number | null | undefined) {
  if (status !== 'suspended' && status !== 'canceled') return { level: 'full' as AccessLevel, readOnlyUntil: null };
  const days = Number.isFinite(Number(readOnlyDays)) && readOnlyDays !== null ? Number(readOnlyDays) : DEFAULT_READ_ONLY_DAYS;
  const since = changedAt ? new Date(changedAt) : new Date();
  const until = new Date(since.getTime() + days * DAY_MS);
  return { level: (Date.now() < until.getTime() ? 'read_only' : 'export_only') as AccessLevel, readOnlyUntil: until.toISOString() };
}

export type OrganizationAccess = ReturnType<typeof computeAccess> & {
  organizationId: string;
  name: string;
  status: string;
  since: string | null;
  /** Self-service signups wait on a welcome page until the setup fee is paid and the owner releases them. */
  onboarding: 'awaiting_payment' | 'setup' | null;
};

async function load(where: 'slug' | 'id', value: string): Promise<OrganizationAccess | null> {
  const rows =
    where === 'slug'
      ? await sql`
          SELECT o.id, o.name, o.status, o.onboarding_status, COALESCE(o.status_changed_at, o.updated_at) AS changed_at,
                 (SELECT (data->>'readOnlyDays')::int FROM platform_settings LIMIT 1) AS days
          FROM organizations o WHERE o.slug = ${value}`
      : await sql`
          SELECT o.id, o.name, o.status, o.onboarding_status, COALESCE(o.status_changed_at, o.updated_at) AS changed_at,
                 (SELECT (data->>'readOnlyDays')::int FROM platform_settings LIMIT 1) AS days
          FROM organizations o WHERE o.id = ${value}`;
  const row = rows[0];
  if (!row) return null;
  return {
    organizationId: String(row.id),
    name: String(row.name),
    status: String(row.status),
    since: row.status === 'suspended' || row.status === 'canceled' ? new Date(row.changed_at).toISOString() : null,
    onboarding: row.onboarding_status === 'awaiting_payment' || row.onboarding_status === 'setup' ? row.onboarding_status : null,
    ...computeAccess(String(row.status), row.changed_at, row.days),
  };
}

export const getAccessBySlug = (slug: string) => load('slug', slug);
export const getAccessById = (organizationId: string) => load('id', organizationId);
