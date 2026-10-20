/**
 * All Playwright/Chromium automation for the Porto integration now runs exclusively on the VPS
 * worker (see worker/server.ts) — Vercel is a Hobby-plan serverless platform with a hard
 * execution-time ceiling that kept getting hit by real month-wide scrapes against a slow legacy
 * portal. These Next.js routes (app/api/porto-config/test-login, /socorristas,
 * app/api/cron/porto-hours, /porto-schedule) are now thin proxies that forward the admin's
 * request to the worker over HTTPS (via the VPS's existing Caddy reverse proxy) and relay
 * whatever it returns — no Playwright dependency on Vercel at all anymore.
 */
export const WORKER_MAINTENANCE_MESSAGE =
  'Módulo Porto em manutenção: o servidor da automação (VPS) está fora do ar. Tente de novo quando ele voltar.';

export async function callPortoWorker(
  organizationId: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const baseUrl = process.env.PORTO_WORKER_URL;
  const secret = process.env.PORTO_WORKER_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('PORTO_WORKER_URL / PORTO_WORKER_SECRET não configurados na Vercel.');
  }

  // Every worker endpoint acts on exactly one organization.
  const separator = path.includes('?') ? '&' : '?';
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}${separator}organization=${encodeURIComponent(organizationId)}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${secret}`,
      },
      cache: 'no-store',
    });
  } catch {
    return { status: 503, body: { status: 'error', error: WORKER_MAINTENANCE_MESSAGE } };
  }
  // Caddy answers 502/503 itself when the worker container is down (the worker only ever sends 500).
  if (response.status === 502 || response.status === 503) {
    return { status: 503, body: { status: 'error', error: WORKER_MAINTENANCE_MESSAGE } };
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: `Resposta inválida do worker da VPS (status ${response.status}).` };
  }

  return { status: response.status, body };
}

/** Platform-wide worker endpoints (the owner panel's view of the Porto queue): no organization. */
export async function callPortoWorkerPlatform(path: string): Promise<{ status: number; body: unknown }> {
  const baseUrl = process.env.PORTO_WORKER_URL;
  const secret = process.env.PORTO_WORKER_SECRET;
  if (!baseUrl || !secret) {
    return { status: 503, body: { error: 'PORTO_WORKER_URL / PORTO_WORKER_SECRET não configurados.' } };
  }
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 502 || response.status === 503) return { status: 503, body: { error: WORKER_MAINTENANCE_MESSAGE } };
    return { status: response.status, body: await response.json().catch(() => ({ error: `Resposta inválida do worker (status ${response.status}).` })) };
  } catch {
    return { status: 503, body: { error: WORKER_MAINTENANCE_MESSAGE } };
  }
}
