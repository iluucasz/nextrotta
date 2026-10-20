// Relative imports only: this module is also compiled into the VPS worker (worker/tsconfig.json),
// which has no `@/` path alias.
import { sql } from '../db';
import { checkLimit } from '../billing/entitlements';
import { getOrganizationSettings } from '../organization-settings-store';
import {
  addDaysToKey,
  brasiliaNow,
  formatDateKey,
  formatHoursValue,
  formatShortDateKey,
  monthLabel,
  timeToMinutes,
  weekdayLabel,
  weekdayShortLabel,
} from './dates';
import { normalizePhone, sendEvolutionText } from './evolution';
import {
  NOTIFICATION_DEFINITIONS,
  NOTIFICATION_TYPES,
  renderTemplate,
  type MessageTrigger,
  type NotificationType,
} from './notification-types';
import {
  claimJobRun,
  claimMessage,
  connectionFromConfig,
  finishMessage,
  getWhatsAppConfig,
  type WhatsAppConfig,
} from './store';
import { organizationPublicUrl } from '../tenant-host';

/** Bursts of messages are what WhatsApp providers flag as spam — keep a small gap between sends. */
const PAUSE_BETWEEN_SENDS_MS = 350;

/**
 * How long after its configured time a scheduled notification may still go out. Covers the worker
 * being restarted or the VPS being briefly down, without sending "bom dia, hoje é sua folga" at
 * 23h because the worker came back late.
 */
const CATCH_UP_WINDOW_MINUTES = 180;

/**
 * Whether the day's hours are in for "Fim do expediente". With the Porto import writing hours,
 * they only exist once that night's import has finished for the day; otherwise (automation off or
 * in test mode) hours are entered by hand and the configured time stands as is.
 */
