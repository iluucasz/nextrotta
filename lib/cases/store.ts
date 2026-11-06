import { recordAudit } from '../audit';
import { sql } from '../db';
import { phoneTail, samePhone } from '../livechat/rules';
import { getConversation, getMessages } from '../livechat/store';
import { isPlatformRole } from '../platform-access';
import { isUuid, PlatformError, type Actor } from '../platform/errors';
import { normalizePhone } from '../whatsapp/phone';
import {
  CASE_ORIGINS,
  changeLine,
  formatCaseNumber,
  isCasePriority,
  isCaseStatus,
  MAX_DESCRIPTION_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_SUBJECT_LENGTH,
  statusLine,
  suggestedSubject,
  textProblem,
  transcript,
  type CaseOrigin,
  type CasePriority,
  type CaseStatus,
} from './rules';

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

const SELECT_CASE = `
  SELECT sc.id, sc.case_number, sc.subject, sc.description, sc.status, sc.priority, sc.origin, sc.organization_id, sc.contact_name, sc.contact_phone,
         sc.owner_id, sc.created_by, sc.created_at, sc.updated_at, sc.resolved_at,
         o.name AS organization_name, ou.name AS owner_name, cu.name AS created_by_name,
         (SELECT COUNT(*)::int FROM livechat_conversations lc WHERE lc.case_id = sc.id) AS conversation_count
  FROM support_cases sc
  LEFT JOIN organizations o ON o.id = sc.organization_id
  LEFT JOIN users ou ON ou.id = sc.owner_id
  LEFT JOIN users cu ON cu.id = sc.created_by
`;

function serializeCase(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    number: Number(row.case_number),
    subject: String(row.subject),
    description: String(row.description ?? ''),
    status: row.status as CaseStatus,
    priority: row.priority as CasePriority,
    origin: row.origin as CaseOrigin,
    organizationId: (row.organization_id as string | null) ?? null,
    organizationName: (row.organization_name as string | null) ?? null,
    contactName: (row.contact_name as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    ownerId: (row.owner_id as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? null,
    createdByName: (row.created_by_name as string | null) ?? null,
    conversationCount: Number(row.conversation_count ?? 0),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    resolvedAt: iso(row.resolved_at),
  };
}

export type SupportCase = ReturnType<typeof serializeCase>;

async function addEvent(caseId: string, kind: 'created' | 'status' | 'priority' | 'owner' | 'subject' | 'note' | 'conversation', authorId: string | null, body: string) {
  await sql`INSERT INTO support_case_events (case_id, kind, author_id, body) VALUES (${caseId}, ${kind}, ${authorId}, ${body})`;
}

/** The people a case can be given to: the active people of the team (owner and attendants), by name only. */
export async function listAssignees() {
  const rows = await sql`
    SELECT id, name, role FROM users
    WHERE organization_id IS NULL AND role IN ('platform_owner', 'platform_support') AND status = 'active' AND deleted_at IS NULL
    ORDER BY name
  `;
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), role: String(row.role) }));
}

async function assignee(userId: string): Promise<{ id: string; name: string }> {
  if (!isUuid(userId)) throw new PlatformError('Responsável inválido.');
  const rows = await sql`SELECT id, name, role, status FROM users WHERE id = ${userId} AND organization_id IS NULL AND deleted_at IS NULL`;
  const row = rows[0];
  if (!row || !isPlatformRole(row.role) || row.status !== 'active') throw new PlatformError('Escolha uma pessoa ativa da equipe como responsável.');
  return { id: String(row.id), name: String(row.name) };
}

// ------------------------------------------------------------------------------------------------------------ reading

/** ?status=open (not resolved, the default) | all | a status; ?owner=me | none | all | a user id; ?priority=; ?q= */
export async function listCases(filters: { status?: string | null; owner?: string | null; priority?: string | null; q?: string | null }, currentUserId: string) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const status = filters.status ?? 'open';
  if (status === 'open') where.push(`sc.status <> 'resolved'`);
  else if (isCaseStatus(status)) where.push(`sc.status = ${add(status)}`);
  const owner = filters.owner ?? 'all';
  if (owner === 'me') where.push(`sc.owner_id = ${add(currentUserId)}`);
  else if (owner === 'none') where.push('sc.owner_id IS NULL');
  else if (isUuid(owner)) where.push(`sc.owner_id = ${add(owner)}`);
  if (filters.priority && isCasePriority(filters.priority)) where.push(`sc.priority = ${add(filters.priority)}`);
  const q = (filters.q ?? '').trim().toLowerCase();
  if (q) {
    const like = add(`%${q}%`);
    const digits = q.replace(/\D/g, '');
    where.push(`(lower(sc.subject) LIKE ${like} OR lower(COALESCE(sc.contact_name, '')) LIKE ${like} OR lower(COALESCE(o.name, '')) LIKE ${like} OR sc.case_number::text = ${add(q.replace('#', ''))}${digits.length >= 4 ? ` OR sc.contact_phone LIKE ${add(`%${digits}%`)}` : ''})`);
  }
  const rows = await sql.query(`${SELECT_CASE} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY (sc.status = 'resolved'), sc.updated_at DESC LIMIT 300`, params);
  return rows.map(serializeCase);
}

