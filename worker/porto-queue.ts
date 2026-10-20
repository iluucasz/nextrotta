import { createHash } from 'node:crypto';
import { sql } from '../lib/db';
import { getOrganizationSettings } from '../lib/organization-settings-store';
import { sendPortoAlert } from '../lib/porto-alerts';
import { runHoursJob } from '../lib/porto-jobs/run-hours-job';
import { runScheduleJob } from '../lib/porto-jobs/run-schedule-job';
import { listOrganizationsWithPortoAutomation } from '../lib/porto-sync-log';
import { PORTO_LAYOUT_ALERT_TITLE } from '../lib/porto-layout';
import { sendOwnerAlert } from '../lib/platform/alerts';
import { getPlatformSettings } from '../lib/platform/settings';
import { brasiliaNow, timeToMinutes } from '../lib/whatsapp/dates';
import { isJobDue, JOB_CATCH_UP_MINUTES } from './job-schedule';
import { portoLockInfo, setMaxBrowsers, waitForPortoLock } from './porto-lock';

/**
 * The nightly Porto queue for every organization with the automation on.
 *
 * - Each organization's hours import enters the queue at its own time (Configurações → horário da
 *   importação de horas, Brasília); the browser slots (porto-lock.ts) decide how many run at once.
 * - Its schedule import enters right after its hours finish, so it never competes with a heavy
 *   night. The configured schedule time stays as a fallback when the hours didn't run.
 * - Organizations that become due together are ordered by a hash of the night, so the order turns
 *   and the same one isn't always last.
 * - A failure in one organization never stops the others.
 */

type JobKind = 'hours' | 'schedule';
type Task = { organizationId: string; job: JobKind; runDay: string; enqueuedAt: number; startedAt: number | null };

type Hooks = {
  log: (...args: unknown[]) => void;
  /** After an organization's automatic hours import succeeded: its end-of-shift WhatsApp. */
  afterHours: (organizationId: string, runDay: Date) => Promise<void>;
};

const tasks = new Map<string, Task>(); // `${organizationId}:${job}` → queued or running
const lastHoursDay = new Map<string, string>(); // organizationId → Brasília day of the last automatic hours run
const lastScheduleAt = new Map<string, number>(); // organizationId → when the last automatic schedule run started
let loadedDay: string | null = null;

/** Layout incidents of the current night: day → organizations whose runs looked like a screen change. */
const layoutIncidents = new Map<string, Set<string>>();

/** A run holding an organization's lock this long is considered stuck (a heavy night takes ~80 min). */
const STUCK_RUN_ALERT_MS = 2 * 60 * 60 * 1000;
/** The night queue should be over by then (Brasília). */
const QUEUE_DEADLINE = '06:00';
/** The schedule fallback only fires when the organization's schedule didn't run in this window. */
const SCHEDULE_FRESH_MS = 12 * 60 * 60 * 1000;

function rotationKey(day: string, organizationId: string) {
  return createHash('sha1').update(`${day}:${organizationId}`).digest('hex');
}

/** On (re)start: what already ran today, so a restart right after the scheduled time doesn't repeat it. */
async function loadLastRuns(today: string) {
  const rows = await sql`
    SELECT organization_id, job_type,
           MAX(started_at) AS last_started,
           MAX(to_char(started_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')) AS last_day
    FROM porto_sync_log
    WHERE started_at > NOW() - INTERVAL '36 hours'
      AND COALESCE(run_trigger, 'auto') = 'auto'
    GROUP BY organization_id, job_type
  `;
  for (const row of rows) {
    const organizationId = String(row.organization_id);
    if (row.job_type === 'hours' && row.last_day === today) lastHoursDay.set(organizationId, today);
    if (row.job_type === 'schedule') lastScheduleAt.set(organizationId, new Date(row.last_started as string).getTime());
  }
  loadedDay = today;
}

