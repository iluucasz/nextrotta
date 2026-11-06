import { sql } from '../db';
import { isUuid, PlatformError } from '../platform/errors';
import type { SavedFile } from './files';
import {
  attachmentPreview,
  cleanMessage,
  MAX_CUSTOMER_MESSAGES_PER_MINUTE,
  isMirroredText,
  phoneTail,
  previewOf,
  samePhone,
  SUPPORT_SENDER,
  type InboundMessage,
} from './rules';

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export type Conversation = ReturnType<typeof serializeConversation>;
export type ChatMessage = ReturnType<typeof serializeMessage>;

const COLUMNS = `
  c.id, c.channel, c.organization_id, c.ticket_id, c.user_id, c.contact_name, c.contact_phone, c.status, c.urgent,
  c.unread_owner, c.unread_customer, c.last_message_at, c.last_message_preview, c.created_at, c.closed_at,
  o.name AS organization_name, o.slug AS organization_slug, b.ticket_number, b.title AS ticket_title, u.name AS user_name,
  COALESCE(c.case_id, c.ticket_id) AS case_id, sc.ticket_number AS case_number, sc.status AS case_status
`;
const FROM = `
  livechat_conversations c
  LEFT JOIN organizations o ON o.id = c.organization_id
  LEFT JOIN bug_reports b ON b.id = c.ticket_id
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN bug_reports sc ON sc.id = COALESCE(c.case_id, c.ticket_id)
`;

function serializeConversation(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    channel: row.channel as 'web' | 'whatsapp',
    organizationId: (row.organization_id as string | null) ?? null,
    organizationName: (row.organization_name as string | null) ?? null,
    organizationSlug: (row.organization_slug as string | null) ?? null,
    ticketId: (row.ticket_id as string | null) ?? null,
    ticketNumber: row.ticket_number == null ? null : Number(row.ticket_number),
    ticketTitle: (row.ticket_title as string | null) ?? null,
    userName: (row.user_name as string | null) ?? null,
    contactName: (row.contact_name as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    status: row.status as 'open' | 'closed',
    urgent: Boolean(row.urgent),
    unreadOwner: Number(row.unread_owner ?? 0),
    unreadCustomer: Number(row.unread_customer ?? 0),
    lastMessageAt: iso(row.last_message_at)!,
    lastMessagePreview: (row.last_message_preview as string | null) ?? null,
    createdAt: iso(row.created_at)!,
    closedAt: iso(row.closed_at),
    /** The case of this conversation: its ticket (a live chat opened from one) or the case it was turned into (lib/cases). */
    caseId: (row.case_id as string | null) ?? null,
    caseNumber: row.case_number == null ? null : Number(row.case_number),
    caseStatus: (row.case_status as string | null) ?? null,
  };
}

function serializeMessage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    direction: row.direction as 'in' | 'out',
    senderName: (row.sender_name as string | null) ?? null,
    body: String(row.body),
    kind: row.kind as 'text' | 'media' | 'system',
    /** Which automatic message this is (null = written by a person). */
    autoKey: (row.auto_key as string | null) ?? null,
    /** A file sent in this message (kept in the private store; read back only through the system). */
    attachment: row.attachment_id
      ? { id: String(row.attachment_id), fileName: String(row.file_name), contentType: String(row.content_type), size: Number(row.file_size) }
      : null,
    createdAt: iso(row.created_at)!,
  };
}

/** What a conversation shows in its title: who it is, in the owner's words. */
export function conversationTitle(conversation: Conversation) {
  if (conversation.channel === 'web') return conversation.organizationName ?? 'Cliente';
  return conversation.contactName || conversation.contactPhone || 'Contato';
}

// ------------------------------------------------------------------------------------------------------------- reading

