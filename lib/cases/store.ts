import { recordAudit } from '../audit';
import { sql } from '../db';
import { phoneTail, samePhone } from '../livechat/rules';
import { getConversation, getMessages } from '../livechat/store';
import { isUuid, PlatformError, type Actor } from '../platform/errors';
import { updateBugReport } from '../platform/bugs';
import { normalizePhone } from '../whatsapp/phone';
import { REPORT_TYPES, type ReportType, type SupportCategory } from '../reports';
import { assignee, listAssignees } from './people';
import {
  formatCaseNumber,
  isCasePriority,
  isCaseStatus,
  isCaseType,
  MAX_DESCRIPTION_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SUBJECT_LENGTH,
  OPEN_STATUSES,
  suggestedSubject,
  textProblem,
  transcript,
  type CaseOrigin,
  type CasePriority,
  type CaseStatus,
} from './rules';

export { listAssignees };

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

/** A case is a row of bug_reports: the customer's tickets and the team's own cases are the same table (see migration 0047). */
const SELECT_CASE = `
  SELECT b.id, b.ticket_number, b.title, b.description, b.status, b.priority, b.origin, b.channel, b.report_type, b.support_category,
         b.organization_id, b.contact_name, b.contact_phone, b.owner_id, b.created_at, b.updated_at, b.resolved_at,
         o.name AS organization_name, ou.name AS owner_name, u.name AS reporter_name,
         (SELECT COUNT(*)::int FROM livechat_conversations lc WHERE lc.case_id = b.id OR lc.ticket_id = b.id) AS conversation_count
  FROM bug_reports b
  LEFT JOIN organizations o ON o.id = b.organization_id
  LEFT JOIN users ou ON ou.id = b.owner_id
  LEFT JOIN users u ON u.id = b.user_id
`;

function serializeCase(row: Record<string, unknown>) {
  const origin = ((row.origin as CaseOrigin | undefined) ?? 'portal') as CaseOrigin;
  return {
    id: String(row.id),
    number: Number(row.ticket_number),
    subject: String(row.title),
    description: String(row.description ?? ''),
    type: (REPORT_TYPES.includes(row.report_type as ReportType) ? row.report_type : 'support') as ReportType,
    supportCategory: (row.support_category as SupportCategory | null) ?? null,
    status: row.status as CaseStatus,
    priority: row.priority as CasePriority,
    origin,
    /** A case the customer opened themselves can't have its text changed by the team (and it has a customer to answer). */
    internal: origin !== 'portal',
    channel: (row.channel === 'chat' ? 'chat' : 'case') as 'case' | 'chat',
    organizationId: (row.organization_id as string | null) ?? null,
    organizationName: (row.organization_name as string | null) ?? null,
    contactName: ((row.contact_name as string | null) ?? (row.reporter_name as string | null)) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? null,
    conversationCount: Number(row.conversation_count ?? 0),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    resolvedAt: iso(row.resolved_at),
  };
}

export type SupportCase = ReturnType<typeof serializeCase>;

async function addEvent(caseId: string, kind: 'created' | 'status' | 'priority' | 'owner' | 'subject' | 'conversation', authorId: string | null, body: string) {
  await sql`INSERT INTO bug_events (bug_id, kind, author_id, body) VALUES (${caseId}, ${kind}, ${authorId}, ${body})`;
}

// ------------------------------------------------------------------------------------------------------------ reading

/** ?type=support|bug|suggestion&status=open|all|<status>&owner=me|none|all|<user id>&priority=&q= */
export async function listCases(filters: { type?: string | null; status?: string | null; owner?: string | null; priority?: string | null; q?: string | null }, currentUserId: string) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const status = filters.status ?? 'open';
  if (status === 'open') where.push(`b.status IN (${OPEN_STATUSES.map((value) => `'${value}'`).join(', ')})`);
  else if (isCaseStatus(status)) where.push(`b.status = ${add(status)}`);
  if (filters.type && isCaseType(filters.type)) where.push(`b.report_type = ${add(filters.type)}`);
  const owner = filters.owner ?? 'all';
  if (owner === 'me') where.push(`b.owner_id = ${add(currentUserId)}`);
  else if (owner === 'none') where.push('b.owner_id IS NULL');
  else if (isUuid(owner)) where.push(`b.owner_id = ${add(owner)}`);
  if (filters.priority && isCasePriority(filters.priority)) where.push(`b.priority = ${add(filters.priority)}`);
  const q = (filters.q ?? '').trim().toLowerCase();
  if (q) {
    const like = add(`%${q}%`);
    const digits = q.replace(/\D/g, '');
    where.push(`(lower(b.title) LIKE ${like} OR lower(COALESCE(b.contact_name, '')) LIKE ${like} OR lower(COALESCE(u.name, '')) LIKE ${like} OR lower(COALESCE(o.name, '')) LIKE ${like} OR b.ticket_number::text = ${add(q.replace('#', ''))}${digits.length >= 4 ? ` OR b.contact_phone LIKE ${add(`%${digits}%`)}` : ''})`);
  }
  const rows = await sql.query(`${SELECT_CASE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (b.status IN ('resolved', 'not_reproduced')), b.updated_at DESC LIMIT 300`, params);
  return rows.map(serializeCase);
}

