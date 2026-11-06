import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from '../db';
import { sendOwnerAlert } from '../platform/alerts';
import { formatTicketNumber } from '../reports';
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  fetchEvolutionInstance,
  logoutEvolutionInstance,
  sendEvolutionMedia,
  sendEvolutionText,
  setEvolutionWebhook,
  type EvolutionQrCode,
} from '../whatsapp/evolution';
import { evolutionServer } from '../whatsapp/store';
import { PlatformError } from '../platform/errors';
import { getSupportContact } from '../support-contact';
import { AUTO_SENDS_PER_HOUR, AWAY_REPEAT_HOURS, describeHours, firstName, isWithinBusinessHours, MEDIA_REPEAT_HOURS, planInboundReplies, renderAutoMessage, ticketVariable, type AutoKey } from './auto-messages';
import { getAutoMessage, loadAutoMessages } from './auto-store';
import { mirroredText, ownerAlertKey, previewOf, type InboundMessage } from './rules';
import { saveChatFile } from './files';
import { attachWaId, closeConversation, getConversation, storeOwnerAttachment, storeOwnerMessage, type Conversation } from './store';

/**
 * The platform's official WhatsApp number (the live chat inbox). Its own instance on the shared Evolution server, separate from
 * the owner's alerts one (`nextrotta-alertas`) and from every company's. The instance is created by "Conectar", from the
 * panel, together with the webhook that brings the incoming messages to /api/webhooks/evolution.
 */
export const LIVECHAT_INSTANCE = 'nextrotta-suporte';

export type LivechatWhatsAppStatus = {
  serverConfigured: boolean;
  instanceName: string;
  created: boolean;
  state: 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown';
  /** Connected number (digits), when connected. */
  number: string | null;
  /** The address Evolution delivers messages to, or null when the app has no public address (local development). */
  webhookUrl: string | null;
  error: string | null;
};

/** A secret derived from JWT_SECRET (never stored, never sent anywhere else): proves a webhook call comes from our instance. */
export function webhookToken(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return createHmac('sha256', secret).update('evolution-webhook:livechat').digest('hex');
}

