// No dependencies on the database or the framework: used by the routes, the webhook and the tests.
import { autoDefinition, firstName, renderAutoMessage, ticketVariable } from './auto-messages';

/** Longest message accepted in the chat (the WhatsApp limit is far higher; a chat message is short). */
export const MAX_MESSAGE_LENGTH = 2000;
/** The customer cannot send more than this many messages per minute in one conversation. */
export const MAX_CUSTOMER_MESSAGES_PER_MINUTE = 20;
/** One WhatsApp alert to the owner per conversation in this window, however many messages arrive. */
export const OWNER_ALERT_WINDOW_MS = 10 * 60 * 1000;

export const SUPPORT_SENDER = 'Suporte NextRotta';

/** The default thank-you that ends a live chat (the owner can change it in Reports → Mensagens automáticas, or edit it before ending). */
export function chatClosingMessage(channel: 'web' | 'whatsapp'): string {
  return renderAutoMessage(autoDefinition(channel === 'web' ? 'chat_closing_web' : 'chat_closing_whatsapp').defaultText);
}

/** The default message that closes a written support case. */
export function caseClosingMessage(ticketNumber: number | null): string {
  return renderAutoMessage(autoDefinition('case_closing').defaultText, { chamado: ticketVariable(ticketNumber) });
}

// ----------------------------------------------------------------------------------------------------------- attachments

/** Largest file accepted in a chat (a serverless request body on Vercel is limited to 4.5 MB). */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** What can be sent in a chat (never HTML, SVG or anything that runs): type -> the extension used when a file has no name. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/** Types the browser may show in place; anything else is downloaded, never rendered on our origin. */
export const INLINE_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'video/mp4']);

export const isImageType = (type: string) => type.startsWith('image/') && type in ATTACHMENT_TYPES;

/**
 * What a customer may send through WhatsApp (their phone, not our upload box): the types above plus voice notes and videos.
 * Type -> the extension used when WhatsApp gives no file name.
 */
export const WHATSAPP_MEDIA_TYPES: Record<string, string> = {
  ...ATTACHMENT_TYPES,
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
};

/** Largest file taken from WhatsApp (a video of the phone is bigger than what the chat box accepts; it is server to server). */
export const MAX_WHATSAPP_MEDIA_BYTES = 16 * 1024 * 1024;

/** "audio/ogg; codecs=opus" -> "audio/ogg". */
export const baseMime = (mime: string | null | undefined) => String(mime ?? '').split(';')[0].trim().toLowerCase();

export const isAudioType = (type: string) => type.startsWith('audio/') && type in WHATSAPP_MEDIA_TYPES;
export const isVideoType = (type: string) => type.startsWith('video/') && type in WHATSAPP_MEDIA_TYPES;

/** Why a file from WhatsApp is not kept (the message then stays as a notice), or null when it is. */
export function whatsappMediaProblem(file: { type: string; size: number }): string | null {
  if (!file.size) return 'arquivo vazio';
  if (file.size > MAX_WHATSAPP_MEDIA_BYTES) return 'arquivo maior que 16 MB';
  if (!(baseMime(file.type) in WHATSAPP_MEDIA_TYPES)) return `tipo não aceito (${file.type || 'desconhecido'})`;
  return null;
}

// -------------------------------------------------------------------------------------------------- typing and read marks

/** "digitando…" stays on for this long after the last signal (the sender repeats it while the person keeps typing). */
export const TYPING_WINDOW_MS = 6000;

/** The mark under a message the team sent. */
export function receiptOf(message: { deliveredAt: string | null; readAt: string | null }): 'sent' | 'delivered' | 'read' {
  if (message.readAt) return 'read';
  return message.deliveredAt ? 'delivered' : 'sent';
}

/** What the Evolution server says about a message it sent: its WhatsApp status (a word or the protocol's number) -> our mark. */
export function receiptFromEvolutionStatus(status: unknown): 'delivered' | 'read' | null {
  const text = String(status ?? '').toUpperCase();
  if (text === 'READ' || text === 'PLAYED' || text === '4' || text === '5') return 'read';
  if (text === 'DELIVERY_ACK' || text === 'DELIVERED' || text === '3') return 'delivered';
  return null;
}

/** Why a file cannot be sent (in words for the person), or null when it can. */
export function attachmentProblem(file: { type: string; size: number }): string | null {
  if (!file.size) return 'O arquivo está vazio.';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'O arquivo passa de 4 MB. Envie um menor.';
  if (!(file.type in ATTACHMENT_TYPES)) return 'Esse tipo de arquivo não é aceito. Envie uma imagem, PDF, planilha, documento ou texto.';
  return null;
}