async function dailyHoursReady(organizationId: string, dateKey: string): Promise<boolean> {
  const [config] = await sql`SELECT automation_enabled, dry_run_only FROM porto_config WHERE organization_id = ${organizationId}`;
  if (!config?.automation_enabled || config.dry_run_only !== false) return true;
  // Both conditions: the run covered the day and finished on it or later (Brasília time). The
  // range alone isn't enough — runs from before the worker's timezone fix ended at 23:00 BRT with
  // a range already reaching the next day.
  const [run] = await sql`
    SELECT 1 FROM porto_sync_log
    WHERE organization_id = ${organizationId}
      AND job_type = 'hours' AND status IN ('success', 'partial') AND range_end >= ${dateKey}
      AND (finished_at AT TIME ZONE 'America/Sao_Paulo')::date >= ${dateKey}::date
      -- Only the night's automatic import: a manual afternoon run would send a partial day.
      AND COALESCE(run_trigger, 'auto') = 'auto'
    LIMIT 1
  `;
  return Boolean(run);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Recipient {
  id: string | null;
  name: string | null;
  phone: string | null;
}

/** "ALEX FERREIRA DOS SANTOS" → "Alex" */
function firstName(name: string | null) {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return first ? first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR') : '';
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export type DeliveryOutcome = 'sent' | 'failed' | 'skipped' | 'duplicate';

interface DeliveryInput {
  recipient: Recipient;
  type: NotificationType | 'test';
  trigger: MessageTrigger;
  dedupeKey: string | null;
  referenceDate: string | null;
  message: string;
  createdBy?: string | null;
  /** The admin's test message goes to the number they typed, never to the configured test phone. */
  ignoreTestRedirect?: boolean;
}

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  error: string | null;
}

/** Claims, sends and records one message. Never throws for delivery problems — they are recorded. */
async function deliver(config: WhatsAppConfig, input: DeliveryInput): Promise<DeliveryResult> {
  const redirected = Boolean(config.testPhone) && !input.ignoreTestRedirect;
  const targetPhone = redirected ? config.testPhone : input.recipient.phone;

  const id = await claimMessage(config.organizationId, {
    technicianId: input.recipient.id,
    technicianName: input.recipient.name,
    phone: targetPhone,
    type: input.type,
    trigger: input.trigger,
    // A message diverted to the test number never reached the technician, so it must not count as
    // "already sent" to them: after the test number is cleared, the real send still has to happen.
    dedupeKey: redirected ? null : input.dedupeKey,
    referenceDate: input.referenceDate,
    message: input.message,
    createdBy: input.createdBy,
  });

  if (!id) return { outcome: 'duplicate', error: null };

  const messageLimit = await checkLimit(config.organizationId, 'whatsappMessagesMonth');
  if (!messageLimit.allowed) {
    await finishMessage(id, { status: 'skipped', error: messageLimit.message, phone: targetPhone, redirectedToTest: redirected });
    return { outcome: 'skipped', error: messageLimit.message };
  }

  const connection = connectionFromConfig(config);
  if (!connection) {
    const error = 'WhatsApp não conectado: crie a instância e leia o QR Code na tela WhatsApp → Conexão.';
    await finishMessage(id, { status: 'skipped', error, phone: targetPhone, redirectedToTest: redirected });
    return { outcome: 'skipped', error };
  }

  if (!normalizePhone(targetPhone)) {
    const error = targetPhone ? `Telefone inválido: ${targetPhone}` : 'Técnico sem telefone cadastrado.';
    await finishMessage(id, { status: 'skipped', error, phone: targetPhone, redirectedToTest: redirected });
    return { outcome: 'skipped', error };
  }

  const result = await sendEvolutionText(connection, targetPhone as string, input.message);
  await finishMessage(id, {
    status: result.ok ? 'sent' : 'failed',
    error: result.error,
    phone: targetPhone,
    redirectedToTest: redirected,
  });
  await wait(PAUSE_BETWEEN_SENDS_MS);

  return { outcome: result.ok ? 'sent' : 'failed', error: result.error };
}

export interface JobSummary {
  type: NotificationType;
  /** Technicians the job found something to send to. */
  candidates: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Already sent earlier — not sent again. */
  duplicates: number;
  /** Who did not receive it and why — so the admin doesn't have to dig through the history. */
  problems: Array<{ technician: string; reason: string }>;
}

function emptySummary(type: NotificationType): JobSummary {
  return { type, candidates: 0, sent: 0, failed: 0, skipped: 0, duplicates: 0, problems: [] };
}

function tally(summary: JobSummary, result: DeliveryResult, technicianName: string) {
  const { outcome } = result;

  if (outcome === 'sent') summary.sent += 1;
  else if (outcome === 'failed') summary.failed += 1;
  else if (outcome === 'skipped') summary.skipped += 1;
  else summary.duplicates += 1;

  if (outcome === 'failed' || outcome === 'skipped') {
    summary.problems.push({ technician: technicianName, reason: result.error ?? 'Motivo desconhecido.' });
  }
}

interface TechnicianRow {
  id: string;
  name: string;
  phone: string | null;
}

async function loadActiveTechnicians(organizationId: string, ids?: string[]): Promise<Map<string, TechnicianRow>> {
  const rows = ids
    ? await sql`
        SELECT id::text AS id, name, phone FROM technicians
        WHERE organization_id = ${organizationId} AND status = 'active' AND deleted_at IS NULL AND id::text = ANY(${ids})
      `
    : await sql`
        SELECT id::text AS id, name, phone FROM technicians
        WHERE organization_id = ${organizationId} AND status = 'active' AND deleted_at IS NULL
      `;

  return new Map(rows.map((row) => [String(row.id), { id: String(row.id), name: String(row.name ?? ''), phone: row.phone ? String(row.phone) : null }]));
}

interface ScheduleDay {
  technicianId: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  status: string;
  notes: string;
}

/** The effective (latest) schedule row per technician per day in [startKey, endKey]. */
async function loadScheduleDays(organizationId: string, startKey: string, endKey: string): Promise<ScheduleDay[]> {
  const rows = await sql`
    SELECT DISTINCT ON (s.technician_id, s.date)
      s.technician_id::text AS technician_id,
      to_char(s.date, 'YYYY-MM-DD') AS date_key,
      LEFT(COALESCE(s.start_time::text, ''), 5) AS start_time,
      LEFT(COALESCE(s.end_time::text, ''), 5) AS end_time,
      s.status,
      COALESCE(s.notes, '') AS notes
    FROM schedule s
    WHERE s.organization_id = ${organizationId}
      AND s.date >= ${startKey} AND s.date <= ${endKey}
      AND s.deleted_at IS NULL
    ORDER BY s.technician_id, s.date, s.created_at DESC
  `;

  return rows.map((row) => ({
    technicianId: String(row.technician_id),
    dateKey: String(row.date_key),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    status: String(row.status),
    notes: String(row.notes),
  }));
}

function hasShiftTimes(day: ScheduleDay) {
  return Boolean(day.startTime && day.endTime) && !(day.startTime === '00:00' && day.endTime === '00:00');
}

function isDayOff(day: ScheduleDay) {
  return day.status === 'cancelled' && /folga/i.test(day.notes);
}

/** "Importado do Porto: férias" → "férias"; manual notes → the attendance label. */
function unavailableReason(day: ScheduleDay) {
  const match = /^(?:Importado do Porto|Apontamento manual):\s*([^;]+)/i.exec(day.notes);
  return match?.[1]?.trim() ?? '';
}

function describeScheduleDay(day: ScheduleDay) {
  const prefix = `${formatShortDateKey(day.dateKey)} (${weekdayShortLabel(day.dateKey)})`;

  if (isDayOff(day)) return `${prefix} — Folga`;
  if (day.status === 'cancelled') {
    const reason = unavailableReason(day);
    return `${prefix} — Indisponível${reason ? ` (${reason})` : ''}`;
  }
  if (hasShiftTimes(day)) return `${prefix} — ${day.startTime} às ${day.endTime}`;

  return `${prefix} — Escalado`;
}

function monthBounds(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(lastDay).padStart(2, '0')}` };
}

interface RunContext {
  config: WhatsAppConfig;
  trigger: MessageTrigger;
  createdBy?: string | null;
  now: Date;
}

async function runMonthlySchedule({ config, trigger, createdBy, now }: RunContext) {
  const summary = emptySummary('monthly_schedule');
  const { monthKey } = brasiliaNow(now);
  const { start, end } = monthBounds(monthKey);
  const [technicians, days] = await Promise.all([
    loadActiveTechnicians(config.organizationId),
    loadScheduleDays(config.organizationId, start, end),
  ]);
  const template = config.notifications.monthly_schedule.template;

  const byTechnician = new Map<string, ScheduleDay[]>();
  for (const day of days) {
    byTechnician.set(day.technicianId, [...(byTechnician.get(day.technicianId) ?? []), day]);
  }

  for (const [technicianId, technicianDays] of byTechnician) {
    const technician = technicians.get(technicianId);
    if (!technician) continue;

    summary.candidates += 1;
    const message = renderTemplate(template, {
      nome: firstName(technician.name),
      mes: monthLabel(monthKey),
      escala: technicianDays.map(describeScheduleDay).join('\n'),
    });
    const result = await deliver(config, {
      recipient: technician,
      type: 'monthly_schedule',
      trigger,
      createdBy,
      dedupeKey: `monthly_schedule:${technicianId}:${monthKey}`,
      referenceDate: start,
      message,
    });
    tally(summary, result, technician.name);
  }

  return summary;
}

async function runNextDayShift({ config, trigger, createdBy, now }: RunContext) {
  const summary = emptySummary('next_day_shift');
  const tomorrow = addDaysToKey(brasiliaNow(now).dateKey, 1);
  const [technicians, days] = await Promise.all([
    loadActiveTechnicians(config.organizationId),
    loadScheduleDays(config.organizationId, tomorrow, tomorrow),
  ]);
  const template = config.notifications.next_day_shift.template;

  for (const day of days) {
    const technician = technicians.get(day.technicianId);
    if (!technician || day.status !== 'scheduled' || !hasShiftTimes(day)) continue;

    summary.candidates += 1;
    const message = renderTemplate(template, {
      nome: firstName(technician.name),
      data: formatDateKey(tomorrow),
      dia_semana: weekdayLabel(tomorrow),
      inicio: day.startTime,
      fim: day.endTime,
    });
    const result = await deliver(config, {
      recipient: technician,
      type: 'next_day_shift',
      trigger,
      createdBy,
      dedupeKey: `next_day_shift:${day.technicianId}:${tomorrow}`,
      referenceDate: tomorrow,
      message,
    });
    tally(summary, result, technician.name);
  }

  return summary;
}

async function runDayOff({ config, trigger, createdBy, now }: RunContext) {
  const summary = emptySummary('day_off');
  const today = brasiliaNow(now).dateKey;
  const [technicians, days] = await Promise.all([
    loadActiveTechnicians(config.organizationId),
    loadScheduleDays(config.organizationId, today, today),
  ]);
  const template = config.notifications.day_off.template;

  for (const day of days) {
    const technician = technicians.get(day.technicianId);
    // Only a real "folga" — not férias, atestado or other unavailability, where "ótimo dia de
    // descanso" would read wrong.
    if (!technician || !isDayOff(day)) continue;

    summary.candidates += 1;
    const message = renderTemplate(template, {
      nome: firstName(technician.name),
      data: formatDateKey(today),
      dia_semana: weekdayLabel(today),
    });
    const result = await deliver(config, {
      recipient: technician,
      type: 'day_off',
      trigger,
      createdBy,
      dedupeKey: `day_off:${day.technicianId}:${today}`,
      referenceDate: today,
      message,
    });
    tally(summary, result, technician.name);
  }

  return summary;
}

async function runDailyHours({ config, trigger, createdBy, now }: RunContext) {
  const summary = emptySummary('daily_hours');
  const { dateKey: today, monthKey } = brasiliaNow(now);
  const template = config.notifications.daily_hours.template;

  const [technicians, dayRows, monthRows, settings] = await Promise.all([
    loadActiveTechnicians(config.organizationId),
    sql`
      SELECT technician_id::text AS technician_id,
             SUM(hours_worked)::float AS hours,
             MIN(LEFT(start_time::text, 5)) AS first_start,
             MAX(LEFT(end_time::text, 5)) AS last_end
      FROM work_hours
      WHERE organization_id = ${config.organizationId}
        AND date = ${today}
        AND deleted_at IS NULL
      GROUP BY technician_id
    `,
    sql`
      SELECT technician_id::text AS technician_id, SUM(hours_worked)::float AS hours
      FROM work_hours
      WHERE organization_id = ${config.organizationId}
        AND date >= ${`${monthKey}-01`} AND date <= ${today}
        AND deleted_at IS NULL
      GROUP BY technician_id
    `,
    getOrganizationSettings(config.organizationId),
  ]);

  const monthHours = new Map(monthRows.map((row) => [String(row.technician_id), Number(row.hours ?? 0)]));

  for (const row of dayRows) {
    const technicianId = String(row.technician_id);
    const technician = technicians.get(technicianId);
    const hours = Number(row.hours ?? 0);
    if (!technician || hours <= 0) continue;

    summary.candidates += 1;
    const message = renderTemplate(template, {
      nome: firstName(technician.name),
      data: formatDateKey(today),
      horas: formatHoursValue(hours),
      entrada: String(row.first_start ?? '-'),
      saida: String(row.last_end ?? '-'),
      horas_mes: formatHoursValue(monthHours.get(technicianId) ?? hours),
      meta_mes: formatHoursValue(settings.monthlyHours),
    });
    const result = await deliver(config, {
      recipient: technician,
      type: 'daily_hours',
      trigger,
      createdBy,
      dedupeKey: `daily_hours:${technicianId}:${today}`,
      referenceDate: today,
      message,
    });
    tally(summary, result, technician.name);
  }

  return summary;
}

const SCHEDULED_RUNNERS: Partial<Record<NotificationType, (context: RunContext) => Promise<JobSummary>>> = {
  monthly_schedule: runMonthlySchedule,
  next_day_shift: runNextDayShift,
  day_off: runDayOff,
  daily_hours: runDailyHours,
};

export function isScheduledNotification(type: NotificationType) {
  return Boolean(SCHEDULED_RUNNERS[type]);
}

/**
 * The admin's "Rodar agora": runs one scheduled notification immediately, regardless of its time
 * or on/off switch. Anything already sent is still not sent twice (dedupe keys).
 */
export async function runNotificationNow(
  organizationId: string,
  type: NotificationType,
  options: { createdBy?: string | null; now?: Date } = {},
) {
  const runner = SCHEDULED_RUNNERS[type];
  if (!runner) throw new Error(`"${type}" não é uma notificação agendada.`);

  const config = await getWhatsAppConfig(organizationId);
  return runner({ config, trigger: 'manual', createdBy: options.createdBy, now: options.now ?? new Date() });
}

/**
 * Called by the worker every few minutes: runs each enabled scheduled notification once per
 * period (day, or month for the monthly schedule), inside its time window.
 */
export async function runDueNotifications(
  organizationId: string,
  options: { now?: Date; only?: NotificationType; ignoreTime?: boolean } = {},
) {
  const now = options.now ?? new Date();
  const config = await getWhatsAppConfig(organizationId);
  if (!config.enabled) return [];

  const current = brasiliaNow(now);
  const summaries: JobSummary[] = [];

  for (const type of NOTIFICATION_TYPES) {
    const runner = SCHEDULED_RUNNERS[type];
    const setting = config.notifications[type];
    if (!runner || !setting.enabled || (options.only && options.only !== type)) continue;

    const monthly = NOTIFICATION_DEFINITIONS[type].trigger === 'monthly';
    if (monthly && current.day !== setting.dayOfMonth) continue;

    const scheduledAt = timeToMinutes(setting.time);
    if (!options.ignoreTime) {
      if (scheduledAt === null || current.minutes < scheduledAt || current.minutes >= scheduledAt + CATCH_UP_WINDOW_MINUTES) continue;
    }

    const periodKey = monthly ? current.monthKey : current.dateKey;
    // Claiming the day with no hours imported yet would send nothing and then block the send that
    // follows the night's import (the configured time is often earlier than the 23:00 import).
    if (type === 'daily_hours' && !options.ignoreTime && !(await dailyHoursReady(organizationId, current.dateKey))) continue;
    if (!(await claimJobRun(organizationId, type, periodKey))) continue;

    try {
      summaries.push(await runner({ config, trigger: 'auto', now }));
    } catch (error) {
      console.error(`[whatsapp] scheduled notification "${type}" failed:`, error);
    }
  }

  return summaries;
}

/** https://<slug>.<root domain> of the organization, for links inside messages. */
async function organizationBaseUrl(organizationId: string) {
  const rows = await sql`SELECT slug FROM organizations WHERE id = ${organizationId}`;
  return rows[0] ? organizationPublicUrl(String(rows[0].slug)) : '';
}

/** Event: a payroll was saved as closed. Safe to call on every save — it only ever sends once. */
export async function notifyPayrollClosed(
  organizationId: string,
  params: { technicianId: string; competenceMonth: string; netTotal: number },
) {
  const config = await getWhatsAppConfig(organizationId);
  if (!config.enabled || !config.notifications.payroll_closed.enabled) return null;

  const technician = (await loadActiveTechnicians(organizationId, [params.technicianId])).get(params.technicianId);
  if (!technician) return null;

  const competence = params.competenceMonth.slice(0, 7);
  // Always the organization's own address (<slug>.<root domain>) — nothing to configure.
  const base = await organizationBaseUrl(organizationId);
  const link = base ? `${base.replace(/\/+$/, '')}/dashboard/payroll` : '';
  const message = renderTemplate(config.notifications.payroll_closed.template, {
    nome: firstName(technician.name),
    competencia: monthLabel(competence),
    valor_em_conta: formatCurrency(params.netTotal),
    link,
  });

  return deliver(config, {
    recipient: technician,
    type: 'payroll_closed',
    trigger: 'event',
    dedupeKey: `payroll_closed:${technician.id}:${competence}`,
    referenceDate: `${competence}-01`,
    message,
  });
}

/**
 * Event: days were saved as "Justificou". The admin re-saves whole weeks at a time, so this gets
 * called again for days that were already justified — the dedupe key makes those no-ops.
 */
export async function notifyJustified(
  organizationId: string,
  entries: Array<{ technicianId: string; date: string; notes: string }>,
) {
  if (!entries.length) return [];

  const config = await getWhatsAppConfig(organizationId);
  if (!config.enabled || !config.notifications.justified.enabled) return [];

  const technicians = await loadActiveTechnicians(organizationId, Array.from(new Set(entries.map((entry) => entry.technicianId))));
  const results: DeliveryResult[] = [];

  for (const entry of entries) {
    const technician = technicians.get(entry.technicianId);
    if (!technician) continue;

    const message = renderTemplate(config.notifications.justified.template, {
      nome: firstName(technician.name),
      data: formatDateKey(entry.date),
      observacao: entry.notes.trim(),
    });

    results.push(
      await deliver(config, {
        recipient: technician,
        type: 'justified',
        trigger: 'event',
        dedupeKey: `justified:${technician.id}:${entry.date}`,
        referenceDate: entry.date,
        message,
      }),
    );
  }

  return results;
}

export async function sendTestMessage(
  organizationId: string,
  params: { phone: string; message: string; createdBy: string },
) {
  const config = await getWhatsAppConfig(organizationId);

  return deliver(config, {
    recipient: { id: null, name: null, phone: params.phone },
    type: 'test',
    trigger: 'test',
    dedupeKey: null,
    referenceDate: brasiliaNow().dateKey,
    message: params.message,
    createdBy: params.createdBy,
    ignoreTestRedirect: true,
  });
}

/** Sends a history row's text again, to the technician's current number (it may have been fixed). */
export async function resendMessage(organizationId: string, messageId: string, createdBy: string) {
  const rows = await sql`
    SELECT *, to_char(reference_date, 'YYYY-MM-DD') AS reference_key
    FROM whatsapp_messages
    WHERE id = ${messageId}
      AND organization_id = ${organizationId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;

  const technicianId = row.technician_id ? String(row.technician_id) : null;
  const technician = technicianId ? (await loadActiveTechnicians(organizationId, [technicianId])).get(technicianId) : undefined;
  const config = await getWhatsAppConfig(organizationId);

  return deliver(config, {
    recipient: {
      id: technicianId,
      name: technician?.name ?? (row.technician_name ? String(row.technician_name) : null),
      phone: technician?.phone ?? (row.phone ? String(row.phone) : null),
    },
    type: String(row.type) as NotificationType | 'test',
    trigger: 'manual',
    dedupeKey: null,
    referenceDate: row.reference_key ? String(row.reference_key) : null,
    message: String(row.message),
    createdBy,
    ignoreTestRedirect: row.type === 'test',
  });
}
