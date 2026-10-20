/**
 * Minimal Evolution API client — plain fetch, no SDK. The server (URL + global key) comes from the
 * EVOLUTION_API_URL / EVOLUTION_API_KEY env vars and is shared by every organization; each
 * organization has its own instance, named after its subdomain.
 * Never throws: every failure comes back as a structured result the caller records in history.
 */

import { normalizePhone } from './phone';

const TIMEOUT_MS = 10_000;

export interface EvolutionConnection {
  apiUrl: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionResult {
  ok: boolean;
  error: string | null;
}

/**
 * Without this, a URL pasted with a trailing slash builds `https://host//message/...`, which the
 * Evolution API answers with a 404 that looks exactly like "instance does not exist".
 */
function baseUrl(connection: EvolutionConnection) {
  return connection.apiUrl.trim().replace(/\/+$/, '');
}

// One set of phone rules for the mask, the API validation and the sends.
export { normalizePhone } from './phone';

async function request(connection: EvolutionConnection, path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(`${baseUrl(connection)}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', apikey: connection.apiKey, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function describeError(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return 'Tempo limite ao chamar a Evolution API.';
  return `Erro ao chamar a Evolution API: ${error instanceof Error ? error.message : String(error)}`;
}

export async function sendEvolutionText(connection: EvolutionConnection, phone: string, text: string): Promise<EvolutionResult> {
  const number = normalizePhone(phone);
  if (!number) return { ok: false, error: 'Telefone inválido para WhatsApp.' };

  try {
    const response = await request(connection, `/message/sendText/${encodeURIComponent(connection.instance)}`, {
      method: 'POST',
      body: JSON.stringify({ number, text }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[whatsapp] Evolution sendText failed:', response.status, body);
      return { ok: false, error: `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }

    return { ok: true, error: null };
  } catch (error) {
    console.error('[whatsapp] Evolution sendText error:', error);
    return { ok: false, error: describeError(error) };
  }
}

export interface EvolutionConnectionState {
  connected: boolean;
  state: string | null;
  error: string | null;
}

/** Manual diagnostics only (the "Testar conexão" button) — never polled (lib/system-status.ts only probes reachability). */
export async function getEvolutionConnectionState(connection: EvolutionConnection): Promise<EvolutionConnectionState> {
  try {
    const response = await request(connection, `/instance/connectionState/${encodeURIComponent(connection.instance)}`, { method: 'GET' });

    if (!response.ok) {
      return { connected: false, state: null, error: `Evolution API respondeu ${response.status}.` };
    }

    const data = (await response.json().catch(() => null)) as { instance?: { state?: string } } | null;
    const state = data?.instance?.state ?? null;

    return { connected: state === 'open', state, error: null };
  } catch (error) {
    return { connected: false, state: null, error: describeError(error) };
  }
}

export interface WhatsAppNumberCheck {
  /** True when Evolution confirms the number has a WhatsApp account. */
  exists: boolean;
  /** WhatsApp's own id for it — may differ from the typed number (e.g. without the 9th digit). */
  jid: string | null;
  error: string | null;
}

/** Asks Evolution whether a number is on WhatsApp (`POST /chat/whatsappNumbers/{instance}`). */
export async function checkWhatsAppNumber(connection: EvolutionConnection, phone: string): Promise<WhatsAppNumberCheck> {
  const number = normalizePhone(phone);
  if (!number) return { exists: false, jid: null, error: 'Telefone inválido.' };

  try {
    const response = await request(connection, `/chat/whatsappNumbers/${encodeURIComponent(connection.instance)}`, {
      method: 'POST',
      body: JSON.stringify({ numbers: [number] }),
    });

    if (!response.ok) {
      return { exists: false, jid: null, error: `Evolution API respondeu ${response.status}.` };
    }

    const data = (await response.json().catch(() => null)) as Array<{ exists?: boolean; jid?: string }> | null;
    const match = Array.isArray(data) ? data[0] : null;

    return { exists: Boolean(match?.exists), jid: match?.jid ?? null, error: null };
  } catch (error) {
    return { exists: false, jid: null, error: describeError(error) };
  }
}

// ---------------------------------------------------------------------------------------------
// Instance lifecycle (one instance per organization, created from the organization's screen)
// ---------------------------------------------------------------------------------------------

/** The shared Evolution server: URL and global key, from the environment only. */
export interface EvolutionServer {
  apiUrl: string;
  apiKey: string;
}

