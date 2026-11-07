// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { sql } from '../db';
import {
  defaultAudience,
  isNoticeCategory,
  isNoticeSeverity,
  type NoticeAudience,
  type NoticeCategory,
  type NoticeSeverity,
} from './notice-meta';

/**
 * The inbox of the NextRotta's own people (admins and support users): what is going on in the organizations and in the platform.
 * The table is platform_notices (migration 0048). Nothing is deleted: an issue that ends is resolved, and a person clears a
 * notice for themselves. This file is the database part (no WhatsApp: that is notice-alerts.ts, which uses it).
 */

export type NoticeInput = {
  /** null = about the platform itself. */
  organizationId?: string | null;
  category: NoticeCategory;
  severity?: NoticeSeverity;
  /** Defaults to the category's (support = staff, everything else = the admins). */
  audience?: NoticeAudience;
  title: string;
  body?: string;
  /** A page of the owner's panel. Anything else is dropped. */
  href?: string | null;
  /** While a notice with this key is unresolved, the same key never notifies again. */
  dedupeKey?: string | null;
};

function safePanelHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  return href.startsWith('/') && !href.startsWith('//') && href.length <= 300 ? href : null;
}

/**
 * Writes a notice. `created` is false when the same unresolved key was already there (then it only counts one more
 * occurrence, or just refreshes when `repeat` is "refresh": what a periodic check uses so it does not count itself).
 * Throws on a database error: callers that must never fail use notifyPlatform.
 */
export async function insertNotice(input: NoticeInput, repeat: 'count' | 'refresh' = 'count'): Promise<{ id: string; created: boolean }> {
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new Error('A notificação precisa de um título.');
  if (!isNoticeCategory(input.category)) throw new Error(`Categoria inválida: ${input.category}`);

  const severity = isNoticeSeverity(input.severity) ? input.severity : 'info';
  const audience = input.audience ?? defaultAudience(input.category);
  const count = repeat === 'count';

  const rows = await sql`
    INSERT INTO platform_notices (organization_id, category, severity, audience, title, body, href, dedupe_key)
    VALUES (
      ${input.organizationId ?? null}, ${input.category}, ${severity}, ${audience}, ${title},
      ${(input.body ?? '').trim().slice(0, 2000)}, ${safePanelHref(input.href)}, ${input.dedupeKey ?? null}
    )
    ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND resolved_at IS NULL
    DO UPDATE SET
      occurrences = platform_notices.occurrences + ${count ? 1 : 0},
      last_seen_at = NOW(),
      severity = EXCLUDED.severity,
      title = EXCLUDED.title,
      body = EXCLUDED.body
    RETURNING id, (xmax = 0) AS created
  `;
  return { id: String(rows[0].id), created: Boolean(rows[0].created) };
}

/** Closes the open notices whose key starts with `prefix` (the problem went away). Returns how many were closed. */
export async function resolveNotices(prefix: string): Promise<number> {
  const rows = await sql`
    UPDATE platform_notices SET resolved_at = NOW()
    WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL AND starts_with(dedupe_key, ${prefix})
    RETURNING id
  `;
  return rows.length;
}

/** Closes the open notices under `prefix` that are not in `keepKeys`: what a periodic check calls after listing what is still wrong. */
export async function resolveNoticesExcept(prefix: string, keepKeys: string[]): Promise<number> {
  const rows = await sql`
    UPDATE platform_notices SET resolved_at = NOW()
    WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL AND starts_with(dedupe_key, ${prefix})
      AND NOT (dedupe_key = ANY(${keepKeys}::text[]))
    RETURNING id
  `;
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// Reading (per person)
// ---------------------------------------------------------------------------------------------

export type NoticeViewer = { userId: string; role: string };

export type NoticeFilters = {
  /** "active" = what the person has not cleared; "cleared" = what they did. */
  state?: 'active' | 'cleared';
  severity?: NoticeSeverity;
  category?: NoticeCategory;
  organizationId?: string;
  /** Resolved notices are hidden unless asked for. */
  includeResolved?: boolean;
  unreadOnly?: boolean;
};

export type NoticeItem = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  category: NoticeCategory;
  severity: NoticeSeverity;
  title: string;
  body: string;
  href: string | null;
  occurrences: number;
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  read: boolean;
  cleared: boolean;
};

/** Support users see only what is for the whole staff; the owner sees everything. */
const VISIBLE_TO = `($1::text = 'platform_owner' OR n.audience = 'staff')`;

function buildWhere(filters: NoticeFilters, viewer: NoticeViewer, args: unknown[]) {
  const parts = [VISIBLE_TO];
  args.push(viewer.role); // $1
  args.push(viewer.userId); // $2
  parts.push(filters.state === 'cleared' ? 'r.dismissed_at IS NOT NULL' : 'r.dismissed_at IS NULL');
  if (!filters.includeResolved) parts.push('n.resolved_at IS NULL');
  if (filters.severity) {
    args.push(filters.severity);
    parts.push(`n.severity = $${args.length}`);
  }
  if (filters.category) {
    args.push(filters.category);
    parts.push(`n.category = $${args.length}`);
  }
  if (filters.organizationId) {
    args.push(filters.organizationId);
    parts.push(`n.organization_id = $${args.length}::uuid`);
  }
  if (filters.unreadOnly) parts.push('r.user_id IS NULL');
  return parts.join(' AND ');
}