/** A file name safe to keep and show: no path, no control characters, not too long; a pasted image with no name gets one. */
export function safeFileName(name: string | null | undefined, type: string): string {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || `arquivo.${WHATSAPP_MEDIA_TYPES[baseMime(type)] ?? 'bin'}`;
}

/** The line shown in the list for a message that is only a file. */
export const attachmentPreview = (fileName: string) => `📎 ${fileName}`;

// ------------------------------------------------------------------------------------------------------- the first message

/** The default first message of the team when a live chat opens: who answers, that it is coming, and what to do meanwhile. */
export function chatWelcomeMessage(input: { name: string | null; ticketNumber: number | null; channel: 'chat' | 'whatsapp' }): string {
  return renderAutoMessage(autoDefinition(input.channel === 'whatsapp' ? 'chat_welcome_whatsapp' : 'chat_welcome').defaultText, { nome: firstName(input.name), chamado: ticketVariable(input.ticketNumber) });
}

/** What starts every reply the owner's panel mirrors to the customer's WhatsApp (so its echo is recognized and not stored twice). */
export const MIRROR_PREFIX = '*Suporte NextRotta*';

/** The owner's reply as the customer receives it on WhatsApp: who it is from and which ticket it is about. */
export function mirroredText(ticketNumber: number | null, text: string): string {
  return `${MIRROR_PREFIX}${ticketNumber ? ` — chamado #${ticketNumber}` : ''}\n${text}`;
}

export const isMirroredText = (text: string) => text.startsWith(MIRROR_PREFIX);

/** The text of a message as stored: trimmed, no more than the limit, and nothing at all is an error for the caller. */
export function cleanMessage(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

/** The line shown in the list of conversations. */
export function previewOf(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The key of the owner's alert: the same conversation alerts once per window, a later message after it alerts again. */
export function ownerAlertKey(conversationId: string, now = Date.now()): string {
  return `livechat:${conversationId}:${Math.floor(now / OWNER_ALERT_WINDOW_MS)}`;
}

// ---------------------------------------------------------------------------------------------------- Evolution webhook

export type InboundMessage = {
  kind: 'message';
  /** Digits with the country code (55...). */
  phone: string;
  name: string | null;
  text: string;
  /** True when the text is a placeholder for a photo, audio, document… that only WhatsApp can open. */
  media: boolean;
  /** Sent from the phone itself (not by the customer). */
  fromMe: boolean;
  waId: string | null;
  at: Date;
  /** What kind of file the message carries (null for text, and for what has no file: a location, a contact). */
  mediaKind: MediaKind | null;
  /** The text the customer wrote with the file, without the placeholder. */
  caption: string;
  fileName: string | null;
  mimetype: string | null;
};

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

export type ConnectionUpdate = { kind: 'connection'; state: string };
/** The customer started or stopped typing (or recording) on WhatsApp. */
export type PresenceUpdate = { kind: 'presence'; phone: string; typing: boolean };
/** WhatsApp delivered or read a message the team sent. */
export type StatusUpdate = { kind: 'status'; waId: string; status: 'delivered' | 'read' };

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});

const MEDIA_LABELS: Array<[string, string, MediaKind | null]> = [
  ['imageMessage', '📷 Imagem', 'image'],
  ['videoMessage', '🎞 Vídeo', 'video'],
  ['audioMessage', '🎤 Áudio', 'audio'],
  ['documentMessage', '📄 Documento', 'document'],
  ['stickerMessage', '🙂 Figurinha', 'sticker'],
  ['locationMessage', '📍 Localização', null],
  ['contactMessage', '👤 Contato', null],
];

export type ReadMessage = { text: string; media: boolean; mediaKind: MediaKind | null; caption: string; fileName: string | null; mimetype: string | null };

/** The text of a WhatsApp message, or a short placeholder for what is not text (with what is needed to fetch the file). */
export function readMessageText(message: unknown): ReadMessage | null {
  let content = asObject(message);
  // A document sent with a caption comes wrapped one level deeper.
  const wrapped = asObject(asObject(content.documentWithCaptionMessage).message);
  if (Object.keys(wrapped).length) content = wrapped;
  if (typeof content.conversation === 'string' && content.conversation) return { text: content.conversation, media: false, mediaKind: null, caption: '', fileName: null, mimetype: null };
  const extended = asObject(content.extendedTextMessage);
  if (typeof extended.text === 'string' && extended.text) return { text: extended.text, media: false, mediaKind: null, caption: '', fileName: null, mimetype: null };

  for (const [key, label, kind] of MEDIA_LABELS) {
    if (key in content) {
      const part = asObject(content[key]);
      const caption = typeof part.caption === 'string' ? part.caption : '';
      return {
        text: caption ? `${label}: ${caption}` : label,
        media: true,
        mediaKind: kind,
        caption,
        fileName: typeof part.fileName === 'string' && part.fileName ? part.fileName : null,
        mimetype: typeof part.mimetype === 'string' && part.mimetype ? part.mimetype : null,
      };
    }
  }
  return null;
}

