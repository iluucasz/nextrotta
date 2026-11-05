// No dependencies on the database or the framework: used by the routes, the webhook and the tests.

/** Longest message accepted in the chat (the WhatsApp limit is far higher; a chat message is short). */
export const MAX_MESSAGE_LENGTH = 2000;
/** The customer cannot send more than this many messages per minute in one conversation. */
export const MAX_CUSTOMER_MESSAGES_PER_MINUTE = 20;
/** One WhatsApp alert to the owner per conversation in this window, however many messages arrive. */
export const OWNER_ALERT_WINDOW_MS = 10 * 60 * 1000;

export const SUPPORT_SENDER = 'Suporte NextRotta';

/** The thank-you that ends a live chat (the owner can edit it before ending). */
export function chatClosingMessage(channel: 'web' | 'whatsapp'): string {
  const next = channel === 'web' ? 'inicie um novo chat ao vivo ou abra um chamado pelo sistema' : 'escreva de novo para este número ou abra um chamado pelo sistema';
  return `Obrigado pelo seu contato! Foi um prazer ajudar. Estamos encerrando este atendimento, mas, se precisar de mais alguma coisa, é só chamar: ${next}. Até a próxima! 😊`;
}

/** The message that closes a written support case. */
export function caseClosingMessage(ticketNumber: number | null): string {
  return `Olá! Seu chamado${ticketNumber ? ` #${ticketNumber}` : ''} foi encerrado. Agradecemos o seu contato! Se ainda precisar de ajuda, é só abrir um novo chamado pelo sistema que a nossa equipe responde. 😊`;
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
export const INLINE_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']);

export const isImageType = (type: string) => type.startsWith('image/') && type in ATTACHMENT_TYPES;

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
  return base || `arquivo.${ATTACHMENT_TYPES[type] ?? 'bin'}`;
}

/** The line shown in the list for a message that is only a file. */
export const attachmentPreview = (fileName: string) => `📎 ${fileName}`;

// ------------------------------------------------------------------------------------------------------- the first message

/** What the team's first message says when a live chat opens: who answers, that it is coming, and what to do meanwhile. */
export function chatWelcomeMessage(input: { name: string | null; ticketNumber: number | null; channel: 'chat' | 'whatsapp' }): string {
  const first = (input.name ?? '').trim().split(/\s+/)[0];
  const where = input.channel === 'whatsapp' ? 'por aqui, no WhatsApp, e no chat do sistema' : 'por aqui';
  const attach = input.channel === 'whatsapp' ? 'Se tiver um print ou arquivo, pode mandar por aqui mesmo.' : 'Se tiver um print ou arquivo, é só anexar aqui no chat.';
  return `Olá${first ? `, ${first}` : ''}! Recebemos o seu chamado urgente${input.ticketNumber ? ` #${input.ticketNumber}` : ''}. Em instantes um de nossos atendentes vai falar com você ${where}. Enquanto isso, pode ir adiantando os detalhes do que precisa. ${attach} 😊`;
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