export interface EvolutionQrCode {
  /** data:image/png;base64,... ready for an <img>. */
  base64: string | null;
  /** 8-character code for "connect with phone number" in WhatsApp, when Evolution provides it. */
  pairingCode: string | null;
}

export interface EvolutionInstanceInfo {
  exists: boolean;
  /** open = connected, connecting = waiting for the QR scan, close = disconnected. */
  state: string | null;
  /** Connected number (digits), from the owner JID. */
  number: string | null;
  profileName: string | null;
  error: string | null;
}

const asConnection = (server: EvolutionServer, instance: string): EvolutionConnection => ({ ...server, instance });

function readQr(data: unknown): EvolutionQrCode {
  const source = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const qr = (source.qrcode && typeof source.qrcode === 'object' ? source.qrcode : source) as Record<string, unknown>;
  const base64 = typeof qr.base64 === 'string' && qr.base64 ? qr.base64 : null;
  return {
    base64: base64 && !base64.startsWith('data:') ? `data:image/png;base64,${base64}` : base64,
    pairingCode: typeof qr.pairingCode === 'string' && qr.pairingCode ? qr.pairingCode : null,
  };
}

async function failure(response: Response) {
  const body = await response.text().catch(() => '');
  return `Evolution API respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`;
}

/** Creates the instance (Baileys) and returns its first QR code. */
export async function createEvolutionInstance(server: EvolutionServer, instance: string): Promise<EvolutionResult & { qr: EvolutionQrCode | null }> {
  try {
    const response = await request(asConnection(server, instance), '/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
    });
    if (!response.ok) return { ok: false, error: await failure(response), qr: null };
    return { ok: true, error: null, qr: readQr(await response.json().catch(() => null)) };
  } catch (error) {
    return { ok: false, error: describeError(error), qr: null };
  }
}

/** Looks the instance up on the server (v2 and v1 response shapes). */
export async function fetchEvolutionInstance(server: EvolutionServer, instance: string): Promise<EvolutionInstanceInfo> {
  try {
    const response = await request(asConnection(server, instance), `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`, { method: 'GET' });
    // Some versions answer 404 when the instance doesn't exist.
    if (response.status === 404) return { exists: false, state: null, number: null, profileName: null, error: null };
    if (!response.ok) return { exists: false, state: null, number: null, profileName: null, error: await failure(response) };

    const data = await response.json().catch(() => null);
    const list = (Array.isArray(data) ? data : data ? [data] : []) as Array<Record<string, unknown>>;
    const item = list
      .map((entry) => (entry.instance && typeof entry.instance === 'object' ? { ...entry, ...(entry.instance as Record<string, unknown>) } : entry))
      .find((entry) => (entry.name ?? entry.instanceName) === instance);
    if (!item) return { exists: false, state: null, number: null, profileName: null, error: null };

    const jid = String(item.ownerJid ?? item.owner ?? '');
    const number = jid ? jid.split('@')[0].split(':')[0].replace(/\D/g, '') || null : typeof item.number === 'string' ? item.number : null;
    return {
      exists: true,
      state: String(item.connectionStatus ?? item.status ?? item.state ?? '') || null,
      number,
      profileName: (item.profileName as string | null | undefined) ?? null,
      error: null,
    };
  } catch (error) {
    return { exists: false, state: null, number: null, profileName: null, error: describeError(error) };
  }
}

/** A fresh QR code to connect the instance (Evolution renews it every ~40 seconds). */
export async function connectEvolutionInstance(server: EvolutionServer, instance: string): Promise<EvolutionResult & { qr: EvolutionQrCode | null; state: string | null }> {
  try {
    const response = await request(asConnection(server, instance), `/instance/connect/${encodeURIComponent(instance)}`, { method: 'GET' });
    if (!response.ok) return { ok: false, error: await failure(response), qr: null, state: null };
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const state = (data?.instance as { state?: string } | undefined)?.state ?? null;
    return { ok: true, error: null, qr: state === 'open' ? null : readQr(data), state };
  } catch (error) {
    return { ok: false, error: describeError(error), qr: null, state: null };
  }
}

/** Disconnects the WhatsApp number from the instance (the instance itself stays). */
export async function logoutEvolutionInstance(server: EvolutionServer, instance: string): Promise<EvolutionResult> {
  try {
    const response = await request(asConnection(server, instance), `/instance/logout/${encodeURIComponent(instance)}`, { method: 'DELETE' });
    if (!response.ok) return { ok: false, error: await failure(response) };
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}
