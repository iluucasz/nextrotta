import cron from 'node-cron';
import { isBalanceConfigured, recordBalance } from '../lib/ai/balance';
import { runBillingMaintenance } from '../lib/billing/billing';
import { grantMonthlyCredits } from '../lib/platform/ai-credits';
import { expireCoupons } from '../lib/platform/coupons';
import { collectVpsMetrics, flushVpsMetrics, runAutomaticVpsCleanup, vpsAgentConfigured } from '../lib/platform/vps';
import { recordHeartbeat, trackRun } from '../lib/worker-health';
import { refreshAllInstanceStatuses } from '../lib/whatsapp/instance';
import { hasScheduledNotificationInWindow, runDueNotifications } from '../lib/whatsapp/notifications';
import { evolutionServer } from '../lib/whatsapp/store';
import { cachedWhatsAppConfig, cachedWhatsAppOrganizations, invalidateCachedReads } from './cached-reads';
import { runAllNow, runPortoScheduler } from './porto-queue';
import { startWorkerServer } from './server';

function log(...args: unknown[]) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

// Without the Evolution server every scheduled notification would still claim its day/month and
// then fail to send, so WhatsApp only runs here once the container has it.
const whatsappConfigured = Boolean(evolutionServer());

async function runWhatsApp(organizationId: string, options: Parameters<typeof runDueNotifications>[1] = {}) {
  try {
    const summaries = await runDueNotifications(organizationId, options);
    if (summaries.length) log(`WhatsApp (${organizationId}):`, JSON.stringify(summaries));
  } catch (error) {
    log(`Notificações WhatsApp falharam (${organizationId}):`, error);
  }
}

/** A notification is picked up on the first 5-minute check after its time. */
const NOTIFICATION_FIRST_CHECK_MINUTES = 5;

/**
 * Checks every 5 minutes, but from the cached configurations: the database is only touched for an
 * organization with a notification whose time just came (`catchUp` widens that to the whole catch-up
 * window, used by the 30-minute maintenance to pick up anything that was postponed or missed).
 */
async function runAllWhatsApp(catchUp = false) {
  try {
    for (const organizationId of await cachedWhatsAppOrganizations()) {
      const config = await cachedWhatsAppConfig(organizationId);
      if (!hasScheduledNotificationInWindow(config, catchUp ? undefined : NOTIFICATION_FIRST_CHECK_MINUTES)) continue;
      await runWhatsApp(organizationId);
    }
  } catch (error) {
    log('Falha ao verificar as notificações de WhatsApp:', error);
  }
}

const portoHooks = {
  log,
  // The end-of-shift WhatsApp goes out as soon as the organization's hours are in, rather than at its
  // configured time (which stays as the fallback, and it only ever sends once a day). It's about the
  // day the run imported, even when the run finishes after midnight.
  afterHours: async (organizationId: string, runDay: Date) => {
    if (whatsappConfigured) await runWhatsApp(organizationId, { only: 'daily_hours', ignoreTime: true, now: runDay });
  },
};

/**
 * Daily platform routine: past-due organizations whose grace period ended become read-only until
 * they pay, coupons whose cycles are over give the previous discount back, and plans with AI grant
 * the month's credits (once per month).
 */
async function runBilling() {
  try {
    const suspended = await trackRun('billing', null, runBillingMaintenance);
    log(`Inadimplência: ${suspended.length} organização(ões) suspensa(s).`, suspended.join(', '));
  } catch (error) {
    log('Checagem de inadimplência falhou:', error);
  }
  try {
    const expired = await trackRun('coupons', null, expireCoupons);
    log(`Cupons: ${expired} encerrado(s) por fim dos ciclos.`);
  } catch (error) {
    log('Encerramento de cupons falhou:', error);
  }
  try {
    const granted = await trackRun('ai_credits', null, grantMonthlyCredits);
    log(`Créditos de IA: cota mensal concedida a ${granted} organização(ões).`);
  } catch (error) {
    log('Cota mensal de créditos falhou:', error);
  }
}

async function heartbeat() {
  try {
    await recordHeartbeat();
  } catch (error) {
    log('Falha ao registrar o worker no banco:', error);
  }
}

/**
 * Everything that has to read or write the database on a clock goes here, twice an hour, instead of
 * every minute: Neon bills (and keeps the compute running) for the time the database stays awake, and
 * a query every minute keeps it awake all day. Between ticks the worker lives on memory — see
 * cached-reads.ts — and wakes the database only when a job or notification is really due.
 */
