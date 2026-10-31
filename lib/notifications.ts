import { sql } from './db';
import { brasiliaDateKey } from './formatters';

/**
 * Notifications. Two kinds share one table: what is going on for one company (organization_id set: charges,
 * support replies, the Porto robot, credits, the escala running out) and notices from the platform that every
 * company sees (organization_id NULL). Nothing is removed: the owner archives a notice, and a read is a row in
 * notification_reads, one per person.
 */

export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'critical'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];
export type NotificationAudience = 'admins' | 'everyone';

export type NotificationInput = {
  /** null = a notice for every company. */
  organizationId: string | null;
  /** What it is about: "system", "billing", "support", "porto", "credits", "schedule"... */
  kind: string;
  severity?: NotificationSeverity;
  title: string;
  body?: string;
  /** A page inside the system ("/admin/assinatura"). Anything else is dropped. */
  href?: string | null;
  audience?: NotificationAudience;
  /** The same key never notifies the same company twice (e.g. "billing:overdue:<charge id>"). */
  dedupeKey?: string | null;
  createdBy?: string | null;
  expiresAt?: Date | string | null;
};

export type NotificationItem = {
  id: string;
  /** "company" = about this company; "system" = from the platform, for everyone. */
  scope: 'company' | 'system';
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
};

export function safeInternalHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  return href.startsWith('/') && !href.startsWith('//') && href.length <= 200 ? href : null;
}

function cleanSeverity(value: unknown): NotificationSeverity {
  return NOTIFICATION_SEVERITIES.includes(value as NotificationSeverity) ? (value as NotificationSeverity) : 'info';
}

/** Creates a notification. Returns its id, or null when the same dedupe key already notified. */
export async function createNotification(input: NotificationInput): Promise<string | null> {
  const title = input.title.trim().slice(0, 140);
  if (!title) throw new Error('A notificação precisa de um título.');

  const rows = await sql`
    INSERT INTO notifications (organization_id, kind, severity, title, body, href, audience, dedupe_key, created_by, expires_at)
    VALUES (
      ${input.organizationId}, ${input.kind}, ${cleanSeverity(input.severity)}, ${title}, ${(input.body ?? '').trim().slice(0, 1000)},
      ${safeInternalHref(input.href)}, ${input.audience === 'everyone' ? 'everyone' : 'admins'}, ${input.dedupeKey ?? null},
      ${input.createdBy ?? null}, ${input.expiresAt ?? null}
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `;

  return rows[0] ? String(rows[0].id) : null;
}

/** For events inside other flows (a payment, a reply): a failure here must never break the flow itself. */
export async function notifyOrganization(organizationId: string, input: Omit<NotificationInput, 'organizationId'>) {
  try {
    return await createNotification({ ...input, organizationId });
  } catch (error) {
    console.error('[notifications] could not notify:', input.kind, error);
    return null;
  }
}

// What a person is allowed to see: their company's notifications and the general ones, created after the company
// existed, not archived, not expired, and for admins or for everyone.
const VISIBLE = `
  (n.organization_id = $1 OR n.organization_id IS NULL)
  AND n.archived_at IS NULL
  AND (n.expires_at IS NULL OR n.expires_at > NOW())
  AND n.created_at >= o.created_at
  AND ($3::boolean OR n.audience = 'everyone')
`;

