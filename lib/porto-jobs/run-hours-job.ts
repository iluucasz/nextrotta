import { decryptPortoPassword } from '../porto-crypto';
import { getEscalaForMonth, type PortoEscalaDay } from '../porto-integration/escala';
import { launchAuthenticatedPortoSession } from '../porto-integration/browser';
import { PortoLoginError } from '../porto-integration/login';
import { listSocorristas } from '../porto-integration/socorristas';
import { getServicoEndTime, searchServicosByDateRange, type PortoServiceEndTime, type PortoServiceRow } from '../porto-integration/servicos';
import { resolveTechnicianByQra } from '../porto-integration/technician-match';
import { formatBrasiliaDateTime, laudoGraceWindow } from '../porto-laudo';
import { isPortoLayoutError } from '../porto-layout';
import { finishSyncLog, getPortoConfig, recordHoursImportResult, startSyncLog } from '../porto-sync-log';
import { sql } from '../db';
import { PORTO_LAUDO_PENDING_MARKER, buildPortoWarningNote, netOfDailyBreak } from '../organization-settings';
import { getOrganizationSettings } from '../organization-settings-store';
import { checkLimit } from '../billing/entitlements';
import {
  applyWorkHourEntries,
  getExistingPortoImportedDates,
  getIsoWeekNumber,
  getManualWorkHourDates,
  getOldestPendingLaudoDate,
  getPendingLaudoDates,
  getPortoWarningDates,
  getStoredPlannedTimes,
  type WorkHourEntry,
} from '../work-hours-service';
import type { Technician } from '../types';

// The daily break, the maximum plausible day, the reprocess window, the warning and the cancelled-day
// rules all come from Configurações (lib/organization-settings.ts), read once per run.
const SEARCH_CHUNK_DAYS = 15; // matches the site's own client-side range cap (see servicos.ts)
// How many of the day's last concluded services (by Hora Prev.) are opened to find the end of work.
const END_CANDIDATE_SERVICES = 3;
// How far back an unattended run reaches for days still waiting for their laudo.
const PENDING_LAUDO_LOOKBACK_DAYS = 14;

function horaPrevMinutes(service: PortoServiceRow): number {
  return /^\d{1,2}:\d{2}$/.test(service.horaAtendimento) ? timeToMinutes(service.horaAtendimento) : -1;
}

/** "yyyy-mm-dd HH:mm" from a service end, so a next-day end (crossed midnight) sorts later. */
function endSortKey(end: PortoServiceEndTime): string {
  const [day, month, year] = (end.endDate ?? '').split('/');
  return `${year}-${month}-${day} ${end.endTime}`;
}

export type HoursJobOptions = {
  /** The organization whose Porto credentials, technicians and hours this run uses. */
  organizationId: string;
  /** Manual test runs (admin UI button) never write real data and always do a full preview. */
  manual: boolean;
  /**
   * Soft cutoff so the job stops itself gracefully instead of getting hard-killed mid-flight.
   * Omit entirely on a host with no execution-time limit (e.g. the VPS worker) to let a run go to
   * full completion.
   */
  timeBudgetMs?: number;
  /**
   * Overrides the default "1st of the month through today" sweep — used by the admin UI's manual
   * test button to check a specific day/range instead of always paying for the whole month. Never
   * honored for unattended cron runs (see route.ts), only for manual: true calls.
   */
  dateRange?: { startDateKey: string; endDateKey: string };
  /**
   * Fires the moment the sync_log row exists (before the slow part starts) — lets a caller that
   * can't/shouldn't block for the whole run (the worker's HTTP server, answering a Vercel proxy
   * that has its own much shorter timeout) respond immediately with the logId and let the job keep
   * running server-side, instead of the caller's own request timing out.
   */
  onStarted?: (logId: string) => void;
  /**
   * Explicit escape hatch for an admin-triggered "Rodar agora" (run for real, on demand) action —
   * unlike a diagnostic manual test, this writes real data even though manual is true. Never set
   * this from a generic "test" code path; only from an action the admin unambiguously understands
   * writes real rows.
   */
  forceWrite?: boolean;
};

export type HoursJobResult = {
  status: 'skipped' | 'dry_run' | 'success' | 'partial' | 'error';
  technicians_processed: number;
  rows_written?: number;
  would_write?: number;
  partial?: boolean;
  error?: string;
  range?: { start: string; end: string };
  /** Count of detail entries per `action`, so "12 processed, 2 written" is explained at a glance. */
  summary?: Record<string, number>;
  /** The failure or warnings point at a Porto screen change — the robot needs a fix on the VPS. */
  layout_suspect?: boolean;
  /**
   * Health checks that didn't stop the run but mean something is likely wrong (Porto changed its
   * layout, a technician isn't registered, many pages failed…). Shown in the run history and sent
   * to the admin's alert WhatsApp by the worker.
   */
  warnings?: string[];
  details: Array<Record<string, unknown>>;
};