async function maintenance() {
  invalidateCachedReads();
  await heartbeat();
  if (vpsAgentConfigured()) {
    try {
      const written = await flushVpsMetrics();
      if (written) log(`Métricas da VPS: ${written} amostra(s) gravada(s).`);
    } catch (error) {
      log('Gravação das métricas da VPS falhou (tenta de novo na próxima):', error);
    }
  }
  if (whatsappConfigured) {
    try {
      await refreshAllInstanceStatuses();
    } catch (error) {
      log('Falha ao atualizar o estado das instâncias de WhatsApp:', error);
    }
    await runAllWhatsApp(true);
  }
  if (isBalanceConfigured() && new Date().getMinutes() < 30) void readAiBalance();
}

/** The daily VPS cleanup, once the owner switched it on (Configurações da plataforma → VPS). */
/** The DeepSeek balance every hour: measures what it charged and warns the owner when it's low. */
async function readAiBalance() {
  const { error } = await recordBalance(50 * 60 * 1000);
  if (error) log('Saldo da DeepSeek: leitura falhou:', error);
}

async function cleanVps() {
  try {
    const result = await runAutomaticVpsCleanup();
    if (result) log(`Limpeza da VPS: ${result.actions.length} item(ns), ${Math.round(result.freedBytes / 1048576)} MB liberados.`);
  } catch (error) {
    log('Limpeza automática da VPS falhou:', error);
  }
}

async function collectMetrics() {
  try {
    await collectVpsMetrics();
  } catch (error) {
    log('Coleta de métricas da VPS falhou:', error);
  }
}

// `docker exec <container> node dist/worker/index.js --run=hours` (or schedule, billing) runs a
// one-off job for every organization with the automation on and exits, reusing the same
// image/Chromium install — without disturbing the main scheduler daemon.
const runArg = process.argv.find((arg) => arg.startsWith('--run='))?.split('=')[1];

if (runArg) {
  const jobs: Record<string, () => Promise<void>> = {
    hours: () => runAllNow(portoHooks, 'hours'),
    schedule: () => runAllNow(portoHooks, 'schedule'),
    billing: runBilling,
  };
  const job = jobs[runArg] ?? null;
  if (!job) {
    console.error(`--run inválido: "${runArg}" (use "hours", "schedule" ou "billing")`);
    process.exit(1);
  }
  job().then(() => process.exit(0));
} else {
  // Each organization's Porto times are edited in its Configurações (Brasília time), so instead of
  // fixed cron expressions a once-a-minute tick checks what is due and queues it (porto-queue.ts).
  // No maxDuration here: each run goes to completion.
  // Reads from memory (cached-reads.ts); the database is only touched when something is due.
  cron.schedule('* * * * *', () => void runPortoScheduler(portoHooks), { timezone: 'America/Sao_Paulo' });
  cron.schedule('0,30 * * * *', () => void maintenance(), { timezone: 'America/Sao_Paulo' });
  cron.schedule('0 6 * * *', runBilling, { timezone: 'America/Sao_Paulo' });
  // WhatsApp notification times are edited in the admin UI, so rather than one cron entry per
  // notification this checks every few minutes what is due. Each notification claims its day/month
  // before running, so it's once only.
  if (whatsappConfigured) {
    cron.schedule('*/5 * * * *', () => void runAllWhatsApp(), { timezone: 'America/Sao_Paulo' });
  }
  // VPS usage history for the owner panel (Operação → VPS), when the VPS agent is configured. Samples
  // are taken every 5 minutes and written in batches by the maintenance tick.
  if (vpsAgentConfigured()) {
    cron.schedule('*/5 * * * *', () => void collectMetrics(), { timezone: 'America/Sao_Paulo' });
    // Same time as the old vps-cleanup.timer it replaces: after the night queue, before the day.
    cron.schedule('30 4 * * *', () => void cleanVps(), { timezone: 'America/Sao_Paulo' });
  }
  void heartbeat();
  void runPortoScheduler(portoHooks);
  log(
    `Worker do NextRotta iniciado. Porto: fila no horário de cada organização (Configurações). WhatsApp: ${
      whatsappConfigured ? 'verificação a cada 5 min.' : 'desligado (EVOLUTION_API_URL/KEY não configurados no container).'
    } Métricas da VPS: ${vpsAgentConfigured() ? 'a cada 5 min.' : 'desligadas (VPS_AGENT_URL/SECRET não configurados).'}`,
  );

  // Everything the admin UI triggers on demand (test-login, técnico match, manual job runs) is
  // served from here too — the Vercel routes are thin proxies (see server.ts).
  startWorkerServer();
}
