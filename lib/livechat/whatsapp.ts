import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  fetchEvolutionInstance,
  logoutEvolutionInstance,
  sendEvolutionText,
  setEvolutionWebhook,
  type EvolutionQrCode,
} from '../whatsapp/evolution';
import { evolutionServer } from '../whatsapp/store';
import { PlatformError } from '../platform/errors';
import { getSupportContact } from '../support-contact';
import { mirroredText } from './rules';
import { attachWaId, getConversation, storeOwnerMessage } from './store';

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