const FROM = `
  FROM platform_notices n
  LEFT JOIN organizations o ON o.id = n.organization_id
  LEFT JOIN platform_notice_reads r ON r.notice_id = n.id AND r.user_id = $2
`;

export async function listNotices(viewer: NoticeViewer, filters: NoticeFilters = {}, page: { limit?: number; offset?: number } = {}): Promise<NoticeItem[]> {
  const args: unknown[] = [];
  const where = buildWhere(filters, viewer, args);
  args.push(Math.min(Math.max(page.limit ?? 50, 1), 200), Math.max(page.offset ?? 0, 0));
  const rows = await sql.query(
    `
      SELECT n.id, n.organization_id, o.name AS organization_name, n.category, n.severity, n.title, n.body, n.href, n.occurrences,
             n.created_at, n.last_seen_at, n.resolved_at, (r.user_id IS NOT NULL) AS read, (r.dismissed_at IS NOT NULL) AS cleared
      ${FROM}
      WHERE ${where}
      ORDER BY (n.resolved_at IS NULL) DESC, n.last_seen_at DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}
    `,
    args,
  );
  return rows.map((row) => ({
    id: String(row.id),
    organizationId: (row.organization_id as string | null) ?? null,
    organizationName: (row.organization_name as string | null) ?? null,
    category: String(row.category) as NoticeCategory,
    severity: String(row.severity) as NoticeSeverity,
    title: String(row.title),
    body: String(row.body),
    href: (row.href as string | null) ?? null,
    occurrences: Number(row.occurrences),
    createdAt: new Date(row.created_at as string).toISOString(),
    lastSeenAt: new Date(row.last_seen_at as string).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string).toISOString() : null,
    read: Boolean(row.read),
    cleared: Boolean(row.cleared),
  }));
}

export type NoticeSummary = {
  /** Unread and still open, by severity (what the cards filter by). */
  bySeverity: Record<NoticeSeverity, number>;
  unread: number;
  /** Unread and still open, by category. */
  byCategory: Record<string, number>;
};

/** The counters of the bell and of the cards: unread, not cleared, not resolved. */
export async function summarizeNotices(viewer: NoticeViewer): Promise<NoticeSummary> {
  const args: unknown[] = [];
  const where = buildWhere({ unreadOnly: true }, viewer, args);
  const rows = await sql.query(
    `SELECT n.severity, n.category, COUNT(*)::int AS total ${FROM} WHERE ${where} GROUP BY n.severity, n.category`,
    args,
  );
  const summary: NoticeSummary = { bySeverity: { critical: 0, warning: 0, success: 0, info: 0 }, unread: 0, byCategory: {} };
  for (const row of rows) {
    const total = Number(row.total);
    summary.bySeverity[String(row.severity) as NoticeSeverity] += total;
    summary.byCategory[String(row.category)] = (summary.byCategory[String(row.category)] ?? 0) + total;
    summary.unread += total;
  }
  return summary;
}

const UUID_LIST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a person may act on: the given ids, or everything the filters show (never more than they can see). */
async function targetIds(viewer: NoticeViewer, target: { ids?: string[]; all?: boolean; filters?: NoticeFilters }): Promise<string[]> {
  if (target.ids) return target.ids.filter((id) => UUID_LIST.test(id));
  if (!target.all) return [];
  const args: unknown[] = [];
  const where = buildWhere(target.filters ?? {}, viewer, args);
  const rows = await sql.query(`SELECT n.id ${FROM} WHERE ${where}`, args);
  return rows.map((row) => String(row.id));
}

/** Marks as read (for this person only). `ids` must be notices the person can see. */
export async function markNoticesRead(viewer: NoticeViewer, target: { ids?: string[]; all?: boolean; filters?: NoticeFilters }) {
  const ids = await targetIds(viewer, target);
  if (!ids.length) return 0;
  const rows = await sql`
    INSERT INTO platform_notice_reads (user_id, notice_id)
    SELECT ${viewer.userId}::uuid, n.id FROM platform_notices n
    WHERE n.id = ANY(${ids}::uuid[]) AND (${viewer.role}::text = 'platform_owner' OR n.audience = 'staff')
    ON CONFLICT (user_id, notice_id) DO NOTHING
    RETURNING notice_id
  `;
  return rows.length;
}

/** Clears (or brings back, with `restore`) for this person only. A cleared notice is also read. */
export async function clearNotices(viewer: NoticeViewer, target: { ids?: string[]; all?: boolean; filters?: NoticeFilters }, restore = false) {
  const ids = await targetIds(viewer, restore ? { ...target, filters: { ...target.filters, state: 'cleared' } } : target);
  if (!ids.length) return 0;
  const rows = restore
    ? await sql`
        UPDATE platform_notice_reads SET dismissed_at = NULL
        WHERE user_id = ${viewer.userId} AND notice_id = ANY(${ids}::uuid[])
        RETURNING notice_id
      `
    : await sql`
        INSERT INTO platform_notice_reads (user_id, notice_id, dismissed_at)
        SELECT ${viewer.userId}::uuid, n.id, NOW() FROM platform_notices n
        WHERE n.id = ANY(${ids}::uuid[]) AND (${viewer.role}::text = 'platform_owner' OR n.audience = 'staff')
        ON CONFLICT (user_id, notice_id) DO UPDATE SET dismissed_at = NOW()
        RETURNING notice_id
      `;
  return rows.length;
}