function summarizeDetails(details: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const detail of details) {
    const action = typeof detail.action === 'string' ? detail.action : 'unknown';
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getMonthStartKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function brDateToKey(brDate: string): string | null {
  const match = brDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function addDaysToKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Splits [startKey, endKey] into chunks of at most SEARCH_CHUNK_DAYS days each. */
function buildDateChunks(startKey: string, endKey: string): { startDateKey: string; endDateKey: string }[] {
  const chunks: { startDateKey: string; endDateKey: string }[] = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    const chunkEnd = addDaysToKey(cursor, SEARCH_CHUNK_DAYS - 1);
    chunks.push({ startDateKey: cursor, endDateKey: chunkEnd > endKey ? endKey : chunkEnd });
    cursor = addDaysToKey(chunkEnd > endKey ? endKey : chunkEnd, 1);
  }
  return chunks;
}

/**
 * Uses the end's actual date rather than guessing: a shift crossing midnight (end on the next day)
 * adds 24h, while an end earlier than the start on the same day stays negative — and so invalid.
 * Before, any end past the start wrapped silently, so a service closed the next morning (e.g. start
 * 08:00, "Concluído" 08:30 the next day) was recorded as 0.5h instead of being rejected.
 *
 * Nets out the configured daily break, like the admin hour bank does for "previsto" — otherwise
 * "realizado" isn't comparable (confirmed live: Porto-imported hours used to be the raw span,
 * inflating saldo by the whole break on every full workday).
 */
function diffHours(startTime: string, endTime: string, endsNextDay: boolean, dailyBreakMinutes: number) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm) + (endsNextDay ? 24 * 60 : 0);
  return Number(netOfDailyBreak(minutes / 60, dailyBreakMinutes).toFixed(2));
}

/**
 * V1 heuristic, reviewed and accepted by the product owner (2026-08-20):
 *
 * Porto's search-by-date flow (see lib/porto-integration/servicos.ts) does not filter by
 * technician, only by date, and returns technician names as free text — matching a row to a
 * specific technician here is done by name-prefix comparison, not an exact/stable identifier.
 * Accepted trade-off: fine for this team's size, but can misattribute services if two
 * technicians share a name prefix.
 *
 * Workday times (validated live against 05/10/2026 with the product owner):
 * - start: the earliest "Hora Prev." of the day's services, read off the search results.
 * - end: from the day's last service (latest "Hora Prev.") only — its laudo's "Data da assinatura",
 *   or its "Concluído" time plus a warning note when the laudo wasn't filled in. See
 *   getServicoEndTime in lib/porto-integration/servicos.ts.
 * - previsto: the escala's shift times for the day (escala.ts).
 *
 * Coverage: this job sweeps every day from the 1st of the current month through today in one run
 * — not just "today" — since Porto's search form natively supports a date range (capped at 15
 * days by the site itself, so a month past day 15 needs 2+ search chunks). To keep every run
 * cheap after the first catch-up, it skips (technician, date) pairs that already have a
 * `source='porto'` row in `work_hours` — only genuinely new days do the detail lookup.
 *
 * Extracted from app/api/cron/porto-hours/route.ts so both the Vercel route (bounded by
 * maxDuration, hence `timeBudgetMs`) and the VPS worker (no execution-time limit, runs each day
 * to full completion) share one implementation instead of drifting apart.
 */