export function webhookTokenMatches(received: string | null): boolean {
  if (!received) return false;
  const expected = Buffer.from(webhookToken());
  const given = Buffer.from(received);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Where Evolution must call us: the public address of the app (none on a local *.localhost domain). */
export function webhookUrl(): string | null {
  const root = process.env.ROOT_DOMAIN?.trim().toLowerCase();
  if (!root || root.includes('localhost')) return null;
  return `https://${root}/api/webhooks/evolution`;
}

function requireServer() {
  const server = evolutionServer();
  if (!server) throw new PlatformError('Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.', 503);
  return server;
}

export async function getLivechatWhatsAppStatus(): Promise<LivechatWhatsAppStatus> {
  const server = evolutionServer();
  const base = { serverConfigured: Boolean(server), instanceName: LIVECHAT_INSTANCE, webhookUrl: webhookUrl() };
  if (!server) return { ...base, created: false, state: 'unknown', number: null, error: 'Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.' };

  const info = await fetchEvolutionInstance(server, LIVECHAT_INSTANCE);
  if (info.error) return { ...base, created: false, state: 'unknown', number: null, error: info.error };
  if (!info.exists) return { ...base, created: false, state: 'not_created', number: null, error: null };
  const state = info.state === 'open' ? 'connected' : info.state === 'connecting' ? 'connecting' : info.state === 'close' ? 'disconnected' : 'unknown';
  return { ...base, created: true, state, number: state === 'connected' ? info.number : null, error: null };
}

/** Creates the instance when it does not exist, points its webhook at the app and returns a QR code to connect the number. */
export async function connectLivechatWhatsApp(): Promise<{ status: LivechatWhatsAppStatus; qr: EvolutionQrCode | null }> {
  const server = requireServer();
  let qr: EvolutionQrCode | null = null;

  const existing = await fetchEvolutionInstance(server, LIVECHAT_INSTANCE);
  if (existing.error) throw new PlatformError(`Não foi possível falar com o servidor do WhatsApp. ${existing.error}`, 502);
  if (!existing.exists) {
    const created = await createEvolutionInstance(server, LIVECHAT_INSTANCE);
    if (!created.ok) throw new PlatformError(`O servidor do WhatsApp recusou a criação da instância. ${created.error ?? ''}`.trim(), 502);
    qr = created.qr;
  }

  // Every time (it is safe to repeat): so a changed address or token is picked up by connecting again.
  const url = webhookUrl();
  if (url) {
    const hook = await setEvolutionWebhook(server, LIVECHAT_INSTANCE, { url, token: webhookToken() });
    if (!hook.ok) throw new PlatformError(`A instância foi criada, mas não consegui configurar o recebimento de mensagens. ${hook.error ?? ''}`.trim(), 502);
  }

  if (!qr?.base64 || !qr.pairingCode) {
    // The number the platform publishes as its official WhatsApp: also gives a pairing code besides the QR.
    const number = (await getSupportContact().catch(() => null))?.whatsapp ?? null;
    const connected = await connectEvolutionInstance(server, LIVECHAT_INSTANCE, number);
    if (!connected.ok) throw new PlatformError(`Não foi possível gerar o QR Code. ${connected.error ?? ''}`.trim(), 502);
    qr = connected.state === 'open' ? null : connected.qr;
  }
  return { status: await getLivechatWhatsAppStatus(), qr };
}

/**
 * A fresh QR code (and pairing code). WhatsApp renews the code every ~20 seconds, so the one on screen goes stale: the panel asks
 * again while the window is open. Does not touch the instance or its webhook.
 */
export async function refreshLivechatQr(): Promise<{ status: LivechatWhatsAppStatus; qr: EvolutionQrCode | null }> {
  const server = requireServer();
  const number = (await getSupportContact().catch(() => null))?.whatsapp ?? null;
  const connected = await connectEvolutionInstance(server, LIVECHAT_INSTANCE, number);
  if (!connected.ok) throw new PlatformError(`Não foi possível gerar o QR Code. ${connected.error ?? ''}`.trim(), 502);
  return { status: await getLivechatWhatsAppStatus(), qr: connected.state === 'open' ? null : connected.qr };
}

export async function disconnectLivechatWhatsApp(): Promise<LivechatWhatsAppStatus> {
  const server = requireServer();
  const result = await logoutEvolutionInstance(server, LIVECHAT_INSTANCE);
  if (!result.ok) throw new PlatformError(`Não foi possível desconectar. ${result.error ?? ''}`.trim(), 502);
  return getLivechatWhatsAppStatus();
}

export type ReplyResult = {
  message: Awaited<ReturnType<typeof storeOwnerMessage>>;
  /** 'sent' went through WhatsApp too; 'failed' was stored in the chat but WhatsApp refused it; 'skipped' had no WhatsApp to use. */
  whatsapp: 'sent' | 'failed' | 'skipped';
  whatsappError?: string;
};

/**
 * The owner's answer in a conversation. A WhatsApp conversation is sent through the instance first and stored only when WhatsApp
 * accepted it. A web chat is stored first (the customer's window reads it) and, when the customer gave a WhatsApp number, also
 * mirrored there ("*Suporte NextRotta* — chamado #…"); a failure of the mirror never loses the reply. The WhatsApp id of what was
 * sent is kept so the echo that comes back through the webhook counts once.
 */
export async function sendOwnerReply(conversationId: string, text: string, options: { mirror?: boolean } = {}): Promise<ReplyResult> {
  const conversation = await getConversation(conversationId);

  if (conversation.channel === 'web') {
    const message = await storeOwnerMessage(conversationId, text);
    if (!conversation.contactPhone || options.mirror === false) return { message, whatsapp: 'skipped' };
    const server = evolutionServer();
    if (!server) return { message, whatsapp: 'failed', whatsappError: 'Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.' };
    const sent = await sendEvolutionText({ ...server, instance: LIVECHAT_INSTANCE }, conversation.contactPhone, mirroredText(conversation.ticketNumber, text));
    if (!sent.ok) return { message, whatsapp: 'failed', whatsappError: sent.error ?? 'Confira a conexão do WhatsApp.' };
    if (sent.messageId && message) await attachWaId(message.id, sent.messageId);
    return { message, whatsapp: 'sent' };
  }

  const server = requireServer();
  if (!conversation.contactPhone) throw new PlatformError('Esta conversa não tem um número de WhatsApp.', 409);
  const sent = await sendEvolutionText({ ...server, instance: LIVECHAT_INSTANCE }, conversation.contactPhone, text);
  if (!sent.ok) throw new PlatformError(`A mensagem não foi enviada. ${sent.error ?? 'Confira a conexão do WhatsApp.'}`, 502);
  return { message: await storeOwnerMessage(conversationId, text, { senderName: undefined, waMessageId: sent.messageId ?? null }), whatsapp: 'sent' };
}

/**
 * Ends a conversation with a thank-you ("Obrigado pelo seu contato…"), so the customer is not left hanging: the message is
 * stored in the chat and, on WhatsApp (or when the customer gave a number), sent there too. A WhatsApp failure never stops the end.
 * `thanks` null ends it without a message.
 */
export async function endConversation(conversationId: string, by: 'owner' | 'customer', thanks: string | null) {
  const conversation = await getConversation(conversationId);
  let whatsapp: 'sent' | 'failed' | 'skipped' = 'skipped';
  let whatsappError: string | undefined;
  if (conversation.status === 'open' && thanks) {
    try {
      const reply = await sendOwnerReply(conversationId, thanks);
      whatsapp = reply.whatsapp;
      whatsappError = reply.whatsappError;
    } catch (error) {
      whatsapp = 'failed';
      whatsappError = error instanceof Error ? error.message : String(error);
    }
  }
  const ended = await closeConversation(conversationId, by);
  return { conversation: ended, whatsapp, whatsappError };
}

// ------------------------------------------------------------------------------------------------------------------ attachments

/** Sends a file to a WhatsApp number through the official number (base64), with the caption the customer will read. */
async function sendFileToWhatsApp(phone: string, file: { buffer: Buffer; fileName: string; contentType: string }, caption: string) {
  const server = evolutionServer();
  if (!server) return { ok: false as const, error: 'Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.', messageId: null };
  const sent = await sendEvolutionMedia({ ...server, instance: LIVECHAT_INSTANCE }, phone, { base64: file.buffer.toString('base64'), mimetype: file.contentType, fileName: file.fileName, caption });
  return { ok: sent.ok, error: sent.error, messageId: sent.messageId ?? null };
}

/**
 * The team sends a file (a screenshot, a PDF) in a conversation. It is kept in the folder of the company the chat belongs to (not
 * charged to it), shown in the chat, and sent to the customer's WhatsApp too when there is one (and "mirror" is not turned off).
 * On a WhatsApp conversation WhatsApp must accept it first.
 */
export async function sendOwnerAttachment(conversationId: string, file: { buffer: Buffer; fileName: string | null; contentType: string }, text: string, options: { mirror?: boolean } = {}) {
  const conversation = await getConversation(conversationId);
  const saved = await saveChatFile({ organizationId: conversation.organizationId, conversationId, fileName: file.fileName, contentType: file.contentType, buffer: file.buffer });
  const toPhone = conversation.contactPhone && (conversation.channel === 'whatsapp' || options.mirror !== false) ? conversation.contactPhone : null;

  let whatsapp: 'sent' | 'failed' | 'skipped' = 'skipped';
  let whatsappError: string | undefined;
  let waId: string | null = null;
  if (toPhone) {
    const sent = await sendFileToWhatsApp(toPhone, { buffer: file.buffer, fileName: saved.fileName, contentType: saved.contentType }, conversation.channel === 'web' ? mirroredText(conversation.ticketNumber, text) : text);
    if (sent.ok) {
      whatsapp = 'sent';
      waId = sent.messageId;
    } else if (conversation.channel === 'whatsapp') {
      throw new PlatformError(`O arquivo não foi enviado. ${sent.error ?? 'Confira a conexão do WhatsApp.'}`, 502);
    } else {
      whatsapp = 'failed';
      whatsappError = sent.error ?? undefined;
    }
  }
  const message = await storeOwnerAttachment(conversationId, conversation.organizationId, text, saved, { waMessageId: waId });
  return { message, whatsapp, whatsappError };
}

// ------------------------------------------------------------------------------------------------------- first message and alerts

/** The team's first message in a live chat, stored in the chat at once (it does not move the conversation in the inbox). */
export async function storeChatWelcome(conversation: Conversation, userName: string | null) {
  const text = await getAutoMessage('chat_welcome', { nome: firstName(userName), chamado: ticketVariable(conversation.ticketNumber) });
  if (!text) return null; // the owner turned this message off
  return storeOwnerMessage(conversation.id, text, { silent: true, autoKey: 'chat_welcome' });
}

/** A few welcomes per hour per company may go to a WhatsApp number the customer typed: nobody can use the chat to message strangers. */
const WELCOMES_ON_WHATSAPP_PER_HOUR = 5;

/** The same welcome on the customer's WhatsApp, when they gave a number (slow: Evolution is called, so it runs after the answer). */
export async function mirrorChatWelcome(conversation: Conversation, userName: string | null): Promise<'sent' | 'failed' | 'skipped'> {
  try {
    if (!conversation.contactPhone) return 'skipped';
    const recent = await sql`SELECT COUNT(*)::int AS n FROM livechat_conversations WHERE organization_id = ${conversation.organizationId} AND channel = 'web' AND contact_phone IS NOT NULL AND created_at > NOW() - interval '1 hour'`;
    if (Number(recent[0].n) > WELCOMES_ON_WHATSAPP_PER_HOUR) return 'skipped';
    const text = await getAutoMessage('chat_welcome_whatsapp', { nome: firstName(userName), chamado: ticketVariable(conversation.ticketNumber) });
    if (!text) return 'skipped'; // the owner turned this message off
    const server = evolutionServer();
    if (!server) return 'failed';
    const sent = await sendEvolutionText({ ...server, instance: LIVECHAT_INSTANCE }, conversation.contactPhone, mirroredText(conversation.ticketNumber, text));
    return sent.ok ? 'sent' : 'failed';
  } catch (error) {
    console.error('[livechat] welcome on WhatsApp failed:', error);
    return 'failed';
  }
}

/**
 * Tells the owner a customer is waiting: once per conversation and window, never throws. Through the alerts WhatsApp when it is
 * configured; otherwise through the official number itself (a message to itself, which shows on the phone that holds it).
 */
export async function alertOwnerOfChat(conversation: Conversation, userName: string, text: string) {
  try {
    const result = await sendOwnerAlert({
      key: ownerAlertKey(conversation.id),
      kind: 'livechat',
      title: `Chat ao vivo${conversation.urgent ? ' (urgente)' : ''}`,
      lines: [`${conversation.organizationName ?? 'Cliente'} — ${userName}`, conversation.ticketNumber ? `Chamado ${formatTicketNumber(conversation.ticketNumber)}` : 'Sem chamado', `“${previewOf(text, 140)}”`],
      organizationIds: conversation.organizationId ? [conversation.organizationId] : [],
    });
    if (result.sent || result.duplicate) return;

    const server = evolutionServer();
    const own = (await getSupportContact().catch(() => null))?.whatsapp;
    if (!server || !own) return;
    const root = process.env.ROOT_DOMAIN?.trim();
    const link = root && !root.includes('localhost') ? `\n\nResponda no painel: https://${root}/plataforma/reports?chat=${conversation.id}` : '';
    await sendEvolutionText(
      { ...server, instance: LIVECHAT_INSTANCE },
      own,
      `${ALERT_PREFIX} Livechat${conversation.urgent ? ' (urgente)' : ''}*\n${conversation.organizationName ?? 'Cliente'} — ${userName}\n${conversation.ticketNumber ? `Chamado ${formatTicketNumber(conversation.ticketNumber)}\n` : ''}“${previewOf(text, 140)}”${link}`,
    );
  } catch (error) {
    console.error('[livechat] owner alert failed:', error);
  }
}

/** What starts the alert the official number sends to itself (its echo through the webhook is ignored). */
export const ALERT_PREFIX = '🚨 *NextRotta —';

// ------------------------------------------------------------------------------------------- automatic replies on WhatsApp

/** Sends one automatic message to the customer's WhatsApp and keeps it in the conversation, marked as automatic. */
async function sendAutoReply(conversationId: string, phone: string, key: AutoKey, text: string): Promise<boolean> {
  const server = evolutionServer();
  if (!server) return false;
  const sent = await sendEvolutionText({ ...server, instance: LIVECHAT_INSTANCE }, phone, text);
  if (!sent.ok) return false;
  // Silent: an automatic answer must not make the conversation look attended (unread and preview stay as the customer left them).
  await storeOwnerMessage(conversationId, text, { silent: true, autoKey: key, waMessageId: sent.messageId ?? null });
  return true;
}

/**
 * The automatic replies to a message the customer just sent on WhatsApp (a greeting for a new conversation, the away notice
 * outside the hours, a note about a photo or audio). Never throws, and never answers: the team's own messages, a number that is in
 * a web chat (it has its own welcome), or anything once the hourly ceiling of automatic messages is reached. Returns what was sent.
 */
export async function autoReplyToInbound(message: InboundMessage, storedMessageId: string, now: Date = new Date()): Promise<AutoKey[]> {
  if (message.fromMe) return [];
  try {
    const rows = await sql`
      SELECT m.conversation_id, c.channel, c.contact_phone, c.contact_name
      FROM livechat_messages m JOIN livechat_conversations c ON c.id = m.conversation_id
      WHERE m.id = ${storedMessageId}
    `;
    const row = rows[0];
    if (!row || row.channel !== 'whatsapp' || !row.contact_phone) return [];
    const conversationId = String(row.conversation_id);

    const { messages, hours } = await loadAutoMessages();
    const enabled = (key: AutoKey) => Boolean(messages.find((entry) => entry.key === key)?.enabled);
    if (!enabled('whatsapp_greeting') && !enabled('whatsapp_away') && !enabled('whatsapp_media')) return [];

    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM livechat_messages WHERE conversation_id = ${conversationId} AND direction = 'in') AS inbound,
        (SELECT COUNT(*)::int FROM livechat_messages WHERE conversation_id = ${conversationId} AND auto_key = 'whatsapp_away' AND created_at > NOW() - make_interval(hours => ${AWAY_REPEAT_HOURS})) AS away,
        (SELECT COUNT(*)::int FROM livechat_messages WHERE conversation_id = ${conversationId} AND auto_key = 'whatsapp_media' AND created_at > NOW() - make_interval(hours => ${MEDIA_REPEAT_HOURS})) AS media,
        (SELECT COUNT(*)::int FROM livechat_messages m2 JOIN livechat_conversations c2 ON c2.id = m2.conversation_id WHERE c2.channel = 'whatsapp' AND m2.auto_key IS NOT NULL AND m2.created_at > NOW() - interval '1 hour') AS last_hour
    `;
    let budget = AUTO_SENDS_PER_HOUR - Number(counts.last_hour);
    if (budget <= 0) return [];

    const plan = planInboundReplies({
      first: Number(counts.inbound) === 1,
      media: message.media,
      withinHours: isWithinBusinessHours(hours, now),
      enabled: { whatsapp_greeting: enabled('whatsapp_greeting'), whatsapp_away: enabled('whatsapp_away'), whatsapp_media: enabled('whatsapp_media') },
      awayRecently: Number(counts.away) > 0,
      mediaRecently: Number(counts.media) > 0,
    });

    const name = firstName((row.contact_name as string | null) ?? message.name);
    const sent: AutoKey[] = [];
    for (const key of plan) {
      if (budget <= 0) break;
      const entry = messages.find((candidate) => candidate.key === key)!;
      const text = renderAutoMessage(entry.text, { nome: name, horario: describeHours(hours) });
      if (await sendAutoReply(conversationId, String(row.contact_phone), key, text)) {
        sent.push(key);
        budget -= 1;
      }
    }
    return sent;
  } catch (error) {
    console.error('[livechat] automatic reply failed:', error);
    return [];
  }
}