export async function listNotifications(params: { organizationId: string; userId: string; isAdmin: boolean; limit?: number }) {
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const rows = await sql.query(
    `
      SELECT n.id, n.organization_id, n.kind, n.severity, n.title, n.body, n.href, n.created_at,
             (r.user_id IS NOT NULL) AS read
      FROM notifications n
      JOIN organizations o ON o.id = $1
      LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $2
      WHERE ${VISIBLE}
      ORDER BY n.created_at DESC
      LIMIT $4
    `,
    [params.organizationId, params.userId, params.isAdmin, limit],
  );

  return rows.map(
    (row): NotificationItem => ({
      id: String(row.id),
      scope: row.organization_id ? 'company' : 'system',
      kind: String(row.kind),
      severity: cleanSeverity(row.severity),
      title: String(row.title),
      body: String(row.body ?? ''),
      href: (row.href as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
      read: Boolean(row.read),
    }),
  );
}

export async function countUnreadNotifications(params: { organizationId: string; userId: string; isAdmin: boolean }) {
  const rows = await sql.query(
    `
      SELECT COUNT(*)::int AS total
      FROM notifications n
      JOIN organizations o ON o.id = $1
      LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $2
      WHERE ${VISIBLE} AND r.user_id IS NULL
    `,
    [params.organizationId, params.userId, params.isAdmin],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Marks as read the given notifications (or every visible one) for one person. */
export async function markNotificationsRead(params: { organizationId: string; userId: string; isAdmin: boolean; ids?: string[] }) {
  const ids = params.ids?.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) ?? null;
  await sql.query(
    `
      INSERT INTO notification_reads (user_id, notification_id)
      SELECT $2::uuid, n.id
      FROM notifications n
      JOIN organizations o ON o.id = $1
      WHERE ${VISIBLE} AND ($4::uuid[] IS NULL OR n.id = ANY($4::uuid[]))
      ON CONFLICT DO NOTHING
    `,
    [params.organizationId, params.userId, params.isAdmin, ids],
  );
}

function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatDay(dateKey: string) {
  return `${dateKey.slice(8, 10)}/${dateKey.slice(5, 7)}/${dateKey.slice(0, 4)}`;
}

/**
 * The escala running out is the one thing the system can see before the admin does: when the planned days end
 * within a week (or nothing is planned) for a company that builds it by hand, say so once per month cycle.
 */
export async function ensureScheduleReminder(organizationId: string) {
  const rows = await sql`
    SELECT
      (SELECT to_char(MAX(date), 'YYYY-MM-DD') FROM schedule WHERE organization_id = ${organizationId} AND deleted_at IS NULL) AS last_date,
      (SELECT COUNT(*)::int FROM technicians WHERE organization_id = ${organizationId} AND status = 'active' AND deleted_at IS NULL) AS technicians,
      COALESCE((SELECT automation_enabled FROM porto_config WHERE organization_id = ${organizationId}), false) AS porto
  `;
  const row = rows[0];
  if (!row || Number(row.technicians) === 0 || row.porto) return;

  const today = brasiliaDateKey();
  const lastDate = (row.last_date as string | null) ?? null;
  if (lastDate && lastDate >= addDays(today, 7)) return;

  await createNotification({
    organizationId,
    kind: 'schedule',
    severity: 'warning',
    title: lastDate ? `A escala termina em ${formatDay(lastDate)}` : 'Ainda não há escala montada',
    body: lastDate ? 'Monte o próximo período para a equipe não ficar sem planejamento.' : 'Monte a escala para acompanhar quem trabalha em cada dia.',
    href: '/admin/schedule',
    dedupeKey: `schedule:planned-until:${lastDate ?? 'none'}`,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Owner side: general notices and notices for one company, published from the platform panel.

export async function listPlatformNotifications() {
  const rows = await sql`
    SELECT n.id, n.organization_id, o.name AS organization_name, n.kind, n.severity, n.title, n.body, n.href,
           n.audience, n.created_at, n.expires_at, n.archived_at,
           (SELECT COUNT(*)::int FROM notification_reads r WHERE r.notification_id = n.id) AS reads
    FROM notifications n
    LEFT JOIN organizations o ON o.id = n.organization_id
    WHERE n.kind = 'system'
    ORDER BY n.created_at DESC
    LIMIT 200
  `;

  return rows.map((row) => ({
    id: String(row.id),
    organizationId: (row.organization_id as string | null) ?? null,
    organizationName: (row.organization_name as string | null) ?? null,
    severity: cleanSeverity(row.severity),
    title: String(row.title),
    body: String(row.body ?? ''),
    href: (row.href as string | null) ?? null,
    audience: row.audience as NotificationAudience,
    createdAt: new Date(row.created_at as string).toISOString(),
    expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
    archived: Boolean(row.archived_at),
    reads: Number(row.reads ?? 0),
  }));
}

export async function archiveNotification(id: string) {
  const rows = await sql`
    UPDATE notifications SET archived_at = NOW()
    WHERE id = ${id} AND archived_at IS NULL AND kind = 'system'
    RETURNING id, organization_id
  `;
  return rows[0] ? { id: String(rows[0].id), organizationId: (rows[0].organization_id as string | null) ?? null } : null;
}
