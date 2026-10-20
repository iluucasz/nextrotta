import { organizationHasFeature } from './billing/entitlements';
import { sql } from './db';
import { evolutionServer } from './whatsapp/store';

/**
 * Whether the VPS modules answer: the Porto worker and the WhatsApp server (Evolution API) both live
 * on the VPS. When it's down nothing there can raise an alarm, so the app checks from Vercel and
 * shows each organization's admin which modules are under maintenance (ModuleStatusBanner).
 */
export type ModuleState = 'ok' | 'down' | 'not_configured';

export interface SystemStatus {
  porto: ModuleState;
  whatsapp: ModuleState;
  checkedAt: string;
}

const CACHE_MS = 60_000;
const TIMEOUT_MS = 6_000;
/** The worker records a heartbeat every minute; three missed ones mean it's down. */
const HEARTBEAT_STALE_MS = 3 * 60_000;

let cached: { at: number; promise: Promise<Omit<SystemStatus, 'checkedAt'> & { checkedAt: string }> } | null = null;

async function checkPortoWorker(): Promise<ModuleState> {
  if (!process.env.PORTO_WORKER_URL || !process.env.PORTO_WORKER_SECRET) return 'not_configured';
  const rows = await sql`SELECT MAX(last_seen_at) AS last FROM worker_heartbeats`;
  const last = rows[0]?.last ? new Date(rows[0].last as string).getTime() : 0;
  return Date.now() - last < HEARTBEAT_STALE_MS ? 'ok' : 'down';
}

/** Any answer from the server itself means it's up; Caddy answers 502/503 when the container is down. */
async function checkWhatsApp(): Promise<ModuleState> {
  const server = evolutionServer();
  if (!server) return 'not_configured';
  try {
    const response = await fetch(server.apiUrl.replace(/\/+$/, ''), { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.status === 502 || response.status === 503 ? 'down' : 'ok';
  } catch {
    return 'down';
  }
}

/** The platform-wide state, shared by every organization (cached for a minute). */
export function getSystemStatus(): Promise<SystemStatus> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = Promise.all([checkPortoWorker().catch((): ModuleState => 'down'), checkWhatsApp()]).then(([porto, whatsapp]) => ({
    porto,
    whatsapp,
    checkedAt: new Date().toISOString(),
  }));
  cached = { at: Date.now(), promise };
  return promise;
}

/** The modules this organization actually uses; one it doesn't have reads as not configured. */
export async function getOrganizationSystemStatus(organizationId: string): Promise<SystemStatus> {
  const [status, porto, whatsapp] = await Promise.all([
    getSystemStatus(),
    organizationHasFeature(organizationId, 'porto'),
    organizationHasFeature(organizationId, 'whatsapp'),
  ]);
  return {
    porto: porto ? status.porto : 'not_configured',
    whatsapp: whatsapp ? status.whatsapp : 'not_configured',
    checkedAt: status.checkedAt,
  };
}
