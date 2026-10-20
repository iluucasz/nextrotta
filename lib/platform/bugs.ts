import { recordAudit } from '../audit';
import { sql } from '../db';
import { isUuid, PlatformError, type Actor } from './errors';
import { REPORT_TYPES, SUPPORT_CATEGORIES, type ReportType, type SupportCategory } from '../reports';

export const BUG_STATUSES = [
  'new',
  'investigating',
  'resolved',
  'not_reproduced',
] as const;
export const BUG_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];
export type BugPriority = (typeof BUG_PRIORITIES)[number];

/** A screenshot travels as a data URL; keep it small enough for a database row. */
const MAX_SCREENSHOT_LENGTH = 2_800_000;

function iso(value: unknown) {
  return value ? new Date(value as string).toISOString() : null;
}

function serializeBug(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    type: (REPORT_TYPES.includes(row.report_type as ReportType) ? row.report_type : 'bug') as ReportType,
    ticketNumber: row.ticket_number === null || row.ticket_number === undefined ? null : Number(row.ticket_number),
    supportCategory: (row.support_category as SupportCategory | null) ?? null,
    organizationId: String(row.organization_id),
    organizationName: (row.organization_name as string | undefined) ?? null,
    userId: String(row.user_id),
    userName: (row.user_name as string | undefined) ?? null,
    userEmail: (row.user_email as string | undefined) ?? null,
    title: String(row.title),
    description: String(row.description),
    pageUrl: (row.page_url as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    appVersion: (row.app_version as string | null) ?? null,
    hasScreenshot: Boolean(row.has_screenshot ?? row.screenshot),
    status: row.status as BugStatus,
    priority: row.priority as BugPriority,
    messagesCount: Number(row.messages_count ?? 0),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    resolvedAt: iso(row.resolved_at),
  };
}

export type BugReport = ReturnType<typeof serializeBug>;

const BUG_COLUMNS = `
  b.report_type, b.ticket_number, b.support_category,
  b.id, b.organization_id, b.user_id, b.title, b.description, b.page_url, b.user_agent, b.app_version,
  (b.screenshot IS NOT NULL) AS has_screenshot, b.status, b.priority, b.created_at, b.updated_at, b.resolved_at,
  o.name AS organization_name, u.name AS user_name, u.email AS user_email
`;

/** Owner inbox; `organizationId` narrows it to one organization. */
export async function listBugReports(
  filters: { organizationId?: string | null; userId?: string | null } = {},
) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.organizationId) {
    params.push(filters.organizationId);
    conditions.push(`b.organization_id = $${params.length}`);
  }
  if (filters.userId) {
    params.push(filters.userId);
    conditions.push(`b.user_id = $${params.length}`);
  }
  const rows = await sql.query(
    `SELECT ${BUG_COLUMNS},
       (SELECT COUNT(*)::int FROM bug_messages m WHERE m.bug_id = b.id AND NOT m.internal) AS messages_count
     FROM bug_reports b
     JOIN organizations o ON o.id = b.organization_id
     JOIN users u ON u.id = b.user_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY b.created_at DESC
     LIMIT 500`,
    params,
  );
  return rows.map(serializeBug);
}

/**
 * One report with its conversation. `viewer` decides what's visible: the organization never sees
 * the owner's internal notes, and only reports of its own organization.
 */
export async function getBugReport(
  id: string,
  viewer: { kind: 'owner' } | { kind: 'organization'; organizationId: string },
) {
  if (!isUuid(id)) throw new PlatformError('Relato não encontrado.', 404);
  const rows = await sql.query(
    `SELECT ${BUG_COLUMNS} FROM bug_reports b
     JOIN organizations o ON o.id = b.organization_id
     JOIN users u ON u.id = b.user_id
     WHERE b.id = $1`,
    [id],
  );
  const row = rows[0];
  if (
    !row ||
    (viewer.kind === 'organization' &&
      String(row.organization_id) !== viewer.organizationId)
  ) {
    throw new PlatformError('Relato não encontrado.', 404);
  }

  const messages = await sql`
    SELECT m.*, u.name AS author_name FROM bug_messages m
    JOIN users u ON u.id = m.author_id
    WHERE m.bug_id = ${id} AND (${viewer.kind === 'owner'} OR NOT m.internal)
    ORDER BY m.created_at
  `;
  return {
    report: serializeBug(row),
    messages: messages.map((message) => ({
      id: String(message.id),
      authorName: String(message.author_name),
      fromOwner: Boolean(message.from_owner),
      internal: Boolean(message.internal),
      text: String(message.text),
      createdAt: iso(message.created_at)!,
    })),
  };
}