export async function getCase(id: string): Promise<SupportCase> {
  if (!isUuid(id)) throw new PlatformError('Caso não encontrado.', 404);
  const rows = await sql.query(`${SELECT_CASE} WHERE b.id = $1`, [id]);
  if (!rows[0]) throw new PlatformError('Caso não encontrado.', 404);
  return serializeCase(rows[0]);
}

/** The history of a case as one timeline, newest first: what changed and the internal notes. */
export async function getCaseEvents(caseId: string) {
  const rows = await sql`
    SELECT * FROM (
      SELECT e.id, e.kind, e.body, e.created_at, u.name AS author_name
      FROM bug_events e LEFT JOIN users u ON u.id = e.author_id WHERE e.bug_id = ${caseId}
      UNION ALL
      SELECT m.id, 'note' AS kind, m.text AS body, m.created_at, u.name AS author_name
      FROM bug_messages m JOIN users u ON u.id = m.author_id WHERE m.bug_id = ${caseId} AND m.internal
    ) timeline
    ORDER BY created_at DESC, id LIMIT 300
  `;
  return rows.map((row) => ({ id: String(row.id), kind: String(row.kind), body: String(row.body), authorName: (row.author_name as string | null) ?? null, createdAt: iso(row.created_at)! }));
}

/** The conversations ("atendimentos") gathered in a case, newest first: its own live chat and the ones turned into it. */
export async function getCaseConversations(caseId: string) {
  const rows = await sql`
    SELECT id, channel, status, contact_phone, created_at, last_message_at, last_message_preview
    FROM livechat_conversations WHERE case_id = ${caseId} OR ticket_id = ${caseId} ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    channel: row.channel as 'web' | 'whatsapp',
    status: row.status as 'open' | 'closed',
    contactPhone: (row.contact_phone as string | null) ?? null,
    createdAt: iso(row.created_at)!,
    lastMessageAt: iso(row.last_message_at)!,
    preview: (row.last_message_preview as string | null) ?? null,
  }));
}

// ------------------------------------------------------------------------------------------------------------ writing

/**
 * { type?, conversationId?, subject?, description?, priority?, status?, ownerId?, organizationId?, contactName?, contactPhone?, note? }
 * Opens a case of the team's own: from a conversation (the contact, the company and the end of the conversation come from it) or by
 * hand. `type` is Suporte (default), Bug or Sugestão. Without `ownerId` it is given to who creates it; `ownerId: null` leaves it
 * without an owner. A live chat opened from a ticket already is a case, so it is not turned into another.
 */
export async function createCase(input: Record<string, unknown>, actor: Actor) {
  const conversationId = typeof input.conversationId === 'string' && input.conversationId ? input.conversationId : null;
  let organizationId: string | null = typeof input.organizationId === 'string' && input.organizationId ? input.organizationId : null;
  let contactName = typeof input.contactName === 'string' ? input.contactName.trim() : '';
  let contactPhone: string | null = null;
  let origin: CaseOrigin = 'manual';
  let suggested = '';
  let description = typeof input.description === 'string' ? input.description.trim() : '';

  if (conversationId) {
    const conversation = await getConversation(conversationId);
    if (conversation.caseId) throw new PlatformError(`Esta conversa já é o caso ${formatCaseNumber(conversation.caseNumber)}.`, 409);
    const messages = await getMessages(conversationId);
    organizationId = conversation.organizationId;
    contactName = conversation.userName ?? conversation.contactName ?? '';
    contactPhone = conversation.contactPhone;
    origin = conversation.channel === 'web' ? 'livechat' : 'whatsapp';
    const firstCustomer = messages.find((message) => message.direction === 'in' && message.kind !== 'system')?.body ?? null;
    suggested = suggestedSubject({ ticketTitle: conversation.ticketTitle, firstCustomerMessage: firstCustomer, contactName, organizationName: conversation.organizationName });
    if (!description) description = transcript(messages, contactName || 'Cliente');
  } else if (typeof input.contactPhone === 'string' && input.contactPhone.trim()) {
    contactPhone = normalizePhone(input.contactPhone);
    if (!contactPhone) throw new PlatformError('O WhatsApp informado não é válido. Use DDD + número.');
  }

  const type = input.type === undefined ? 'support' : input.type;
  if (!isCaseType(type)) throw new PlatformError('Escolha Suporte, Bug ou Sugestão.');
  const subject = typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim() : suggested;
  const problem = textProblem(subject, 'o assunto', MAX_SUBJECT_LENGTH, true) ?? textProblem(description, 'a descrição', MAX_DESCRIPTION_LENGTH, false) ?? textProblem(input.note, 'a anotação', MAX_NOTE_LENGTH, false);
  if (problem) throw new PlatformError(problem);
  const priority = input.priority === undefined ? 'medium' : input.priority;
  if (!isCasePriority(priority)) throw new PlatformError('Prioridade inválida.');
  const status = input.status === undefined ? 'new' : input.status;
  if (!isCaseStatus(status) || status === 'resolved' || status === 'not_reproduced') throw new PlatformError('Um caso novo não pode nascer concluído.');
  if (organizationId) {
    if (!isUuid(organizationId)) throw new PlatformError('Empresa inválida.');
    if (!(await sql`SELECT 1 FROM organizations WHERE id = ${organizationId} AND deleted_at IS NULL`).length) throw new PlatformError('Empresa não encontrada.', 404);
  }
  const owner = input.ownerId === undefined ? await assignee(actor.id) : input.ownerId ? await assignee(String(input.ownerId)) : null;

  const rows = await sql`
    INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category, status, priority, channel, origin, contact_name, contact_phone, owner_id)
    VALUES (${organizationId}, NULL, ${subject}, ${description}, ${type}, ${type === 'support' ? 'other' : null}, ${status}, ${priority}, 'case', ${origin}, ${contactName || null}, ${contactPhone}, ${owner?.id ?? null})
    RETURNING id
  `;
  const id = String(rows[0].id);
  if (conversationId) await sql`UPDATE livechat_conversations SET case_id = ${id} WHERE id = ${conversationId} AND case_id IS NULL`;
  await addEvent(id, 'created', actor.id, conversationId ? `Caso criado a partir de uma conversa (${origin === 'whatsapp' ? 'WhatsApp' : 'chat ao vivo'})` : 'Caso criado à mão');
  if (typeof input.note === 'string' && input.note.trim()) await addCaseNote(id, input.note, actor);
  await recordAudit({ organizationId, actorId: actor.id, actorRole: actor.role ?? 'platform_owner', action: 'case.created', targetType: 'bug_report', targetId: id, details: { origin, type, conversationId } });
  return getCase(id);
}

/** { status?, priority?, ownerId? (null = nobody), subject?, description? } — the one way a case changes (see updateBugReport). */
export async function updateCase(id: string, patch: Record<string, unknown>, actor: Actor) {
  await updateBugReport(id, patch, actor);
  return getCase(id);
}

/** An internal note: only the team ever sees it (a message of the case, marked internal). */
export async function addCaseNote(id: string, text: unknown, actor: Actor) {
  const problem = textProblem(text, 'a anotação', MAX_NOTE_LENGTH, true);
  if (problem) throw new PlatformError(problem);
  await getCase(id);
  await sql`INSERT INTO bug_messages (bug_id, author_id, from_owner, internal, text) VALUES (${id}, ${actor.id}, TRUE, TRUE, ${String(text).trim()})`;
  await sql`UPDATE bug_reports SET updated_at = NOW() WHERE id = ${id}`;
  return getCaseEvents(id);
}

/**
 * A customer who writes again on WhatsApp while a case of theirs is still open: the new conversation joins that case instead of
 * being a stranger to it. Never throws (it runs inside the webhook). Returns the case id when it linked.
 */
export async function linkInboundToOpenCase(storedMessageId: string): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT m.conversation_id, c.channel, c.contact_phone, c.case_id, c.ticket_id
      FROM livechat_messages m JOIN livechat_conversations c ON c.id = m.conversation_id WHERE m.id = ${storedMessageId}
    `;
    const row = rows[0];
    if (!row || row.channel !== 'whatsapp' || row.case_id || row.ticket_id || !row.contact_phone) return null;
    const phone = String(row.contact_phone);
    const candidates = await sql`
      SELECT id, contact_phone FROM bug_reports
      WHERE status IN ('new', 'investigating', 'waiting') AND contact_phone LIKE ${`%${phoneTail(phone)}`}
      ORDER BY updated_at DESC LIMIT 10
    `;
    const match = candidates.find((candidate) => samePhone(String(candidate.contact_phone), phone));
    if (!match) return null;
    const linked = await sql`UPDATE livechat_conversations SET case_id = ${match.id} WHERE id = ${row.conversation_id} AND case_id IS NULL RETURNING id`;
    if (!linked[0]) return null;
    await addEvent(String(match.id), 'conversation', null, 'Nova conversa do WhatsApp ligada a este caso');
    await sql`UPDATE bug_reports SET updated_at = NOW() WHERE id = ${match.id}`;
    return String(match.id);
  } catch (error) {
    console.error('[cases] linking a conversation to an open case failed:', error);
    return null;
  }
}