export async function runHoursJob(options: HoursJobOptions): Promise<HoursJobResult> {
  const startedAt = Date.now();
  const timeBudgetExceeded = () => options.timeBudgetMs !== undefined && Date.now() - startedAt > options.timeBudgetMs;

  const config = await getPortoConfig(options.organizationId);
  const missingCredentials = !config || !config.encrypted_password || !config.cpf;
  if (missingCredentials || (!options.manual && !config.automation_enabled)) {
    const logId = await startSyncLog(options.organizationId, 'hours', options.manual ? 'manual' : 'auto');
    options.onStarted?.(logId);
    const errorMessage = missingCredentials ? 'Credenciais não configuradas.' : 'Automação desligada.';
    // With the automation on, missing credentials is a failure (the worker alerts on 'error'),
    // not a deliberate pause.
    const status = missingCredentials && config?.automation_enabled ? 'error' : 'skipped';
    await finishSyncLog(logId, { status, error_message: errorMessage });
    return { status, technicians_processed: 0, error: errorMessage, details: [] };
  }

  const runLimit = await checkLimit(options.organizationId, 'portoRunsMonth');
  if (!runLimit.allowed) {
    const logId = await startSyncLog(options.organizationId, 'hours', options.manual ? 'manual' : 'auto');
    options.onStarted?.(logId);
    await finishSyncLog(logId, { status: 'skipped', error_message: runLimit.message });
    return { status: 'skipped', technicians_processed: 0, error: runLimit.message, details: [] };
  }

  const logId = await startSyncLog(options.organizationId, 'hours', options.manual ? 'manual' : 'auto');
  options.onStarted?.(logId);
  const settings = await getOrganizationSettings(options.organizationId);
  const details: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  let layoutSuspect = false;
  let techniciansProcessed = 0;
  let importedCount = 0;
  let rowsWritten = 0;
  // Manual test runs never write real data, regardless of the dry_run_only toggle.
  const dryRun = options.forceWrite ? false : options.manual || config.dry_run_only !== false;

  try {
    const password = decryptPortoPassword(config.encrypted_password as string);
    const { browser, page } = await launchAuthenticatedPortoSession({ cpf: config.cpf as string, password });

    try {
      const todayKey = options.dateRange?.endDateKey ?? getTodayKey();
      // Unattended runs sweep the month so far plus yesterday — on the 1st that's the previous
      // month's last day, which otherwise never got the reprocess every other day gets below.
      const monthStartKey = getMonthStartKey();
      const yesterdayKey = addDaysToKey(todayKey, -1);
      let rangeStartKey = options.dateRange?.startDateKey ?? (yesterdayKey < monthStartKey ? yesterdayKey : monthStartKey);
      // A day still waiting for its laudo must be finished even when it falls before this range
      // (e.g. pending on the 30th, next run on the 1st).
      if (!options.dateRange) {
        const oldestPending = await getOldestPendingLaudoDate(options.organizationId, addDaysToKey(todayKey, -PENDING_LAUDO_LOOKBACK_DAYS));
        if (oldestPending && oldestPending < rangeStartKey) rangeStartKey = oldestPending;
      }

      const socorristas = await listSocorristas(page);
      if (!socorristas.length) {
        warnings.push('A lista de socorristas do Porto veio vazia — o portal pode ter mudado de layout.');
        layoutSuspect = true;
      }

      // Resolve all technicians up front so we know which (technician, date) pairs to skip.
      const resolved: Array<{ qra: string; technician: Technician }> = [];
      for (const socorrista of socorristas) {
        techniciansProcessed++;
        const technician = await resolveTechnicianByQra(options.organizationId, socorrista.qra);
        if (!technician) {
          details.push({ qra: socorrista.qra, porto_name: socorrista.name, action: 'skipped_no_match' });
          continue;
        }
        resolved.push({ qra: socorrista.qra, technician });
      }

      // The list's "load more on scroll" endpoint answers 404 (checked live 2026-10-06), so the first
      // page should be the whole roster — but if an active technician ever goes missing from it, say
      // so instead of silently importing nothing for them.
      const listedQras = new Set(socorristas.map((socorrista) => socorrista.qra));
      const activeWithQra = await sql`
        SELECT id, name, qra FROM technicians
        WHERE organization_id = ${options.organizationId}
          AND status = 'active'
          AND deleted_at IS NULL
          AND COALESCE(qra, '') <> ''
      `;
      for (const technician of activeWithQra) {
        if (!listedQras.has(String(technician.qra))) {
          details.push({ qra: technician.qra, technician_id: technician.id, technician_name: technician.name, action: 'technician_not_in_porto_list' });
          warnings.push(`${technician.name} (QRA ${technician.qra}) está ativo no sistema mas não aparece na lista de socorristas do Porto.`);
        }
      }
      // resolveTechnicianByQra takes one of them at random — the cadastro now refuses duplicates,
      // but rows saved before that could still have them.
      const qraCounts = new Map<string, string[]>();
      for (const technician of activeWithQra) {
        const list = qraCounts.get(String(technician.qra)) ?? [];
        list.push(String(technician.name));
        qraCounts.set(String(technician.qra), list);
      }
      for (const [qra, names] of qraCounts) {
        if (names.length > 1) warnings.push(`O QRA ${qra} está em mais de um técnico ativo (${names.join(', ')}) — as horas podem ir para o técnico errado.`);
      }
      if (socorristas.length && !resolved.length) {
        warnings.push('Nenhum socorrista do Porto corresponde a um técnico ativo do sistema — confira os QRAs no cadastro.');
      }

      const technicianIds = resolved.map((r) => r.technician.id);
      const existingDates = await getExistingPortoImportedDates(options.organizationId, technicianIds, rangeStartKey, todayKey);
      // Days an admin entered or corrected by hand always win over Porto — not even the reprocess
      // window below touches them.
      const manualDates = await getManualWorkHourDates(options.organizationId, technicianIds, rangeStartKey, todayKey);
      const storedPlanned = await getStoredPlannedTimes(options.organizationId, technicianIds, rangeStartKey, todayKey);
      // Once a day gets a laudo warning it is never recomputed, not even by the reprocess window
      // below (product owner, 2026-10-06): filling the laudo in afterwards must not remove it.
      const warningDates = await getPortoWarningDates(options.organizationId, technicianIds, rangeStartKey, todayKey);

      // Porto's own escala calendar doesn't finalize a day's shift time until the day is over — a
      // same-day scrape sees a blank/missing time range for "today" (confirmed live: fetching
      // 2026-08-28's escala while it was still the current day returned no start/end time for
      // every technician; the identical fetch the next day returned the normal fixed shift time).
      // That empties `escalaDay.endTime` below, which falls back to the completion time as
      // "previsto" — silently making that day's previsto equal its realizado, hiding any real
      // discrepancy. Force a reprocess of the last two calendar days regardless of the "already
      // imported" dedup so each day's previsto self-corrects the next time it's swept, once
      // Porto's escala has caught up, instead of being stuck forever with the same-day fallback.
      // At least yesterday: a run can happen before the day is over (the time is configurable), so
      // today's partial day must always be finished by the next run.
      const reprocessWindowStart = addDaysToKey(todayKey, -Math.max(1, settings.portoReprocessDays));
      for (const key of Array.from(existingDates)) {
        if (key.slice(-10) >= reprocessWindowStart) {
          existingDates.delete(key);
        }
      }
      // Days waiting for their laudo are recomputed every run until it's filled in or the grace
      // period ends, whatever the reprocess window.
      for (const key of await getPendingLaudoDates(options.organizationId, technicianIds, rangeStartKey, todayKey)) {
        existingDates.delete(key);
      }

      // One search per 15-day chunk covers the whole month-to-date, instead of one per day.
      const chunks = buildDateChunks(rangeStartKey, todayKey);
      // Porto widens each search to its own 15-day window, so consecutive chunks overlap — keep each
      // service once.
      const servicesByCode = new Map<string, PortoServiceRow>();
      for (const chunk of chunks) {
        for (const service of await searchServicosByDateRange(page, chunk)) {
          servicesByCode.set(`${service.numeroServico}/${service.anoServico}`, service);
        }
      }
      const allServices = Array.from(servicesByCode.values());
      if (!allServices.length && rangeStartKey < todayKey) {
        warnings.push(`A busca de serviços do Porto não trouxe nenhum serviço de ${rangeStartKey} a ${todayKey} — o portal pode ter mudado.`);
        layoutSuspect = true;
      }
      if (allServices.length && !allServices.some((service) => /conclu|cancel/i.test(service.status))) {
        warnings.push('A coluna de status dos serviços não foi reconhecida (nenhum "Concluído"/"Cancelado") — nenhum serviço pôde ser contado.');
        layoutSuspect = true;
      }

      const escalaCache = new Map<string, PortoEscalaDay[]>();
      let budgetExceeded = false;

      // The search results carry no QRA, only the socorrista's name cut to 20 characters — matched
      // here against the full names in Porto's own socorristas list (which does carry the QRA), not
      // against the names registered in this system. Validated live (21/09–05/10/2026): every name
      // in the results maps to exactly one socorrista. A name matching none or several is reported
      // and its services skipped rather than credited to the wrong technician.
      const normalizeName = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
      const portoNames = socorristas.map((socorrista) => ({ qra: socorrista.qra, name: normalizeName(socorrista.name) }));
      const servicesByQra = new Map<string, PortoServiceRow[]>();
      const unmatchedNames = new Set<string>();
      const ambiguousNames = new Set<string>();
      for (const service of allServices) {
        const fragment = normalizeName(service.technicianNameFragment);
        const owners = portoNames.filter((socorrista) => socorrista.name.startsWith(fragment));
        if (owners.length === 1) {
          const list = servicesByQra.get(owners[0].qra) ?? [];
          list.push(service);
          servicesByQra.set(owners[0].qra, list);
        } else {
          (owners.length ? ambiguousNames : unmatchedNames).add(fragment);
        }
      }
      if (unmatchedNames.size) {
        details.push({ action: 'service_name_not_in_porto_list', names: Array.from(unmatchedNames) });
        warnings.push(`Serviços com nome de socorrista que não está na lista do Porto (ignorados): ${Array.from(unmatchedNames).join(', ')}.`);
      }
      if (ambiguousNames.size) {
        details.push({ action: 'ambiguous_service_name', names: Array.from(ambiguousNames) });
        warnings.push(`Nome de socorrista que bate com mais de um técnico (serviços ignorados): ${Array.from(ambiguousNames).join(', ')}.`);
      }
      // A socorrista doing services on Porto with no active technician here: their hours are lost
      // silently unless someone registers them (or their QRA) in the system.
      const resolvedQras = new Set(resolved.map((entry) => entry.qra));
      for (const [qra, services] of servicesByQra) {
        const inRange = services.filter((service) => {
          const dateKey = brDateToKey(service.dataProgramada);
          return dateKey && dateKey >= rangeStartKey && dateKey <= todayKey;
        });
        if (!resolvedQras.has(qra) && inRange.length) {
          const name = socorristas.find((socorrista) => socorrista.qra === qra)?.name ?? qra;
          warnings.push(`${name} (QRA ${qra}) tem ${inRange.length} serviço(s) no Porto, mas não há técnico ativo com esse QRA — as horas não são importadas.`);
        }
      }

      const technicianServicesByQra = new Map<string, { technician: Technician; services: PortoServiceRow[] }>();
      for (const { qra, technician } of resolved) {
        const services = servicesByQra.get(qra) ?? [];
        if (!services.length) {
          details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'no_services' });
          continue;
        }
        technicianServicesByQra.set(qra, { technician, services });
      }

      // Group into date -> [technician's services that day], then walk dates most-recent-first.
      // Each (technician, date) detail fetch costs two real page loads against a slow legacy
      // portal (confirmed live: a first full-month catch-up can burn the whole time budget on a
      // single technician's handful of days), so a run can easily get cut off before finishing.
      // Processing most-recent-first means whatever gets cut off is the oldest, least
      // time-sensitive data, and every technician gets a shot at today/yesterday instead of only
      // whichever technician happens to be first in Porto's own listing order.
      const byDate = new Map<string, Array<{ qra: string; technician: Technician; services: PortoServiceRow[] }>>();
      for (const [qra, { technician, services }] of technicianServicesByQra) {
        const byDateForTechnician = new Map<string, PortoServiceRow[]>();
        for (const service of services) {
          const dateKey = brDateToKey(service.dataProgramada);
          // Porto's search returns a 15-day window of its own choosing, not the dates asked for
          // (see runServiceSearch) — never import a day outside this run's range (another month,
          // whose escala isn't the one loaded here, or a future day that hasn't happened yet).
          if (!dateKey || dateKey < rangeStartKey || dateKey > todayKey) continue;
          const list = byDateForTechnician.get(dateKey) ?? [];
          list.push(service);
          byDateForTechnician.set(dateKey, list);
        }
        for (const [dateKey, servicesForDay] of byDateForTechnician) {
          const list = byDate.get(dateKey) ?? [];
          list.push({ qra, technician, services: servicesForDay });
          byDate.set(dateKey, list);
        }
      }

      const sortedDateKeys = Array.from(byDate.keys()).sort().reverse();
      const endTimeOptions = { useLaudoConclusion: settings.portoUseLaudoConclusion };

      // The day's "previsto": the escala's shift for current-month days; for a day from another
      // month (yesterday on the 1st, or a manual run over past dates) only the current month's
      // escala is readable, so it keeps the previsto already recorded.
      const resolvePlanned = async (qra: string, technician: Technician, dateKey: string, fallbackEnd: string) => {
        const planned = { start: settings.defaultShiftStart, end: fallbackEnd };
        if (!dateKey.startsWith(monthStartKey.slice(0, 7))) {
          // Nothing recorded yet for that day: the standard shift, not the day's own times.
          return storedPlanned.get(`${technician.id}::${dateKey}`) ?? { start: settings.defaultShiftStart, end: settings.defaultShiftEnd };
        }
        try {
          if (!escalaCache.has(qra)) {
            // Only the shift times are needed here, so skip opening each indisponibilidade day
            // (measured live: 68s vs 5s per technician with 11 marked days).
            escalaCache.set(qra, await getEscalaForMonth(page, qra, { resolveUnavailability: false }));
          }
          const escalaDay = (escalaCache.get(qra) ?? []).find((day) => day.day === Number(dateKey.slice(8, 10)));
          planned.start = escalaDay?.startTime ?? settings.defaultShiftStart;
          // The scheduled end of shift, not the actual completion time — otherwise "previsto" in the
          // schedule UI always shows the same value as the real time next to it. Falls back to the
          // real end only when the escala genuinely has no end time recorded.
          planned.end = escalaDay?.endTime ?? fallbackEnd;
        } catch (escalaError) {
          details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'escala_fetch_failed_fallback_0800', date: dateKey, error: escalaError instanceof Error ? escalaError.message : String(escalaError) });
        }
        return planned;
      };

      // Writes one (technician, date) — not batched — so a run cut short still keeps every day
      // computed so far. In dry-run it only reports what would be written.
      const recordDay = async (qra: string, technician: Technician, entry: WorkHourEntry, summary: Record<string, unknown>) => {
        importedCount++;
        const detail = { qra, technician_id: technician.id, technician_name: technician.name, date: entry.date, hoursWorked: entry.hours_worked, ...summary };
        if (dryRun) {
          details.push({ action: 'would_import', ...detail });
          return;
        }
        const result = await applyWorkHourEntries(options.organizationId, [entry], { source: 'porto' });
        rowsWritten += result.count;
        details.push({ action: 'imported', ...detail });
      };

      const buildEntry = (technician: Technician, dateKey: string, fields: Pick<WorkHourEntry, 'start_time' | 'end_time' | 'planned_start_time' | 'planned_end_time' | 'hours_worked' | 'attendance_status' | 'notes'>): WorkHourEntry => ({
        technician_id: technician.id,
        date: dateKey,
        week_number: getIsoWeekNumber(dateKey),
        month: Number(dateKey.slice(5, 7)),
        year: Number(dateKey.slice(0, 4)),
        ...fields,
      });

      dateLoop:
      for (const dateKey of sortedDateKeys) {
        if (timeBudgetExceeded()) {
          budgetExceeded = true;
          break dateLoop;
        }

        for (const { qra, technician, services: servicesForDay } of byDate.get(dateKey)!) {
          if (timeBudgetExceeded()) {
            budgetExceeded = true;
            break dateLoop;
          }

          const dedupKey = `${technician.id}::${dateKey}`;
          if (manualDates.has(dedupKey)) {
            details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'manual_entry_kept', date: dateKey });
            continue;
          }
          if (warningDates.has(dedupKey)) {
            details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'warning_kept', date: dateKey });
            continue;
          }
          if (existingDates.has(dedupKey)) {
            details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'already_imported', date: dateKey });
            continue;
          }

          // Only services the technician actually carried out count — "Cancelado" and "Aceite"
          // (accepted, never executed) carry stray timestamps (confirmed live: an "Aceite" service
          // with Hora Prev. 17:19 put the day's end at 07:39 and would have triggered a bogus
          // warning). If the status column couldn't be read at all, fall back to every service.
          const statusKnown = servicesForDay.some((service) => service.status);
          const workedServices = statusKnown ? servicesForDay.filter((service) => /^conclu/i.test(service.status)) : servicesForDay;
          if (!workedServices.length) {
            // A day with only cancelled services is still recorded, as "Serviço cancelado"
            // (product owner, 2026-10-06). Cancelled services have an empty timeline (checked
            // live), so the hours run from the earliest Hora Prev. to the latest laudo signature
            // (or laudo conclusion) when a laudo exists; without one Porto has no end time at all
            // and the day is recorded with 0h and a note to adjust it by hand.
            const cancelledServices = settings.portoRecordCancelledDays ? servicesForDay.filter((service) => /cancel/i.test(service.status)) : [];
            if (!cancelledServices.length) {
              details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'no_concluded_service', date: dateKey, statuses: servicesForDay.map((service) => service.status) });
              continue;
            }

            let latestEnd: PortoServiceEndTime | null = null;
            let cancelledFailed = false;
            for (const service of cancelledServices) {
              try {
                const end = await getServicoEndTime(page, dateKey, { anoServico: service.anoServico, numeroServico: service.numeroServico }, endTimeOptions);
                if (end.endTime && (!latestEnd || endSortKey(end) > endSortKey(latestEnd))) latestEnd = end;
              } catch (detailError) {
                details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'service_detail_failed', date: dateKey, service: `${service.numeroServico}/${service.anoServico}`, error: detailError instanceof Error ? detailError.message.slice(0, 300) : String(detailError) });
                cancelledFailed = true;
                break;
              }
            }
            if (cancelledFailed) continue;

            const codes = cancelledServices.map((service) => `${service.numeroServico}/${service.anoServico}`).join(', ');
            const firstPrev = cancelledServices
              .map((service) => service.horaAtendimento)
              .filter((value) => /^\d{1,2}:\d{2}$/.test(value))
              .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))[0];
            // The previsto is the shift the technician was scheduled for, never the cancellation's times.
            const planned = await resolvePlanned(qra, technician, dateKey, settings.defaultShiftEnd);
            const startTime = firstPrev ?? planned.start;
            let endTime = startTime;
            let hours = 0;
            if (latestEnd?.endTime) {
              const nextDay = latestEnd.endDate !== null && latestEnd.endDate !== dateKey.split('-').reverse().join('/');
              const span = diffHours(startTime, latestEnd.endTime, nextDay, settings.dailyBreakMinutes);
              if (span > 0 && span <= settings.portoMaxShiftHours) {
                hours = span;
                endTime = latestEnd.endTime;
              }
            }
            const cancelledNote = hours > 0
              ? `Importado automaticamente do Porto Seguro. Serviço cancelado (${codes}) — horas da Hora Prev. até o laudo.`
              : `Importado automaticamente do Porto Seguro. Serviço cancelado (${codes}) — o Porto não registra horário de fim; ajuste à mão se houve deslocamento.`;

            await recordDay(
              qra,
              technician,
              buildEntry(technician, dateKey, {
                start_time: startTime,
                end_time: endTime,
                planned_start_time: planned.start,
                planned_end_time: planned.end,
                hours_worked: hours,
                attendance_status: 'cancelled_service',
                notes: cancelledNote,
              }),
              { start: startTime, end: endTime, endSource: hours > 0 ? latestEnd?.endSource : null, service: codes, cancelled: true },
            );
            continue;
          }

          // End of the workday: the latest end among the day's last END_CANDIDATE_SERVICES
          // concluded services by "Hora Prev." — each one's laudo "Data da assinatura", or its
          // "Concluído" time when the laudo wasn't filled in (see getServicoEndTime). More than one
          // because Hora Prev. is a forecast, not always the real order (confirmed live: a service
          // with Hora Prev. 17:00 was signed at 14:00 while an earlier-forecast one ended 15:32).
          const endCandidates = [...workedServices]
            .sort((a, b) => horaPrevMinutes(b) - horaPrevMinutes(a))
            .slice(0, END_CANDIDATE_SERVICES);

          // A flaky service page (stuck modal, navigation hiccup on Porto's legacy JSF app —
          // confirmed live: a leftover RichFaces error modal blocked every subsequent click for the
          // rest of the run) shouldn't abort the whole month's import. The day is left unimported
          // instead of guessed from fewer services, so the next run retries it.
          let endInfo: PortoServiceEndTime | null = null;
          let endService: PortoServiceRow | null = null;
          let detailFailed = false;
          const openedEnds: PortoServiceEndTime[] = [];
          for (const candidate of endCandidates) {
            // A technician runs one service at a time, so a service forecast to start before the
            // best end found so far can't have ended after it — stop opening pages.
            if (endInfo && `${dateKey} ${candidate.horaAtendimento.padStart(5, '0')}` <= endSortKey(endInfo)) break;
            const candidateCode = `${candidate.numeroServico}/${candidate.anoServico}`;
            let candidateEnd: PortoServiceEndTime;
            try {
              candidateEnd = await getServicoEndTime(page, dateKey, { anoServico: candidate.anoServico, numeroServico: candidate.numeroServico }, endTimeOptions);
            } catch (detailError) {
              details.push({
                qra,
                technician_id: technician.id,
                technician_name: technician.name,
                action: 'service_detail_failed',
                date: dateKey,
                service: candidateCode,
                error: detailError instanceof Error ? detailError.message.slice(0, 300) : String(detailError),
              });
              detailFailed = true;
              break;
            }
            openedEnds.push(candidateEnd);
            if (candidateEnd.laudo === 'not_found' || candidateEnd.laudo === 'failed') {
              details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'laudo_unreadable_used_concluido', date: dateKey, service: candidateCode, laudo: candidateEnd.laudo, laudoError: candidateEnd.laudoError });
            }
            if (candidateEnd.endTime && (!endInfo || endSortKey(candidateEnd) > endSortKey(endInfo))) {
              endInfo = candidateEnd;
              endService = candidate;
            }
          }
          if (detailFailed) continue;

          if (!endInfo?.endTime || !endService) {
            details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'no_completion_time', date: dateKey, services: endCandidates.map((service) => `${service.numeroServico}/${service.anoServico}`) });
            continue;
          }
          const workEnd = endInfo.endTime;
          const serviceCode = `${endService.numeroServico}/${endService.anoServico}`;

          // Only a magnifier found and disabled is the technician's fault. `not_found`/`failed` mean
          // we couldn't read the laudo — logged above, never turned into a warning. The warning
          // itself can be switched off in Configurações (the end still comes from "Concluído").
          // The technician gets `portoLaudoGraceHours` after "Concluído" to fill it in: a run
          // inside that window marks the day pending instead of giving a warning that's never undone,
          // so the configured import time doesn't decide who gets warned.
          const laudoUnavailable = endInfo.laudo === 'unavailable' && settings.portoWarningEnabled;
          const { graceEndsAt, pending } = laudoGraceWindow({
            endDate: endInfo.endDate ?? dateKey.split('-').reverse().join('/'),
            workEnd,
            graceHours: settings.portoLaudoGraceHours,
          });
          const laudoPending = laudoUnavailable && pending;
          const laudoMissing = laudoUnavailable && !laudoPending;

          // Real start of the day's work: the earliest "Hora Prevista" (cap_horaAtendimento)
          // among the day's concluded services — re-validated live (05/10/2026) against the
          // portal's "HORA PREV." column. NOT the neighboring "Hora Comb."
          // (cap_horaProgramadaAtendimento), the static slot Porto sets (typically 08:00).
          const earliestStart = workedServices
            .map((service) => service.horaAtendimento)
            .filter((value) => /^\d{1,2}:\d{2}$/.test(value))
            .reduce((earliest: string | null, current) => (!earliest || timeToMinutes(current) < timeToMinutes(earliest) ? current : earliest), null);

          const { start: plannedStart, end: plannedEnd } = await resolvePlanned(qra, technician, dateKey, workEnd);

          // Hora Prev. is a forecast: with no usable value, or one that lands after the day's end
          // (e.g. a single service forecast for 17:00 but signed at 14:00), the start comes from the
          // status timeline ("Em Execução", else "Em Deslocamento") of the services already opened.
          let actualStart = earliestStart ?? plannedStart;
          const startsAfterEnd = `${dateKey} ${actualStart.padStart(5, '0')}` > endSortKey(endInfo);
          if (!earliestStart || startsAfterEnd) {
            const timelineStart = openedEnds
              .map((opened) => opened.timelineStart)
              .filter((value): value is string => Boolean(value))
              .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))[0];
            if (timelineStart) {
              details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'start_from_timeline', date: dateKey, horaPrev: earliestStart, timelineStart });
              actualStart = timelineStart;
            } else if (!earliestStart) {
              details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'start_time_fallback_escala', date: dateKey });
            }
          }

          const endsNextDay = endInfo.endDate !== null && endInfo.endDate !== dateKey.split('-').reverse().join('/');
          const hoursWorked = diffHours(actualStart, workEnd, endsNextDay, settings.dailyBreakMinutes);
          if (hoursWorked <= 0 || hoursWorked > settings.portoMaxShiftHours) {
            details.push({ qra, technician_id: technician.id, technician_name: technician.name, action: 'invalid_hours', date: dateKey, actualStart, workEnd, endSource: endInfo.endSource, service: serviceCode, hoursWorked });
            continue;
          }

          // The fixed "ADVERTÊNCIA:" marker is what getPortoWarningDates keys on — never recompute.
          // "LAUDO PENDENTE:" is what getPendingLaudoDates keys on — recompute every run.
          const notes = laudoMissing
            ? `Importado automaticamente do Porto Seguro. ${buildPortoWarningNote(settings.portoWarningText, serviceCode)}`
            : laudoPending
              ? `Importado automaticamente do Porto Seguro. ${PORTO_LAUDO_PENDING_MARKER} serviço ${serviceCode} concluído sem laudo; prazo para preencher até ${formatBrasiliaDateTime(graceEndsAt)}.`
              : 'Importado automaticamente do Porto Seguro.';

          await recordDay(
            qra,
            technician,
            buildEntry(technician, dateKey, {
              start_time: actualStart,
              end_time: workEnd,
              planned_start_time: plannedStart,
              planned_end_time: plannedEnd,
              hours_worked: hoursWorked,
              attendance_status: 'worked',
              notes,
            }),
            {
              start: actualStart,
              end: workEnd,
              endSource: endInfo.endSource,
              service: serviceCode,
              laudo: endInfo.laudo,
              warning: laudoMissing || undefined,
              laudoPendingUntil: laudoPending ? graceEndsAt.toISOString() : undefined,
            },
          );
        }
      }

      if (budgetExceeded) {
        details.push({
          action: 'time_budget_exceeded_stopping_early',
          note: 'Execução parou antes do limite de tempo da function. Os dias/técnicos restantes serão processados na próxima execução (nada é perdido — dias já gravados continuam marcados como importados).',
        });
      }

      const range = { start: rangeStartKey, end: todayKey };
      const summary = summarizeDetails(details);

      // Many pages failing or laudos unreadable in one run usually means Porto changed something.
      const failedPages = summary.service_detail_failed ?? 0;
      if (failedPages >= 3) {
        warnings.push(`${failedPages} serviço(s) não puderam ser abertos no Porto — os dias ficaram para a próxima execução.`);
        layoutSuspect = true;
      }
      const unreadableLaudos = summary.laudo_unreadable_used_concluido ?? 0;
      if (unreadableLaudos >= 3) {
        warnings.push(`${unreadableLaudos} laudo(s) não puderam ser lidos — o fim do dia usou o Concluído (sem advertência). A página do laudo pode ter mudado.`);
        layoutSuspect = true;
      }
      const invalidDays = summary.invalid_hours ?? 0;
      if (invalidDays) warnings.push(`${invalidDays} dia(s) com horas fora do plausível (0 ou acima de ${settings.portoMaxShiftHours}h) ficaram sem apontamento — confira à mão.`);
      if (budgetExceeded) warnings.push('A execução parou por limite de tempo; o restante fica para a próxima.');
      const warningMessage = warnings.length ? `Atenção: ${warnings.join(' | ')}` : null;

      if (dryRun) {
        await finishSyncLog(logId, {
          status: 'dry_run',
          technicians_processed: techniciansProcessed,
          rows_written: importedCount,
          details,
          range,
          error_message: warningMessage,
          layout_suspect: layoutSuspect,
        });
        return { status: 'dry_run', technicians_processed: techniciansProcessed, would_write: importedCount, partial: budgetExceeded, range, summary, warnings, layout_suspect: layoutSuspect, details };
      }

      const overallStatus = budgetExceeded ? 'partial' : importedCount ? 'success' : 'partial';
      await recordHoursImportResult(options.organizationId, { status: overallStatus, error: warningMessage });
      await finishSyncLog(logId, {
        status: overallStatus,
        technicians_processed: techniciansProcessed,
        rows_written: rowsWritten,
        details,
        range,
        error_message: warningMessage,
        layout_suspect: layoutSuspect,
      });

      return { status: overallStatus, technicians_processed: techniciansProcessed, rows_written: rowsWritten, partial: budgetExceeded, range, summary, warnings, layout_suspect: layoutSuspect, details };
    } finally {
      await browser.close();
    }
  } catch (error) {
    // The underlying error goes along (trimmed): it's what makes the history and the WhatsApp alert actionable.
    const message =
      error instanceof PortoLoginError
        ? error.message
        : `Erro inesperado ao importar horas do Porto: ${error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : String(error)}`;
    console.error('[porto-jobs/hours] error:', error);
    const layoutError = isPortoLayoutError(error);
    if (!options.manual) {
      await recordHoursImportResult(options.organizationId, { status: 'error', error: message });
    }
    await finishSyncLog(logId, { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, details, error_message: message, layout_suspect: layoutError });
    return { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, error: message, summary: summarizeDetails(details), layout_suspect: layoutError, details };
  }
}