function enqueue(hooks: Hooks, organizationId: string, job: JobKind, runDay: string) {
  const key = `${organizationId}:${job}`;
  if (tasks.has(key)) return;
  const task: Task = { organizationId, job, runDay, enqueuedAt: Date.now(), startedAt: null };
  tasks.set(key, task);
  if (job === 'schedule') lastScheduleAt.set(organizationId, Date.now());

  // Started right away: waitForPortoLock queues it (FIFO) behind the browser slots.
  void waitForPortoLock(organizationId, job === 'hours' ? 'apontamento de horas (automático)' : 'escala (automática)', async () => {
    task.startedAt = Date.now();
    const runDayDate = new Date();
    if (job === 'hours') {
      const result = await runHoursJob({ organizationId, manual: false });
      hooks.log(`Resultado (horas, ${organizationId}):`, JSON.stringify({ status: result.status, rows_written: result.rows_written, warnings: result.warnings?.length ?? 0 }));
      await handleProblems(hooks, organizationId, 'importação de horas', result, runDay);
      if (result.status === 'success' || result.status === 'partial') await hooks.afterHours(organizationId, runDayDate);
    } else {
      const result = await runScheduleJob({ organizationId, manual: false });
      hooks.log(`Resultado (escala, ${organizationId}):`, JSON.stringify({ status: result.status, warnings: result.warnings?.length ?? 0 }));
      await handleProblems(hooks, organizationId, 'importação da escala', result, runDay);
    }
  })
    .catch(async (error) => {
      hooks.log(`Porto (${job}, ${organizationId}) falhou:`, error);
      await sendPortoAlert(organizationId, `a ${job === 'hours' ? 'importação de horas' : 'importação da escala'} falhou`, [
        error instanceof Error ? error.message : String(error),
      ]);
    })
    .finally(() => {
      tasks.delete(key);
      // The schedule follows the organization's hours, whatever their outcome.
      if (job === 'hours') enqueue(hooks, organizationId, 'schedule', runDay);
      void afterQueueChange(hooks);
    });
}

type RunResult = { status: string; error?: string; warnings?: string[]; layout_suspect?: boolean };

/**
 * A screen change is the platform's problem (every organization fails together): it's gathered into
 * one owner alert per night. Everything else goes to the organization's own alert number.
 */
async function handleProblems(hooks: Hooks, organizationId: string, jobLabel: string, result: RunResult, runDay: string) {
  if (result.layout_suspect) {
    const incident = layoutIncidents.get(runDay) ?? new Set<string>();
    incident.add(organizationId);
    layoutIncidents.set(runDay, incident);
    return;
  }
  let alert: { sent: boolean; reason?: string } | null = null;
  if (result.status === 'error') {
    alert = await sendPortoAlert(organizationId, `a ${jobLabel} falhou`, [result.error ?? 'Erro sem detalhe.']);
  } else if (result.warnings?.length) {
    alert = await sendPortoAlert(organizationId, `a ${jobLabel} terminou com avisos`, result.warnings);
  }
  if (alert && !alert.sent) hooks.log(`Alerta da ${jobLabel} (${organizationId}) não enviado:`, alert.reason);
}

async function organizationNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await sql`SELECT id, name, slug FROM organizations WHERE id = ANY(${ids}::uuid[])`;
  return new Map(rows.map((row) => [String(row.id), `${row.name} (${row.slug})`]));
}

/** When the queue drains: one owner alert per layout incident. */
async function afterQueueChange(hooks: Hooks) {
  if (tasks.size) return;
  for (const [day, organizations] of layoutIncidents) {
    layoutIncidents.delete(day);
    const ids = Array.from(organizations);
    const names = await organizationNames(ids);
    const result = await sendOwnerAlert({
      key: `porto-layout:${day}`,
      kind: 'porto_layout',
      title: `${PORTO_LAYOUT_ALERT_TITLE} (${ids.length} organização(ões) afetada(s))`,
      lines: [
        ...ids.map((id) => names.get(id) ?? id),
        'Cada organização vê o aviso na Config. Porto até a próxima execução sem problemas.',
      ],
      organizationIds: ids,
    });
    if (!result.sent && !result.duplicate) hooks.log('Alerta de mudança de tela não enviado:', result.reason);
  }
}

async function checkStuckRuns(hooks: Hooks) {
  for (const held of portoLockInfo()) {
    if (held.heldForMs < STUCK_RUN_ALERT_MS) continue;
    const startedMinute = Math.floor((Date.now() - held.heldForMs) / 60000);
    const minutes = Math.round(held.heldForMs / 60000);
    const names = await organizationNames([held.organizationId]);
    hooks.log(`Execução travada? "${held.name}" (${held.organizationId}) rodando há ${minutes} min.`);
    await sendOwnerAlert({
      key: `porto-stuck:${held.organizationId}:${startedMinute}`,
      kind: 'porto_stuck',
      title: 'uma execução do Porto parece travada',
      lines: [
        `${names.get(held.organizationId) ?? held.organizationId}: "${held.name}" está rodando há ${minutes} minutos e bloqueia as próximas dessa organização.`,
        'Se continuar assim, reinicie o worker do NextRotta na VPS.',
      ],
      organizationIds: [held.organizationId],
    });
  }
}

