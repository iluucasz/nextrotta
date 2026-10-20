import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { decryptPortoPassword } from '../lib/porto-crypto';
import { sql } from '../lib/db';
import { launchPortoBrowser } from '../lib/porto-integration/browser';
import { loginToPorto, PortoLoginError } from '../lib/porto-integration/login';
import { listSocorristas } from '../lib/porto-integration/socorristas';
import { getPortoConfig } from '../lib/porto-sync-log';
import { runHoursJob } from '../lib/porto-jobs/run-hours-job';
import { runScheduleJob } from '../lib/porto-jobs/run-schedule-job';
import { PortoBusyError, portoCapacity, portoLockInfo, runWithPortoLock } from './porto-lock';
import { portoQueueSnapshot } from './porto-queue';

// 8091, not the original client's 8090: both workers run side by side on the shared VPS.
const PORT = Number(process.env.PORTO_WORKER_PORT ?? 8091);
const SECRET = process.env.PORTO_WORKER_SECRET;

function isAuthorized(req: IncomingMessage): boolean {
  if (!SECRET) return false;
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const token = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(SECRET);
  return token.length === expected.length && timingSafeEqual(token, expected);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every endpoint acts on one organization, named by the app in `?organization=`. The app only ever
 * forwards the caller's own organization (taken from their session), and the shared secret keeps
 * anyone else from calling here directly.
 */
function readOrganizationId(url: URL, res: ServerResponse): string | null {
  const organizationId = url.searchParams.get('organization') ?? '';
  if (!UUID_PATTERN.test(organizationId)) {
    sendJson(res, 400, { error: 'Organização não informada.' });
    return null;
  }
  return organizationId;
}

/** Guards a response against being sent twice (e.g. onStarted firing, then the job also settling). */
function onceResponder(res: ServerResponse) {
  let responded = false;
  return (status: number, body: unknown) => {
    if (responded) return;
    responded = true;
    sendJson(res, status, body);
  };
}

async function handleTestLogin(organizationId: string, res: ServerResponse) {
  const config = await getPortoConfig(organizationId);
  if (!config || !config.cpf || !config.encrypted_password) {
    sendJson(res, 400, { error: 'Configure CPF e senha antes de testar.' });
    return;
  }

  const password = decryptPortoPassword(config.encrypted_password as string);
  await runWithPortoLock(organizationId, 'teste de login', async () => {
    const { browser, context } = await launchPortoBrowser();
    try {
      const page = await context.newPage();
      await loginToPorto(page, { cpf: config.cpf as string, password });
      sendJson(res, 200, { message: 'Login realizado com sucesso no Portal do Prestador.' });
    } catch (error) {
      const message = error instanceof PortoLoginError ? error.message : `Falha ao testar login no Porto: ${error instanceof Error ? error.message : String(error)}`;
      sendJson(res, 400, { error: message });
    } finally {
      await browser.close().catch(() => {});
    }
  });
}

async function handleSocorristas(organizationId: string, res: ServerResponse) {
  const config = await getPortoConfig(organizationId);
  if (!config || !config.cpf || !config.encrypted_password) {
    sendJson(res, 400, { error: 'Configure CPF e senha antes de buscar os técnicos do Porto.' });
    return;
  }

  const password = decryptPortoPassword(config.encrypted_password as string);
  await runWithPortoLock(organizationId, 'busca de técnicos', async () => {
    const { browser, context } = await launchPortoBrowser();
    try {
      const page = await context.newPage();
      await loginToPorto(page, { cpf: config.cpf as string, password });
      const socorristas = await listSocorristas(page);
      const technicians = await sql`
        SELECT id, qra, porto_name_hint, name, email, commission_percentage, base_salary,
               va_allowance, vr_allowance, status
        FROM technicians
        WHERE organization_id = ${organizationId}
          AND deleted_at IS NULL
        ORDER BY name ASC
      `;
      sendJson(res, 200, { socorristas, technicians });
    } catch (error) {
      const message = error instanceof PortoLoginError ? error.message : `Falha ao buscar técnicos do Porto: ${error instanceof Error ? error.message : String(error)}`;
      sendJson(res, 400, { error: message });
    } finally {
      await browser.close().catch(() => {});
    }
  });
}

async function handleRunHours(organizationId: string, url: URL, res: ServerResponse) {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const dateRange = start ? { startDateKey: start, endDateKey: end || start } : undefined;
  // ?write=1 is the "Rodar agora" real-run escape hatch — everything else (the diagnostic test
  // button) stays forced dry-run regardless of the dry_run_only config, same as before.
  const forceWrite = url.searchParams.get('write') === '1';

  // Doesn't await the job — a full month sweep can run well past the Vercel proxy's own
  // maxDuration (confirmed live: 504 after exactly 280s waiting on this call). Responds the
  // instant the sync_log row exists so the caller never blocks on the actual scrape; the job
  // keeps running here regardless (this process is a long-lived daemon, not a one-shot request
  // handler) and writes its result to porto_sync_log as it always did — the admin UI polls that.
  const respondOnce = onceResponder(res);
  runWithPortoLock(organizationId, 'apontamento de horas (manual)', () =>
    runHoursJob({
      organizationId,
      manual: true,
      dateRange,
      forceWrite,
      onStarted: (logId) => respondOnce(202, { status: 'started', logId }),
    }),
  )
    .then((result) => respondOnce(result.status === 'error' ? 500 : 200, result))
    .catch((error) => {
      console.error('[worker/server] hours job failed before it could start:', error);
      respondOnce(error instanceof PortoBusyError ? 409 : 500, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    });
}

async function handleRunSchedule(organizationId: string, url: URL, res: ServerResponse) {
  const forceWrite = url.searchParams.get('write') === '1';
  const respondOnce = onceResponder(res);
  runWithPortoLock(organizationId, 'escala (manual)', () =>
    runScheduleJob({
      organizationId,
      manual: true,
      forceWrite,
      onStarted: (logId) => respondOnce(202, { status: 'started', logId }),
    }),
  )
    .then((result) => respondOnce(result.status === 'error' ? 500 : 200, result))
    .catch((error) => {
      console.error('[worker/server] schedule job failed before it could start:', error);
      respondOnce(error instanceof PortoBusyError ? 409 : 500, { status: 'error', error: error instanceof Error ? error.message : String(error) });
    });
}

/**
 * Exposes the same admin-triggered actions the Vercel-hosted admin UI used to run inline
 * (test-login, técnico match list, manual hours/schedule test) as plain HTTP endpoints — the
 * Vercel routes now just forward here (see app/api/porto-config/* and app/api/cron/porto-*),
 * so no Playwright/Chromium code runs on Vercel at all. Bound to 127.0.0.1 only in Docker (see
 * the `docker run -p 127.0.0.1:PORT:PORT` invocation) and reverse-proxied through the VPS's
 * existing Caddy instance (HTTPS) under /porto-worker/* — never exposed directly.
 */
export function startWorkerServer() {
  if (!SECRET) {
    console.error('[worker/server] PORTO_WORKER_SECRET não configurado — servidor HTTP não vai iniciar.');
    return;
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (!isAuthorized(req)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

        // Polled by the app (lib/system-status.ts) to tell admins when the VPS is down.
        if (req.method === 'GET' && url.pathname === '/health') {
          sendJson(res, 200, { ok: true });
          return;
        }
        // The Porto queue across organizations, for the owner panel (Operação).
        if (req.method === 'GET' && url.pathname === '/status') {
          sendJson(res, 200, { capacity: portoCapacity(), running: portoLockInfo(), queue: portoQueueSnapshot() });
          return;
        }

        const organizationId = readOrganizationId(url, res);
        if (!organizationId) return;

        if (req.method === 'GET' && url.pathname === '/run/hours') {
          await handleRunHours(organizationId, url, res);
          return;
        }
        if (req.method === 'GET' && url.pathname === '/run/schedule') {
          await handleRunSchedule(organizationId, url, res);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/test-login') {
          await handleTestLogin(organizationId, res);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/socorristas') {
          await handleSocorristas(organizationId, res);
          return;
        }

        sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        if (error instanceof PortoBusyError) {
          sendJson(res, 409, { error: error.message });
          return;
        }
        console.error('[worker/server] unhandled error:', error);
        sendJson(res, 500, { error: 'Erro interno do worker.' });
      }
    })();
  });

  // Listens on all interfaces inside the container — host-level exposure is restricted by the
  // `docker run -p 127.0.0.1:PORT:PORT` binding instead (binding to 127.0.0.1 in here would be
  // unreachable even through that published port, since Docker's NAT targets the container's
  // real interface, not its loopback).
  server.listen(PORT, () => {
    console.log(`[worker/server] HTTP server ouvindo na porta ${PORT}`);
  });
}
