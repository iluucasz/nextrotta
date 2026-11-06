import { recordAudit } from '../audit';
import { sql } from '../db';
import { after } from 'next/server';
import { alertOwnerOfChat, mirrorChatWelcome, storeChatWelcome } from '../livechat/whatsapp';
import { startWebConversation } from '../livechat/store';
import { ticketVariable } from '../livechat/auto-messages';
import { getAutoMessage } from '../livechat/auto-store';
import { notifyOrganization } from '../notifications';
import { normalizePhone } from '../whatsapp/phone';
import { assignee } from '../cases/people';
import { changeLine, statusLine, textProblem, MAX_DESCRIPTION_LENGTH, MAX_SUBJECT_LENGTH, type CaseOrigin } from '../cases/rules';
import { isUuid, PlatformError, type Actor } from './errors';
import { formatTicketNumber, REPORT_TYPES, SUPPORT_CATEGORIES, type ReportType, type SupportCategory } from '../reports';

export const BUG_STATUSES = [
  'new',
  'investigating',
  'waiting',
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
    /** 'case' = written support (the thread lives in the ticket); 'chat' = a live chat (all of it happens in the Livechat). */
    channel: (row.channel === 'chat' ? 'chat' : 'case') as 'case' | 'chat',
    /** Where it came from: 'portal' = opened by a customer in their system; the others are the team's own (internal) cases. */
    origin: ((row.origin as CaseOrigin | undefined) ?? 'portal') as CaseOrigin,
    contactName: (row.contact_name as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? null,
    organizationId: (row.organization_id as string | null) ?? null,
    organizationName: (row.organization_name as string | undefined) ?? null,
    userId: (row.user_id as string | null) ?? null,
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
  b.report_type, b.ticket_number, b.support_category, b.channel, b.origin, b.contact_name, b.contact_phone, b.owner_id, ou.name AS owner_name,
  b.id, b.organization_id, b.user_id, b.title, b.description, b.page_url, b.user_agent, b.app_version,
  (b.screenshot IS NOT NULL) AS has_screenshot, b.status, b.priority, b.created_at, b.updated_at, b.resolved_at,
  o.name AS organization_name, u.name AS user_name, u.email AS user_email
`;

/** Owner inbox; `organizationId` narrows it to one organization. */
export async function listBugReports(
  filters: { organizationId?: string | null; userId?: string | null; /** Default: all. */ channel?: 'case' | 'chat' | 'all'; /** What a customer sees: only the cases they opened themselves (never the team's internal ones). */ portalOnly?: boolean } = {},
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
  if (filters.portalOnly) conditions.push(`b.origin = 'portal'`);
  if (filters.channel === 'case' || filters.channel === 'chat') {
    params.push(filters.channel);
    conditions.push(`b.channel = $${params.length}`);
  }
  const rows = await sql.query(
    `SELECT ${BUG_COLUMNS},
       (SELECT COUNT(*)::int FROM bug_messages m WHERE m.bug_id = b.id AND NOT m.internal) AS messages_count
     FROM bug_reports b
     LEFT JOIN organizations o ON o.id = b.organization_id
     LEFT JOIN users u ON u.id = b.user_id
     LEFT JOIN users ou ON ou.id = b.owner_id
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
     LEFT JOIN organizations o ON o.id = b.organization_id
     LEFT JOIN users u ON u.id = b.user_id
     LEFT JOIN users ou ON ou.id = b.owner_id
     WHERE b.id = $1`,
    [id],
  );
  const row = rows[0];
  if (
    !row ||
    (viewer.kind === 'organization' &&
      (String(row.organization_id) !== viewer.organizationId || row.origin !== 'portal'))
  ) {
    throw new PlatformError('Relato não encontrado.', 404);
  }

  const messages = await sql`
    SELECT m.*, u.name AS author_name FROM bug_messages m
    JOIN users u ON u.id = m.author_id
    WHERE m.bug_id = ${id} AND (${viewer.kind === 'owner'} OR NOT m.internal)
    ORDER BY m.created_at
  `;
  // The owner also sees whether there is a live chat on this ticket.
  const chat =
    viewer.kind === 'owner'
      ? (
          await sql`SELECT id, status, unread_owner FROM livechat_conversations WHERE ticket_id = ${id} AND channel = 'web' ORDER BY (status = 'open') DESC, created_at DESC LIMIT 1`
        )[0] ?? null
      : null;
  const conversations =
    viewer.kind === 'owner'
      ? (
          await sql`SELECT id, channel, status, contact_phone, created_at, last_message_at, last_message_preview FROM livechat_conversations WHERE ticket_id = ${id} OR case_id = ${id} ORDER BY created_at DESC`
        ).map((row) => ({
          id: String(row.id),
          channel: row.channel as 'web' | 'whatsapp',
          status: row.status as 'open' | 'closed',
          contactPhone: (row.contact_phone as string | null) ?? null,
          createdAt: iso(row.created_at)!,
          lastMessageAt: iso(row.last_message_at)!,
          preview: (row.last_message_preview as string | null) ?? null,
        }))
      : [];
  const events =
    viewer.kind === 'owner'
      ? (
          await sql`SELECT e.id, e.kind, e.body, e.created_at, u.name AS author_name FROM bug_events e LEFT JOIN users u ON u.id = e.author_id WHERE e.bug_id = ${id} ORDER BY e.created_at DESC, e.id`
        ).map((row) => ({ id: String(row.id), kind: String(row.kind), body: String(row.body), authorName: (row.author_name as string | null) ?? null, createdAt: iso(row.created_at)! }))
      : [];
  return {
    report: serializeBug(row),
    conversations,
    events,
    chat: chat ? { id: String(chat.id), status: chat.status as 'open' | 'closed', unread: Number(chat.unread_owner) } : null,
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

  // A live chat (support tickets only; `urgent` is the old name): high priority, and the chat opens at once with the description as the
  // customer's first message, so the owner finds it in the Livechat. Anything else is a written case.
  const chat = type === 'support' && (input.channel === 'chat' || input.urgent === true);
  // Optional: the number the team may also answer on (what the customer types back there lands in the same chat).
  const whatsappInput = chat ? String(input.whatsapp ?? '').trim() : '';
  const contactPhone = whatsappInput ? normalizePhone(whatsappInput) : null;
  if (whatsappInput && !contactPhone) throw new PlatformError('O WhatsApp informado não é válido. Use DDD + número, ou deixe em branco.');
  const rows = await sql`
    INSERT INTO bug_reports (
      organization_id, user_id, title, description, page_url, user_agent, app_version, screenshot, report_type, support_category, priority, channel
    )
    VALUES (
      ${reporter.organizationId}, ${reporter.userId}, ${title}, ${description}, ${cleanText(input.pageUrl, 500) || null},
      ${cleanText(input.userAgent, 500) || null}, ${cleanText(input.appVersion, 50) || null}, ${screenshot}, ${type}, ${category},
      ${chat ? 'high' : 'medium'}, ${chat ? 'chat' : 'case'}
    )
    RETURNING id, ticket_number
  `;
  const ticketId = String(rows[0].id);
  if (chat) {
    try {
      const user = (await sql`SELECT name FROM users WHERE id = ${reporter.userId}`)[0];
      const userName = String(user?.name ?? 'Cliente');
      const conversation = await startWebConversation({ organizationId: reporter.organizationId, userId: reporter.userId, ticketId, userName, opening: { message: description }, contactPhone });
      // The team's first message is in the chat at once; what needs the network (the same on WhatsApp, the alert to the owner) runs after the answer.
      await storeChatWelcome(conversation, userName);
      const notify = async () => {
        await mirrorChatWelcome(conversation, userName);
        await alertOwnerOfChat(conversation, userName, description);
      };
      try {
        after(notify);
      } catch {
        await notify(); // outside a request (scripts, tests)
      }
    } catch (error) {
      // The ticket is what matters: it exists, and the customer can still start the chat from its page.
      console.error('[bug-reports] urgent chat not opened:', error);
    }
  }
  return { id: ticketId, ticketNumber: Number(rows[0].ticket_number) };
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
  // A case the team opened itself has no customer reading it: only notes make sense there.
  if (report.origin !== 'portal' && !internal) throw new PlatformError('Este caso é interno (não foi aberto pelo cliente): registre uma anotação.', 409);
  // The conversation of a live chat is the chat itself (Livechat): the written thread belongs to cases.
  if (report.channel === 'chat' && !internal) throw new PlatformError('Este atendimento é um chat ao vivo: a conversa acontece no Livechat.', 409);

  const message = await sql`
    INSERT INTO bug_messages (bug_id, author_id, from_owner, internal, text)
    VALUES (${id}, ${author.userId}, ${author.fromOwner}, ${internal}, ${text})
    RETURNING id
  `;
  // The platform answering a ticket is the one thing the company should not have to go and look for.
  if (author.fromOwner && !internal && report.organizationId) {
    await notifyOrganization(report.organizationId, {
      kind: 'support',
      severity: 'info',
      title: `Resposta no chamado ${formatTicketNumber(report.ticketNumber)}`,
      body: text.length > 140 ? `${text.slice(0, 137)}...` : text,
      href: `/admin/suporte/${id}`,
      dedupeKey: `support:reply:${message[0]?.id ?? id}`,
    });
  }
  // The organization writing back on a closed report reopens it.
  if (
    !author.fromOwner &&
    (report.status === 'resolved' || report.status === 'not_reproduced' || report.status === 'waiting')
  ) {
    await sql`UPDATE bug_reports SET status = 'investigating', resolved_at = NULL, updated_at = NOW() WHERE id = ${id}`;
  } else {
    await sql`UPDATE bug_reports SET updated_at = NOW() WHERE id = ${id}`;
  }
  return getBugReport(id, viewer);
}

/**
 * { status?, priority?, ownerId? (null = nobody), subject?, description?, closingMessage? } — every change goes into the case's
 * history. Subject and description belong to the customer on a ticket they opened, so only the team's own cases take them.
 */
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

  let ownerId = report.ownerId;
  let ownerName = report.ownerName;
  if ('ownerId' in input) {
    const next = input.ownerId ? await assignee(String(input.ownerId)) : null;
    ownerId = next?.id ?? null;
    ownerName = next?.name ?? null;
  }
  let title = report.title;
  let description = report.description;
  if ('subject' in input || 'description' in input) {
    if (report.origin === 'portal') throw new PlatformError('O relato do cliente não é alterado. Registre uma anotação.', 409);
    if ('subject' in input) {
      const problem = textProblem(input.subject, 'o assunto', MAX_SUBJECT_LENGTH, true);
      if (problem) throw new PlatformError(problem);
      title = String(input.subject).trim();
    }
    if ('description' in input) {
      const problem = textProblem(input.description, 'a descrição', MAX_DESCRIPTION_LENGTH, false);
      if (problem) throw new PlatformError(problem);
      description = typeof input.description === 'string' ? input.description.trim() : '';
    }
  }

  const closing =
    (status === 'resolved' || status === 'not_reproduced') &&
    report.status !== status;
  const stillOpen = status === 'new' || status === 'investigating' || status === 'waiting';
  await sql`
    UPDATE bug_reports
    SET status = ${status as string}, priority = ${priority as string}, owner_id = ${ownerId}, title = ${title}, description = ${description}, updated_at = NOW(),
        resolved_at = ${closing ? new Date().toISOString() : stillOpen ? null : report.resolvedAt}
    WHERE id = ${id}
  `;

  // The history: one line per thing that changed, with who did it.
  const lines: Array<{ kind: 'status' | 'priority' | 'owner' | 'subject'; body: string }> = [];
  if (status !== report.status) lines.push({ kind: 'status', body: statusLine(report.type, report.status as BugStatus, status as BugStatus) });
  if (priority !== report.priority) lines.push({ kind: 'priority', body: changeLine.priority(report.priority, priority as BugPriority) });
  if (ownerId !== report.ownerId) lines.push({ kind: 'owner', body: changeLine.owner(report.ownerName, ownerName) });
  if (title !== report.title) lines.push({ kind: 'subject', body: changeLine.subject(title) });
  for (const line of lines) await sql`INSERT INTO bug_events (bug_id, kind, author_id, body) VALUES (${id}, ${line.kind}, ${actor.id}, ${line.body})`;

  // Concluding a written case says goodbye: thanks, and how to ask again (the owner can edit or skip it: closingMessage ""). Only to
  // a customer who opened the ticket; a case of the team's own has nobody to thank.
  if (closing && report.channel === 'case' && report.origin === 'portal') {
    const wanted = typeof input.closingMessage === 'string' ? input.closingMessage.trim() : (await getAutoMessage('case_closing', { chamado: ticketVariable(report.ticketNumber) })) ?? '';
    if (wanted) await addBugMessage(id, { userId: actor.id, fromOwner: true }, { text: wanted });
  }
  await recordAudit({
    organizationId: report.organizationId,
    actorId: actor.id,
    actorRole: actor.role ?? 'platform_owner',
    action: 'bug.updated',
    targetType: 'bug_report',
    targetId: id,
    details: {
      before: { status: report.status, priority: report.priority, ownerId: report.ownerId },
      after: { status, priority, ownerId },
    },
  });
  return getBugReport(id, { kind: 'owner' });
}