async function checkQueueDeadline(today: string, nowMinutes: number) {
  const deadline = timeToMinutes(QUEUE_DEADLINE) ?? 360;
  // Only between the deadline and the end of the catch-up window: a run started later in the day
  // (an organization with a daytime import time) isn't the night queue.
  if (nowMinutes < deadline || nowMinutes >= deadline + JOB_CATCH_UP_MINUTES) return;
  const late = Array.from(tasks.values()).filter((task) => task.enqueuedAt < Date.now() - (nowMinutes - deadline) * 60000);
  if (!late.length) return;
  const names = await organizationNames(Array.from(new Set(late.map((task) => task.organizationId))));
  await sendOwnerAlert({
    key: `porto-queue-late:${today}`,
    kind: 'porto_queue_late',
    title: `a fila noturna do Porto não terminou até as ${QUEUE_DEADLINE}`,
    lines: [
      ...late.map((task) => `${names.get(task.organizationId) ?? task.organizationId}: ${task.job === 'hours' ? 'horas' : 'escala'} ${task.startedAt ? 'rodando' : 'na fila'}`),
      'Considere mais navegadores ao mesmo tempo (Configurações da plataforma) ou outra VPS.',
    ],
    organizationIds: late.map((task) => task.organizationId),
  });
}

/** Called once a minute by the worker. */
export async function runPortoScheduler(hooks: Hooks) {
  try {
    const platform = await getPlatformSettings();
    setMaxBrowsers(platform.porto.maxBrowsers);

    const now = brasiliaNow();
    if (loadedDay !== now.dateKey) await loadLastRuns(now.dateKey);
    await checkStuckRuns(hooks);
    await checkQueueDeadline(now.dateKey, now.minutes);

    const due: Array<{ organizationId: string; job: JobKind }> = [];
    for (const organizationId of await listOrganizationsWithPortoAutomation()) {
      const settings = await getOrganizationSettings(organizationId);
      if (isJobDue({ scheduledTime: settings.portoHoursImportTime, nowMinutes: now.minutes, today: now.dateKey, lastRunDay: lastHoursDay.get(organizationId) ?? null })) {
        lastHoursDay.set(organizationId, now.dateKey);
        due.push({ organizationId, job: 'hours' });
        continue;
      }
      const scheduleRecent = Date.now() - (lastScheduleAt.get(organizationId) ?? 0) < SCHEDULE_FRESH_MS;
      if (!scheduleRecent && isJobDue({ scheduledTime: settings.portoScheduleImportTime, nowMinutes: now.minutes, today: now.dateKey, lastRunDay: null })) {
        due.push({ organizationId, job: 'schedule' });
      }
    }

    due.sort((left, right) => rotationKey(now.dateKey, left.organizationId).localeCompare(rotationKey(now.dateKey, right.organizationId)));
    for (const item of due) enqueue(hooks, item.organizationId, item.job, now.dateKey);
    if (due.length) hooks.log(`Fila do Porto: ${due.length} execução(ões) adicionada(s).`, due.map((item) => `${item.organizationId}:${item.job}`).join(', '));
  } catch (error) {
    hooks.log('Agendador do Porto: falha ao verificar os horários:', error);
  }
}

/** Runs every organization's job now (the `--run=` one-off command), one queue for all. */
export async function runAllNow(hooks: Hooks, job: JobKind) {
  const today = brasiliaNow().dateKey;
  for (const organizationId of await listOrganizationsWithPortoAutomation()) enqueue(hooks, organizationId, job, today);
  while (tasks.size) await new Promise((resolve) => setTimeout(resolve, 2000));
}

export function portoQueueSnapshot() {
  return Array.from(tasks.values()).map((task) => ({
    organizationId: task.organizationId,
    job: task.job,
    runDay: task.runDay,
    enqueuedAt: new Date(task.enqueuedAt).toISOString(),
    startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : null,
  }));
}