export async function getCase(id: string): Promise<SupportCase> {
  if (!isUuid(id)) throw new PlatformError('Caso não encontrado.', 404);
  const rows = await sql.query(`${SELECT_CASE} WHERE sc.id = $1`, [id]);
  if (!rows[0]) throw new PlatformError('Caso não encontrado.', 404);
  return serializeCase(rows[0]);
}

export async function getCaseEvents(caseId: string) {
  const rows = await sql`
    SELECT e.id, e.kind, e.body, e.created_at, u.name AS author_name
    FROM support_case_events e LEFT JOIN users u ON u.id = e.author_id
    WHERE e.case_id = ${caseId} ORDER BY e.created_at DESC, e.id LIMIT 300
  `;
  return rows.map((row) => ({ id: String(row.id), kind: String(row.kind), body: String(row.body), authorName: (row.author_name as string | null) ?? null, createdAt: iso(row.created_at)! }));
}

/** The conversations ("atendimentos") gathered in a case, newest first. */
export async function getCaseConversations(caseId: string) {
  const rows = await sql`
    SELECT id, channel, status, contact_phone, created_at, last_message_at, last_message_preview
    FROM livechat_conversations WHERE case_id = ${caseId} ORDER BY created_at DESC
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
 * { conversationId?, subject?, description?, priority?, status?, ownerId?, organizationId?, contactName?, contactPhone?, note? }
 * Turns a conversation into a case (the contact, the company and the end of the conversation come from it) or opens one by hand.
 * Without `ownerId` the case is given to who creates it; `ownerId: null` leaves it without an owner.
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
    if (conversation.caseId) throw new PlatformError(`Esta conversa já tem o caso ${formatCaseNumber(conversation.caseNumber)}.`, 409);
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

  const subject = typeof input.subject === 'string' && input.subject.trim() ? input.subject.trim() : suggested;
  const problem = textProblem(subject, 'o assunto', MAX_SUBJECT_LENGTH, true) ?? textProblem(description, 'a descrição', MAX_DESCRIPTION_LENGTH, false) ?? textProblem(input.note, 'a anotação', MAX_NOTE_LENGTH, false);
  if (problem) throw new PlatformError(problem);
  const priority = input.priority === undefined ? 'medium' : input.priority;
  if (!isCasePriority(priority)) throw new PlatformError('Prioridade inválida.');
  const status = input.status === undefined ? 'new' : input.status;
  if (!isCaseStatus(status) || status === 'resolved') throw new PlatformError('Um caso novo não pode nascer resolvido.');
  if (organizationId) {
    if (!isUuid(organizationId)) throw new PlatformError('Empresa inválida.');
    if (!(await sql`SELECT 1 FROM organizations WHERE id = ${organizationId} AND deleted_at IS NULL`).length) throw new PlatformError('Empresa não encontrada.', 404);
  }
  const owner = input.ownerId === undefined ? await assignee(actor.id) : input.ownerId ? await assignee(String(input.ownerId)) : null;

  const rows = await sql`
    INSERT INTO support_cases (subject, description, status, priority, origin, organization_id, contact_name, contact_phone, owner_id, created_by)
    VALUES (${subject}, ${description}, ${status}, ${priority}, ${origin}, ${organizationId}, ${contactName || null}, ${contactPhone}, ${owner?.id ?? null}, ${actor.id})
    RETURNING id
  `;
  const id = String(rows[0].id);
  if (conversationId) await sql`UPDATE livechat_conversations SET case_id = ${id} WHERE id = ${conversationId} AND case_id IS NULL`;
  await addEvent(id, 'created', actor.id, conversationId ? `Caso criado a partir de uma conversa (${origin === 'whatsapp' ? 'WhatsApp' : 'chat ao vivo'})` : 'Caso criado à mão');
  if (typeof input.note === 'string' && input.note.trim()) await addEvent(id, 'note', actor.id, input.note.trim());
  await recordAudit({ organizationId, actorId: actor.id, actorRole: actor.role ?? 'platform_owner', action: 'case.created', targetType: 'support_case', targetId: id, details: { origin, conversationId } });
  return getCase(id);
}

/** { status?, priority?, ownerId? (null = nobody), subject?, description? } — every change goes into the history. */
export async function updateCase(id: string, patch: Record<string, unknown>, actor: Actor) {
  const current = await getCase(id);
  const lines: Array<{ kind: 'status' | 'priority' | 'owner' | 'subject'; body: string }> = [];

  let status = current.status;
  if (patch.status !== undefined) {
    if (!isCaseStatus(patch.status)) throw new PlatformError('Status inválido.');
    if (patch.status !== current.status) {
      lines.push({ kind: 'status', body: statusLine(current.status, patch.status) });
      status = patch.status;
    }
  }
  let priority = current.priority;
  if (patch.priority !== undefined) {
    if (!isCasePriority(patch.priority)) throw new PlatformError('Prioridade inválida.');
    if (patch.priority !== current.priority) {
      lines.push({ kind: 'priority', body: changeLine.priority(current.priority, patch.priority) });
      priority = patch.priority;
    }
  }
  let ownerId = current.ownerId;
  if (patch.ownerId !== undefined) {
    const next = patch.ownerId ? await assignee(String(patch.ownerId)) : null;
    if ((next?.id ?? null) !== current.ownerId) {
      lines.push({ kind: 'owner', body: changeLine.owner(current.ownerName, next?.name ?? null) });
      ownerId = next?.id ?? null;
    }
  }
  let subject = current.subject;
  if (patch.subject !== undefined) {
    const problem = textProblem(patch.subject, 'o assunto', MAX_SUBJECT_LENGTH, true);
    if (problem) throw new PlatformError(problem);
    const next = String(patch.subject).trim();
    if (next !== current.subject) {
      lines.push({ kind: 'subject', body: changeLine.subject(next) });
      subject = next;
    }
  }
  let description = current.description;
  if (patch.description !== undefined) {
    const problem = textProblem(patch.description, 'a descrição', MAX_DESCRIPTION_LENGTH, false);
    if (problem) throw new PlatformError(problem);
    description = typeof patch.description === 'string' ? patch.description.trim() : '';
  }
  if (!lines.length && description === current.description) return current;

  const resolvedAt = status === 'resolved' ? (current.status === 'resolved' ? current.resolvedAt : new Date().toISOString()) : null;
  await sql`
    UPDATE support_cases
    SET status = ${status}, priority = ${priority}, owner_id = ${ownerId}, subject = ${subject}, description = ${description}, resolved_at = ${resolvedAt}, updated_at = NOW()
    WHERE id = ${id}
  `;
  for (const line of lines) await addEvent(id, line.kind, actor.id, line.body);
  await recordAudit({ organizationId: current.organizationId, actorId: actor.id, actorRole: actor.role ?? 'platform_owner', action: 'case.updated', targetType: 'support_case', targetId: id, details: { changes: lines.map((line) => line.kind) } });
  return getCase(id);
}

/** An internal note: only the team ever sees it. */
export async function addCaseNote(id: string, text: unknown, actor: Actor) {
  const problem = textProblem(text, 'a anotação', MAX_NOTE_LENGTH, true);
  if (problem) throw new PlatformError(problem);
  await getCase(id);
  await addEvent(id, 'note', actor.id, String(text).trim());
  await sql`UPDATE support_cases SET updated_at = NOW() WHERE id = ${id}`;
  return getCaseEvents(id);
}

/**
 * A customer who writes again on WhatsApp while a case of theirs is still open: the new conversation joins that case instead of
 * being a stranger to it. Never throws (it runs inside the webhook). Returns the case id when it linked.
 */
export async function linkInboundToOpenCase(storedMessageId: string): Promise<string | null> {
  try {
    const rows = await sql`
      SELECT m.conversation_id, c.channel, c.contact_phone, c.case_id
      FROM livechat_messages m JOIN livechat_conversations c ON c.id = m.conversation_id WHERE m.id = ${storedMessageId}
    `;
    const row = rows[0];
    if (!row || row.channel !== 'whatsapp' || row.case_id || !row.contact_phone) return null;
    const phone = String(row.contact_phone);
    const candidates = await sql`SELECT id, contact_phone FROM support_cases WHERE status <> 'resolved' AND contact_phone LIKE ${`%${phoneTail(phone)}`} ORDER BY updated_at DESC LIMIT 10`;
    const match = candidates.find((candidate) => samePhone(String(candidate.contact_phone), phone));
    if (!match) return null;
    const linked = await sql`UPDATE livechat_conversations SET case_id = ${match.id} WHERE id = ${row.conversation_id} AND case_id IS NULL RETURNING id`;
    if (!linked[0]) return null;
    await addEvent(String(match.id), 'conversation', null, 'Nova conversa do WhatsApp ligada a este caso');
    await sql`UPDATE support_cases SET updated_at = NOW() WHERE id = ${match.id}`;
    return String(match.id);
  } catch (error) {
    console.error('[cases] linking a conversation to an open case failed:', error);
    return null;
  }
}