/** The sender's number from a WhatsApp id such as 5521999999999@s.whatsapp.net (never a group or a status broadcast). */
export function phoneFromJid(jid: unknown): string | null {
  const text = String(jid ?? '');
  if (!text.endsWith('@s.whatsapp.net')) return null;
  const digits = text.split('@')[0].split(':')[0].replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/**
 * What the Evolution webhook says, reduced to what the inbox needs. Accepts the v2 shape (data is the message) and the older
 * one (data is a list). Groups, status broadcasts and events that are not messages give nothing.
 */
export function parseEvolutionWebhook(payload: unknown): Array<InboundMessage | ConnectionUpdate | PresenceUpdate | StatusUpdate> {
  const body = asObject(payload);
  const event = String(body.event ?? '').toLowerCase().replace(/_/g, '.');

  if (event === 'connection.update') {
    const state = String(asObject(body.data).state ?? '');
    return state ? [{ kind: 'connection', state }] : [];
  }

  // Someone is typing: data.presences is { "<jid>": { lastKnownPresence } }.
  if (event === 'presence.update') {
    const presences = asObject(asObject(body.data).presences);
    const found: PresenceUpdate[] = [];
    for (const [jid, value] of Object.entries(presences)) {
      const phone = phoneFromJid(jid);
      if (!phone) continue;
      const presence = String(asObject(value).lastKnownPresence ?? '').toLowerCase();
      found.push({ kind: 'presence', phone, typing: presence === 'composing' || presence === 'recording' });
    }
    return found;
  }

  // Delivered / read of what the team sent (v2: keyId + status; older: key.id + update.status).
  if (event === 'messages.update') {
    const items = Array.isArray(body.data) ? body.data : [body.data];
    const found: StatusUpdate[] = [];
    for (const entry of items) {
      const item = asObject(entry);
      const key = asObject(item.key);
      if ((item.fromMe ?? key.fromMe) === false) continue;
      const waId = [item.keyId, item.messageId, key.id].find((value): value is string => typeof value === 'string' && value.length > 0);
      const status = receiptFromEvolutionStatus(item.status ?? asObject(item.update).status);
      if (waId && status) found.push({ kind: 'status', waId, status });
    }
    return found;
  }

  if (event !== 'messages.upsert') return [];

  const data = Array.isArray(body.data) ? body.data : [body.data];
  const found: InboundMessage[] = [];
  for (const entry of data) {
    const item = asObject(entry);
    const key = asObject(item.key);
    // New WhatsApp accounts may show an internal id (@lid): the real number then comes alongside.
    const phone = phoneFromJid(key.remoteJid) ?? phoneFromJid(key.remoteJidAlt) ?? phoneFromJid(item.senderPn);
    if (!phone) continue;
    const read = readMessageText(item.message);
    if (!read) continue;
    const seconds = Number(item.messageTimestamp);
    found.push({
      kind: 'message',
      phone,
      name: typeof item.pushName === 'string' && item.pushName.trim() ? item.pushName.trim().slice(0, 120) : null,
      text: read.text.slice(0, MAX_MESSAGE_LENGTH),
      media: read.media,
      fromMe: key.fromMe === true,
      waId: typeof key.id === 'string' && key.id ? key.id : null,
      at: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
      mediaKind: read.mediaKind,
      caption: read.caption.slice(0, MAX_MESSAGE_LENGTH),
      fileName: read.fileName,
      mimetype: read.mimetype,
    });
  }
  return found;
}

/** Last 8 digits: what two spellings of the same number (with or without the ninth digit) share. */
export function phoneTail(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '').slice(-8);
}

/** Do two numbers written differently ("(21) 99779-2422", "5521997792422", "2197792422") point at the same phone? */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = String(a ?? '').replace(/\D/g, '');
  const right = String(b ?? '').replace(/\D/g, '');
  if (left.length < 8 || right.length < 8) return false;
  if (phoneTail(left) !== phoneTail(right)) return false;
  // The area code decides between two numbers that end alike (when both carry one).
  const area = (digits: string) => (digits.length >= 12 ? digits.slice(2, 4) : digits.length >= 10 ? digits.slice(0, 2) : null);
  const first = area(left);
  const second = area(right);
  return !first || !second || first === second;
}