export async function listConversations(filters: { status?: 'open' | 'closed' | 'all'; search?: string } = {}) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status === 'open' || filters.status === 'closed') {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }
  const search = (filters.search ?? '').trim().slice(0, 80);
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(c.contact_name ILIKE $${params.length} OR c.contact_phone ILIKE $${params.length} OR o.name ILIKE $${params.length} OR c.last_message_preview ILIKE $${params.length})`);
  }
  const rows = await sql.query(
    `SELECT ${COLUMNS} FROM ${FROM} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY c.last_message_at DESC LIMIT 200`,
    params,
  );
  return rows.map(serializeConversation);
}

/** Conversations with something the owner has not read yet, and how many messages that is. */
export async function unreadSummary() {
  const rows = await sql`SELECT COUNT(*)::int AS conversations, COALESCE(SUM(unread_owner), 0)::int AS messages FROM livechat_conversations WHERE status = 'open' AND unread_owner > 0`;
  return { conversations: Number(rows[0].conversations), messages: Number(rows[0].messages) };
}

export async function getConversation(id: string): Promise<Conversation> {
  if (!isUuid(id)) throw new PlatformError('Conversa não encontrada.', 404);
  const rows = await sql.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw new PlatformError('Conversa não encontrada.', 404);
  return serializeConversation(rows[0]);
}

/** The messages of a conversation, oldest first; `after` (a timestamp) returns only the newer ones. */
export async function getMessages(conversationId: string, after?: string | null): Promise<ChatMessage[]> {
  const since = after && !Number.isNaN(new Date(after).getTime()) ? new Date(after).toISOString() : null;
  const rows = await sql`
    SELECT m.id, m.direction, m.sender_name, m.body, m.kind, m.auto_key, m.created_at,
           a.id AS attachment_id, a.file_name, a.content_type, a.file_size
    FROM livechat_messages m
    LEFT JOIN livechat_attachments a ON a.message_id = m.id
    WHERE m.conversation_id = ${conversationId} AND (${since}::timestamptz IS NULL OR m.created_at > ${since}::timestamptz)
    ORDER BY m.created_at, m.id
    LIMIT 500
  `;
  return rows.map(serializeMessage);
}

export async function markReadByOwner(conversationId: string) {
  await sql`UPDATE livechat_conversations SET unread_owner = 0 WHERE id = ${conversationId} AND unread_owner > 0`;
}

export async function markReadByCustomer(conversationId: string) {
  await sql`UPDATE livechat_conversations SET unread_customer = 0 WHERE id = ${conversationId} AND unread_customer > 0`;
}

// ------------------------------------------------------------------------------------------------------------ writing

/**
 * Stores a message and updates the conversation (last message, unread counters). A message of the customer reopens a closed
 * conversation. Returns null when the same WhatsApp message had already been stored.
 */
async function addMessage(input: {
  conversationId: string;
  direction: 'in' | 'out';
  body: string;
  senderName?: string | null;
  kind?: 'text' | 'media' | 'system';
  waMessageId?: string | null;
  at?: Date;
  /** A file sent with the message (the body may be empty then). */
  attachment?: SavedFile & { organizationId: string | null; counted: boolean };
  /** Stored in the chat without touching the list (preview, unread): the team's automatic first message. */
  silent?: boolean;
  /** Marks the message as one of the automatic messages (lib/livechat/auto-messages.ts). */
  autoKey?: string | null;
}): Promise<ChatMessage | null> {
  const kind = input.kind ?? 'text';
  const at = (input.at ?? new Date()).toISOString();
  const inserted = await sql`
    INSERT INTO livechat_messages (conversation_id, direction, sender_name, body, kind, wa_message_id, created_at, auto_key)
    VALUES (${input.conversationId}, ${input.direction}, ${input.senderName ?? null}, ${input.body}, ${kind}, ${input.waMessageId ?? null}, ${at}, ${input.autoKey ?? null})
    ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
    RETURNING id, direction, sender_name, body, kind, auto_key, created_at
  `;
  if (!inserted[0]) return null;
  let attachment: ChatMessage['attachment'] = null;
  if (input.attachment) {
    const saved = await sql`
      INSERT INTO livechat_attachments (message_id, conversation_id, organization_id, file_name, content_type, file_size, url, counted)
      VALUES (${inserted[0].id}, ${input.conversationId}, ${input.attachment.organizationId}, ${input.attachment.fileName}, ${input.attachment.contentType}, ${input.attachment.size}, ${input.attachment.url}, ${input.attachment.counted})
      RETURNING id
    `;
    attachment = { id: String(saved[0].id), fileName: input.attachment.fileName, contentType: input.attachment.contentType, size: input.attachment.size };
  }
  if (kind !== 'system' && !input.silent) {
    const fromCustomer = input.direction === 'in';
    await sql`
      UPDATE livechat_conversations
      SET last_message_at = GREATEST(last_message_at, ${at}::timestamptz), last_message_preview = ${previewOf(input.body || (input.attachment ? attachmentPreview(input.attachment.fileName) : ''))},
          unread_owner = unread_owner + ${fromCustomer ? 1 : 0},
          unread_customer = unread_customer + ${fromCustomer ? 0 : 1},
          status = CASE WHEN ${fromCustomer} THEN 'open' ELSE status END,
          closed_at = CASE WHEN ${fromCustomer} THEN NULL ELSE closed_at END
      WHERE id = ${input.conversationId}
    `;
  }
  return { ...serializeMessage(inserted[0]), attachment };
}

// ----- the web chat (inside a support ticket)

/** The open chat of a ticket, started now when there is none (an urgent matter: the owner is alerted). */
export async function startWebConversation(input: { organizationId: string; userId: string; ticketId: string; userName: string; /** A chat ticket: the chat opens now with the customer's first message, so the owner sees it at once. */ opening?: { message: string }; /** The customer's WhatsApp (digits with 55): the owner's replies are mirrored there and what it answers comes back here. */ contactPhone?: string | null }) {
  const existing = await sql`SELECT id FROM livechat_conversations WHERE ticket_id = ${input.ticketId} AND channel = 'web' AND status = 'open'`;
  if (existing[0]) return getConversation(String(existing[0].id));

  const created = await sql`
    INSERT INTO livechat_conversations (channel, organization_id, ticket_id, user_id, contact_name, contact_phone, urgent)
    VALUES ('web', ${input.organizationId}, ${input.ticketId}, ${input.userId}, ${input.userName}, ${input.contactPhone ?? null}, TRUE)
    ON CONFLICT (ticket_id) WHERE channel = 'web' AND status = 'open' DO NOTHING
    RETURNING id
  `;
  const id = created[0] ? String(created[0].id) : String((await sql`SELECT id FROM livechat_conversations WHERE ticket_id = ${input.ticketId} AND channel = 'web' AND status = 'open'`)[0].id);
  if (created[0]) {
    await addMessage({ conversationId: id, direction: 'in', kind: 'system', body: 'Chat ao vivo iniciado pelo cliente.' });
    if (input.opening) await addMessage({ conversationId: id, direction: 'in', senderName: input.userName, body: cleanMessage(input.opening.message) });
  }
  return getConversation(id);
}

/** The customer's side of the web chat: the conversation of this ticket (open, or the last one) and who may see it. */
export async function findWebConversation(ticketId: string): Promise<Conversation | null> {
  const rows = await sql.query(`SELECT ${COLUMNS} FROM ${FROM} WHERE c.ticket_id = $1 AND c.channel = 'web' ORDER BY (c.status = 'open') DESC, c.created_at DESC LIMIT 1`, [ticketId]);
  return rows[0] ? serializeConversation(rows[0]) : null;
}

/** A message from the customer in the web chat; alerts the owner on WhatsApp at most once per window. */
/** The rules every message from the customer passes: an ended chat stays ended, and not too many in a minute. */
export async function assertCustomerMayWrite(conversation: Conversation) {
  // An ended chat is over (like a finished Omni-Channel session): a new one is started, the old one is not reopened by the customer.
  if (conversation.status === 'closed') throw new PlatformError('Este chat foi encerrado. Para falar com a equipe de novo, inicie um novo chat ao vivo.', 409);
  const recent = await sql`SELECT COUNT(*)::int AS total FROM livechat_messages WHERE conversation_id = ${conversation.id} AND direction = 'in' AND kind <> 'system' AND created_at > NOW() - interval '1 minute'`;
  if (Number(recent[0].total) >= MAX_CUSTOMER_MESSAGES_PER_MINUTE) throw new PlatformError('Muitas mensagens em pouco tempo. Aguarde um instante.', 429);
}

/** A message from the customer in the web chat (the route alerts the owner). */
export async function sendCustomerMessage(conversation: Conversation, userName: string, rawText: unknown) {
  const text = cleanMessage(rawText);
  if (!text) throw new PlatformError('Escreva a mensagem.');
  await assertCustomerMayWrite(conversation);
  return addMessage({ conversationId: conversation.id, direction: 'in', senderName: userName, body: text });
}

/** A file from the customer (with an optional text), kept in the company's own storage: it counts against the plan. */
export async function sendCustomerAttachment(conversation: Conversation, userName: string, rawText: unknown, file: SavedFile) {
  await assertCustomerMayWrite(conversation);
  return addMessage({
    conversationId: conversation.id,
    direction: 'in',
    senderName: userName,
    body: cleanMessage(rawText),
    attachment: { ...file, organizationId: conversation.organizationId, counted: true },
  });
}

/** One stored file with where it belongs, for the routes that serve it (null when it does not exist). */
export async function getAttachment(id: string) {
  if (!isUuid(id)) return null;
  const rows = await sql`
    SELECT a.id, a.conversation_id, a.organization_id, a.file_name, a.content_type, a.file_size, a.url, c.ticket_id
    FROM livechat_attachments a JOIN livechat_conversations c ON c.id = a.conversation_id
    WHERE a.id = ${id}
  `;
  const row = rows[0];
  return row
    ? { id: String(row.id), conversationId: String(row.conversation_id), organizationId: (row.organization_id as string | null) ?? null, ticketId: (row.ticket_id as string | null) ?? null, fileName: String(row.file_name), contentType: String(row.content_type), size: Number(row.file_size), url: String(row.url) }
    : null;
}

/** The customer's WhatsApp on a web chat: set (digits with 55) or removed (null). */
export async function setConversationPhone(id: string, phone: string | null) {
  await sql`UPDATE livechat_conversations SET contact_phone = ${phone} WHERE id = ${id} AND channel = 'web'`;
  return getConversation(id);
}

/** The owner's message got its WhatsApp id: the echo that comes back through the webhook will be recognized. */
export async function attachWaId(messageId: string, waId: string) {
  try {
    await sql`UPDATE livechat_messages SET wa_message_id = ${waId} WHERE id = ${messageId} AND wa_message_id IS NULL`;
  } catch {
    /* the echo was stored first: already counted once */
  }
}

/** The customer closes the chat (the ticket stays). */
export async function closeConversation(id: string, by: 'customer' | 'owner') {
  const closed = await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW(), unread_owner = 0 WHERE id = ${id} AND status = 'open' RETURNING id, ticket_id`;
  if (closed[0]) {
    await addMessage({ conversationId: id, direction: by === 'owner' ? 'out' : 'in', kind: 'system', body: by === 'owner' ? 'Conversa encerrada pelo suporte.' : 'Conversa encerrada pelo cliente.' });
    // The chat is the whole attendance of its ticket: ending it concludes the ticket.
    if (closed[0].ticket_id) await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW(), updated_at = NOW() WHERE id = ${closed[0].ticket_id} AND status NOT IN ('resolved', 'not_reproduced')`;
  }
  return getConversation(id);
}

export async function reopenConversation(id: string) {
  const opened = await sql`UPDATE livechat_conversations SET status = 'open', closed_at = NULL WHERE id = ${id} RETURNING ticket_id`;
  if (opened[0]?.ticket_id) await sql`UPDATE bug_reports SET status = 'investigating', resolved_at = NULL, updated_at = NOW() WHERE id = ${opened[0].ticket_id} AND status IN ('resolved', 'not_reproduced')`;
  return getConversation(id);
}

export async function setUrgent(id: string, urgent: boolean) {
  await sql`UPDATE livechat_conversations SET urgent = ${urgent} WHERE id = ${id}`;
  return getConversation(id);
}

// ----- the owner's answers

/** The owner's message, stored once it has been delivered (the WhatsApp channel passes how it was sent). */
export async function storeOwnerMessage(conversationId: string, text: string, options: { senderName?: string; waMessageId?: string | null; silent?: boolean; autoKey?: string | null } = {}) {
  return addMessage({ conversationId, direction: 'out', senderName: options.senderName ?? SUPPORT_SENDER, body: text, waMessageId: options.waMessageId ?? null, silent: options.silent, autoKey: options.autoKey ?? null });
}

/** The team's file (with an optional text): kept in the company's folder but not charged to its plan. */
export async function storeOwnerAttachment(conversationId: string, organizationId: string | null, text: string, file: SavedFile, options: { waMessageId?: string | null } = {}) {
  return addMessage({ conversationId, direction: 'out', senderName: SUPPORT_SENDER, body: text, waMessageId: options.waMessageId ?? null, attachment: { ...file, organizationId, counted: false } });
}

// ----- the WhatsApp channel

/** Who a number belongs to: a technician or a company of the platform (null when nobody knows it). */
export async function matchContact(phone: string): Promise<{ organizationId: string; name: string } | null> {
  const tail = phone.replace(/\D/g, '').slice(-8);
  const technicians = await sql`
    SELECT organization_id, name, phone FROM technicians
    WHERE deleted_at IS NULL AND phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE ${`%${tail}`}
    LIMIT 20
  `;
  const technician = technicians.find((row) => samePhone(String(row.phone), phone));
  if (technician) return { organizationId: String(technician.organization_id), name: String(technician.name) };
  const organizations = await sql`
    SELECT id, name, phone FROM organizations
    WHERE deleted_at IS NULL AND phone IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE ${`%${tail}`}
    LIMIT 20
  `;
  const organization = organizations.find((row) => samePhone(String(row.phone), phone));
  return organization ? { organizationId: String(organization.id), name: String(organization.name) } : null;
}

/** The open WhatsApp conversation with a number, opened now when there is none. */
export async function openWhatsAppConversation(phone: string, name: string | null) {
  const found = await sql`SELECT id, contact_name FROM livechat_conversations WHERE channel = 'whatsapp' AND contact_phone = ${phone} AND status = 'open'`;
  if (found[0]) {
    if (name && !found[0].contact_name) await sql`UPDATE livechat_conversations SET contact_name = ${name} WHERE id = ${found[0].id}`;
    return String(found[0].id);
  }
  const known = await matchContact(phone);
  const created = await sql`
    INSERT INTO livechat_conversations (channel, organization_id, contact_phone, contact_name)
    VALUES ('whatsapp', ${known?.organizationId ?? null}, ${phone}, ${name ?? known?.name ?? null})
    ON CONFLICT (contact_phone) WHERE channel = 'whatsapp' AND status = 'open' DO NOTHING
    RETURNING id
  `;
  if (created[0]) return String(created[0].id);
  return String((await sql`SELECT id FROM livechat_conversations WHERE channel = 'whatsapp' AND contact_phone = ${phone} AND status = 'open'`)[0].id);
}

/** The open web chat whose customer gave this WhatsApp number (null when there is none). */
export async function findOpenWebConversationByPhone(phone: string): Promise<string | null> {
  const rows = await sql`
    SELECT id, contact_phone FROM livechat_conversations
    WHERE channel = 'web' AND status = 'open' AND contact_phone IS NOT NULL AND contact_phone LIKE ${`%${phoneTail(phone)}`}
    ORDER BY last_message_at DESC LIMIT 10
  `;
  const match = rows.find((row) => samePhone(String(row.contact_phone), phone));
  return match ? String(match.id) : null;
}

/**
 * A message that came through the WhatsApp webhook: the customer's, or one the owner typed on the phone itself. When the number
 * belongs to an open web chat (the customer gave it for the urgent ticket) it goes into that chat; otherwise it is a WhatsApp
 * conversation of its own.
 */
export async function storeWhatsAppMessage(message: InboundMessage) {
  const web = await findOpenWebConversationByPhone(message.phone);
  if (web) {
    // What the panel mirrored to this number is already in the chat: its echo is not a new message.
    if (message.fromMe && isMirroredText(message.text)) return null;
    return addMessage({
      conversationId: web,
      direction: message.fromMe ? 'out' : 'in',
      senderName: message.fromMe ? null : message.name,
      body: message.text,
      kind: message.media ? 'media' : 'text',
      waMessageId: message.waId,
      at: message.at,
    });
  }
  const conversationId = await openWhatsAppConversation(message.phone, message.fromMe ? null : message.name);
  return addMessage({
    conversationId,
    direction: message.fromMe ? 'out' : 'in',
    senderName: message.fromMe ? null : message.name,
    body: message.text,
    kind: message.media ? 'media' : 'text',
    waMessageId: message.waId,
    at: message.at,
  });
}