export async function getBugScreenshot(
  id: string,
  viewer: { kind: 'owner' } | { kind: 'organization'; organizationId: string },
) {
  await getBugReport(id, viewer);
  const rows = await sql`SELECT screenshot FROM bug_reports WHERE id = ${id}`;
  return (rows[0]?.screenshot as string | null) ?? null;
}

function cleanText(value: unknown, max: number) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

/** Sent from Reports in an organization's system: a support ticket, a bug or a suggestion. */
export async function createBugReport(
  reporter: { organizationId: string; userId: string },
  input: Record<string, unknown>,
) {
  const type = (input.type ?? 'bug') as ReportType;
  if (!REPORT_TYPES.includes(type)) throw new PlatformError('Escolha Suporte, Bug ou Sugestão.');

  const category = type === 'support' ? (input.category as SupportCategory) : null;
  if (type === 'support' && !SUPPORT_CATEGORIES.includes(category as SupportCategory)) {
    throw new PlatformError('Escolha com o que você precisa de ajuda.');
  }

  const title = cleanText(input.title, 200);
  const description = cleanText(input.description, 10_000);
  if (title.length < 3) throw new PlatformError('Dê um título curto para o chamado.');
  if (description.length < 10) throw new PlatformError('Descreva o que você precisa (pelo menos 10 caracteres).');

  const screenshot = typeof input.screenshot === 'string' && input.screenshot ? input.screenshot : null;
  if (screenshot && !/^data:image\/(png|jpeg|webp);base64,/.test(screenshot))
    throw new PlatformError('A captura de tela deve ser PNG, JPG ou WebP.');
  if (screenshot && screenshot.length > MAX_SCREENSHOT_LENGTH)
    throw new PlatformError('A captura de tela passa de 2 MB. Envie uma imagem menor.');

  const rows = await sql`
    INSERT INTO bug_reports (
      organization_id, user_id, title, description, page_url, user_agent, app_version, screenshot, report_type, support_category
    )
    VALUES (
      ${reporter.organizationId}, ${reporter.userId}, ${title}, ${description}, ${cleanText(input.pageUrl, 500) || null},
      ${cleanText(input.userAgent, 500) || null}, ${cleanText(input.appVersion, 50) || null}, ${screenshot}, ${type}, ${category}
    )
    RETURNING id, ticket_number
  `;
  return { id: String(rows[0].id), ticketNumber: Number(rows[0].ticket_number) };
}

/** A message in the report's conversation, from the organization or from the owner. */
export async function addBugMessage(
  id: string,
  author: { userId: string; fromOwner: boolean; organizationId?: string },
  input: { text: unknown; internal?: unknown },
) {
  const viewer = author.fromOwner
    ? ({ kind: 'owner' } as const)
    : ({
        kind: 'organization',
        organizationId: author.organizationId!,
      } as const);
  const { report } = await getBugReport(id, viewer);
  const text = cleanText(input.text, 10_000);
  if (!text) throw new PlatformError('Escreva a mensagem.');
  const internal = author.fromOwner && Boolean(input.internal);

  await sql`
    INSERT INTO bug_messages (bug_id, author_id, from_owner, internal, text)
    VALUES (${id}, ${author.userId}, ${author.fromOwner}, ${internal}, ${text})
  `;
  // The organization writing back on a closed report reopens it.
  if (
    !author.fromOwner &&
    (report.status === 'resolved' || report.status === 'not_reproduced')
  ) {
    await sql`UPDATE bug_reports SET status = 'investigating', resolved_at = NULL, updated_at = NOW() WHERE id = ${id}`;
  } else {
    await sql`UPDATE bug_reports SET updated_at = NOW() WHERE id = ${id}`;
  }
  return getBugReport(id, viewer);
}

export async function updateBugReport(
  id: string,
  input: Record<string, unknown>,
  actor: Actor,
) {
  const { report } = await getBugReport(id, { kind: 'owner' });
  const status = 'status' in input ? input.status : report.status;
  const priority = 'priority' in input ? input.priority : report.priority;
  if (!BUG_STATUSES.includes(status as BugStatus))
    throw new PlatformError('Estado inválido.');
  if (!BUG_PRIORITIES.includes(priority as BugPriority))
    throw new PlatformError('Prioridade inválida.');

  const closing =
    (status === 'resolved' || status === 'not_reproduced') &&
    report.status !== status;
  await sql`
    UPDATE bug_reports
    SET status = ${status as string}, priority = ${priority as string}, updated_at = NOW(),
        resolved_at = ${closing ? new Date().toISOString() : status === 'new' || status === 'investigating' ? null : report.resolvedAt}
    WHERE id = ${id}
  `;
  await recordAudit({
    organizationId: report.organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'bug.updated',
    targetType: 'bug_report',
    targetId: id,
    details: {
      before: { status: report.status, priority: report.priority },
      after: { status, priority },
    },
  });
  return getBugReport(id, { kind: 'owner' });
}
