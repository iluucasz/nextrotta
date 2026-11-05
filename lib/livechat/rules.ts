// No dependencies on the database or the framework: used by the routes, the webhook and the tests.

/** Longest message accepted in the chat (the WhatsApp limit is far higher; a chat message is short). */
export const MAX_MESSAGE_LENGTH = 2000;
/** The customer cannot send more than this many messages per minute in one conversation. */
export const MAX_CUSTOMER_MESSAGES_PER_MINUTE = 20;
/** One WhatsApp alert to the owner per conversation in this window, however many messages arrive. */
export const OWNER_ALERT_WINDOW_MS = 10 * 60 * 1000;

export const SUPPORT_SENDER = 'Suporte NextRotta';

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
};

export type ConnectionUpdate = { kind: 'connection'; state: string };

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});

const MEDIA_LABELS: Array<[string, string]> = [
  ['imageMessage', '📷 Imagem'],
  ['videoMessage', '🎞 Vídeo'],
  ['audioMessage', '🎤 Áudio'],
  ['documentMessage', '📄 Documento'],
  ['documentWithCaptionMessage', '📄 Documento'],
  ['stickerMessage', '🙂 Figurinha'],
  ['locationMessage', '📍 Localização'],
  ['contactMessage', '👤 Contato'],
];

/** The text of a WhatsApp message, or a short placeholder for what is not text. */
export function readMessageText(message: unknown): { text: string; media: boolean } | null {
  const content = asObject(message);
  if (typeof content.conversation === 'string' && content.conversation) return { text: content.conversation, media: false };
  const extended = asObject(content.extendedTextMessage);
  if (typeof extended.text === 'string' && extended.text) return { text: extended.text, media: false };

  for (const [key, label] of MEDIA_LABELS) {
    if (key in content) {
      const caption = asObject(content[key]).caption;
      return { text: typeof caption === 'string' && caption ? `${label}: ${caption}` : label, media: true };
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
export function parseEvolutionWebhook(payload: unknown): Array<InboundMessage | ConnectionUpdate> {
  const body = asObject(payload);
  const event = String(body.event ?? '').toLowerCase().replace(/_/g, '.');

  if (event === 'connection.update') {
    const state = String(asObject(body.data).state ?? '');
    return state ? [{ kind: 'connection', state }] : [];
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
