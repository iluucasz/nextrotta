// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { sql } from '../db';
import {
  connectEvolutionInstance,
  createEvolutionInstance,
  fetchEvolutionInstance,
  logoutEvolutionInstance,
  sendEvolutionText,
  type EvolutionQrCode,
} from '../whatsapp/evolution';
import { evolutionServer } from '../whatsapp/store';
import { PlatformError } from './errors';
import { getPlatformSettings } from './settings';

/**
 * Alerts for the platform owner: problems no organization can fix on its own (the Porto portal
 * changed its screens, a stuck run, the night queue running late, the VPS). Sent by WhatsApp through
 * the platform's own Evolution instance (never an organization's) and kept in platform_alerts, whose
 * key makes each incident alert once — also across worker restarts. Never throws.
 */

export type OwnerAlertKind = 'porto_layout' | 'porto_stuck' | 'porto_queue_late' | 'vps' | 'worker' | 'ai_balance';

/** Fixed name of the platform's instance on the shared Evolution server (reserved as a subdomain). */
export const PLATFORM_ALERTS_INSTANCE = 'nextrotta-alertas';

export async function sendOwnerAlert(input: {
  key: string;
  kind: OwnerAlertKind;
  title: string;
  lines: string[];
  organizationIds?: string[];
}): Promise<{ sent: boolean; duplicate?: boolean; reason?: string }> {
  try {
    const body = input.lines.slice(0, 15).map((line) => `• ${line}`).join('\n') + (input.lines.length > 15 ? `\n• … e mais ${input.lines.length - 15}` : '');
    const claimed = await sql`
      INSERT INTO platform_alerts (key, kind, title, body, organization_ids)
      VALUES (${input.key}, ${input.kind}, ${input.title}, ${body}, ${input.organizationIds ?? []}::uuid[])
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `;
    if (!claimed.length) return { sent: false, duplicate: true };

    const reason = await deliver(`🚨 *NextRotta — plataforma*: ${input.title}\n\n${body}\n\nDetalhes no painel do dono → Operação.`);
    await sql`
      UPDATE platform_alerts
      SET sent_at = ${reason ? null : new Date().toISOString()}, error = ${reason}
      WHERE key = ${input.key}
    `;
    if (reason) console.error('[platform-alerts] not sent:', input.key, reason);
    return reason ? { sent: false, reason } : { sent: true };
  } catch (error) {
    console.error('[platform-alerts] error:', error);
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Sends the text to the owner's alert number; returns why it couldn't, or null when sent. */
async function deliver(text: string): Promise<string | null> {
  const settings = await getPlatformSettings();
  const server = evolutionServer();
  if (!settings.alerts.phone) return 'Nenhum WhatsApp de alertas da plataforma configurado.';
  if (!server) return 'Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.';
  if (!settings.alerts.instanceName) return 'O WhatsApp de alertas da plataforma ainda não foi conectado.';
  const result = await sendEvolutionText({ ...server, instance: settings.alerts.instanceName }, settings.alerts.phone, text);
  return result.ok ? null : result.error ?? 'Falha ao enviar.';
}

export async function listOwnerAlerts(limit = 50) {
  const rows = await sql`
    SELECT key, kind, title, body, organization_ids, created_at, sent_at, error
    FROM platform_alerts
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
  return rows.map((row) => ({
    key: String(row.key),
    kind: String(row.kind),
    title: String(row.title),
    body: String(row.body),
    organizationIds: (row.organization_ids as string[] | null) ?? [],
    createdAt: new Date(row.created_at as string).toISOString(),
    sentAt: row.sent_at ? new Date(row.sent_at as string).toISOString() : null,
    error: (row.error as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------------------------
// The platform's own WhatsApp instance (connected by the owner reading a QR code)
// ---------------------------------------------------------------------------------------------

export interface AlertsWhatsAppStatus {
  serverConfigured: boolean;
  instanceName: string;
  created: boolean;
  state: 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown';
  number: string | null;
  phone: string;
  error: string | null;
}

function requireServer() {
  const server = evolutionServer();
  if (!server) throw new PlatformError('Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.', 503);
  return server;
}

async function saveInstanceName(instanceName: string) {
  await sql`
    UPDATE platform_settings
    SET data = jsonb_set(data, '{alerts}', COALESCE(data->'alerts', '{}'::jsonb) || jsonb_build_object('instanceName', ${instanceName}::text)),
        updated_at = NOW()
    WHERE id
  `;
}

export async function getAlertsWhatsAppStatus(): Promise<AlertsWhatsAppStatus> {
  const settings = await getPlatformSettings();
  const server = evolutionServer();
  const base = { serverConfigured: Boolean(server), instanceName: PLATFORM_ALERTS_INSTANCE, phone: settings.alerts.phone };
  if (!settings.alerts.instanceName) return { ...base, created: false, state: 'not_created', number: null, error: null };
  if (!server) return { ...base, created: true, state: 'unknown', number: null, error: 'Servidor do WhatsApp não configurado.' };

  const info = await fetchEvolutionInstance(server, settings.alerts.instanceName);
  if (info.error) return { ...base, created: true, state: 'unknown', number: null, error: info.error };
  if (!info.exists) {
    await saveInstanceName('');
    return { ...base, created: false, state: 'not_created', number: null, error: null };
  }
  const state = info.state === 'open' ? 'connected' : info.state === 'connecting' ? 'connecting' : info.state === 'close' ? 'disconnected' : 'unknown';
  return { ...base, created: true, state, number: state === 'connected' ? info.number : null, error: null };
}

/** Creates the platform instance (when missing) and returns a QR code to connect it. */
export async function connectAlertsWhatsApp(): Promise<{ status: AlertsWhatsAppStatus; qr: EvolutionQrCode | null }> {
  const server = requireServer();
  const settings = await getPlatformSettings();
  let qr: EvolutionQrCode | null = null;

  if (!settings.alerts.instanceName) {
    const existing = await fetchEvolutionInstance(server, PLATFORM_ALERTS_INSTANCE);
    if (existing.error) throw new PlatformError(`Não foi possível falar com o servidor do WhatsApp. ${existing.error}`, 502);
    if (!existing.exists) {
      const created = await createEvolutionInstance(server, PLATFORM_ALERTS_INSTANCE);
      if (!created.ok) throw new PlatformError(`O servidor do WhatsApp recusou a criação da instância. ${created.error ?? ''}`.trim(), 502);
      qr = created.qr;
    }
    await saveInstanceName(PLATFORM_ALERTS_INSTANCE);
  }

  if (!qr?.base64) {
    const connected = await connectEvolutionInstance(server, PLATFORM_ALERTS_INSTANCE);
    if (!connected.ok) throw new PlatformError(`Não foi possível gerar o QR Code. ${connected.error ?? ''}`.trim(), 502);
    qr = connected.state === 'open' ? null : connected.qr;
  }
  return { status: await getAlertsWhatsAppStatus(), qr };
}

export async function disconnectAlertsWhatsApp(): Promise<AlertsWhatsAppStatus> {
  const server = requireServer();
  const settings = await getPlatformSettings();
  if (!settings.alerts.instanceName) throw new PlatformError('O WhatsApp de alertas ainda não foi conectado.', 409);
  const result = await logoutEvolutionInstance(server, settings.alerts.instanceName);
  if (!result.ok) throw new PlatformError(`Não foi possível desconectar. ${result.error ?? ''}`.trim(), 502);
  return getAlertsWhatsAppStatus();
}
