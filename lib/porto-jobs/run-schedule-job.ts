import { decryptPortoPassword } from '../porto-crypto';
import { launchAuthenticatedPortoSession } from '../porto-integration/browser';
import { getEscalaForMonth } from '../porto-integration/escala';
import { getOrganizationSettings } from '../organization-settings-store';
import { PortoLoginError } from '../porto-integration/login';
import { listSocorristas } from '../porto-integration/socorristas';
import { resolveTechnicianByQra } from '../porto-integration/technician-match';
import { checkLimit } from '../billing/entitlements';
import { isPortoLayoutError } from '../porto-layout';
import { finishSyncLog, getPortoConfig, recordScheduleImportResult, startSyncLog } from '../porto-sync-log';
import { replacePortoScheduleRows, PORTO_SCHEDULE_NOTE_PREFIX } from '../schedule-write-service';
import type { ScheduleSeedRow } from '../schedule-planner';

export type ScheduleJobOptions = {
  /** The organization whose Porto credentials, technicians and schedule this run uses. */
  organizationId: string;
  /** Manual test runs (admin UI button) always run the full preview, never write real data. */
  manual: boolean;
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

export type ScheduleJobResult = {
  status: 'skipped' | 'dry_run' | 'success' | 'partial' | 'error';
  technicians_processed: number;
  rows_written?: number;
  would_write?: number;
  error?: string;
  summary?: Record<string, number>;
  /** Health checks that didn't stop the run but mean something is likely wrong (see the hours job). */
  warnings?: string[];
  /** The failure or warnings point at a Porto screen change — the robot needs a fix on the VPS. */
  layout_suspect?: boolean;
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

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getMonthDateRange(monthOffset: number) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = target.getFullYear();
  const month = target.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    year,
    month,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/**
 * Extracted from app/api/cron/porto-schedule/route.ts so both the Vercel route and the VPS worker
 * share one implementation. Unlike the hours job, this one has no time-budget concern in
 * practice — one escala fetch per technician, not per-service — so no timeBudgetMs parameter.
 */
export async function runScheduleJob(options: ScheduleJobOptions): Promise<ScheduleJobResult> {
  const config = await getPortoConfig(options.organizationId);
  const missingCredentials = !config || !config.encrypted_password || !config.cpf;
  if (missingCredentials || (!options.manual && !config.automation_enabled)) {
    const logId = await startSyncLog(options.organizationId, 'schedule', options.manual ? 'manual' : 'auto');
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
    const logId = await startSyncLog(options.organizationId, 'schedule', options.manual ? 'manual' : 'auto');
    options.onStarted?.(logId);
    await finishSyncLog(logId, { status: 'skipped', error_message: runLimit.message });
    return { status: 'skipped', technicians_processed: 0, error: runLimit.message, details: [] };
  }

  const currentMonthKey = getCurrentMonthKey();

  const logId = await startSyncLog(options.organizationId, 'schedule', options.manual ? 'manual' : 'auto');
  options.onStarted?.(logId);
  const settings = await getOrganizationSettings(options.organizationId);
  const details: Array<Record<string, unknown>> = [];
  let techniciansProcessed = 0;
  let rowsWritten = 0;

  try {
    const password = decryptPortoPassword(config.encrypted_password as string);
    const { browser, page } = await launchAuthenticatedPortoSession({ cpf: config.cpf as string, password });

    try {
      // Every run re-imports the escala from today to the end of the month. It used to import a
      // month once and then only check the portal was up, so folgas/trocas entered on Porto
      // mid-month never reached the schedule — which the WhatsApp shift reminders read. Past days
      // are left alone (they hold what actually happened), as are completed and manual rows.
      const socorristas = await listSocorristas(page);
      const todayKey = getTodayKey();
      const current = getMonthDateRange(0);
      // In the month's last days the next month is read too, so the shift reminder for the 1st
      // (sent the evening before) has an escala to read. Imported only for technicians whose next
      // month is already published on Porto (validated live 06/10/2026: November was).
      const months = [{ offset: 0, ...current, startDate: todayKey }];
      // Configurações → "Escala do mês seguinte": how many days before the month ends (0 = never).
      if (Number(current.endDate.slice(8, 10)) - Number(todayKey.slice(8, 10)) < settings.portoNextMonthLookaheadDays) {
        const next = getMonthDateRange(1);
        months.push({ offset: 1, ...next, startDate: `${next.year}-${String(next.month).padStart(2, '0')}-01` });
      }
      const rowsByMonth = months.map(() => [] as ScheduleSeedRow[]);
      const technicianIdsByMonth = months.map(() => [] as string[]);

      for (const socorrista of socorristas) {
        techniciansProcessed++;
        const technician = await resolveTechnicianByQra(options.organizationId, socorrista.qra);
        if (!technician) {
          details.push({ qra: socorrista.qra, porto_name: socorrista.name, action: 'skipped_no_match' });
          continue;
        }

        for (const [index, { offset, year, month, startDate }] of months.entries()) {
          let escalaDays;
          try {
            escalaDays = await getEscalaForMonth(page, socorrista.qra, { monthOffset: offset, fullDayOffPercent: settings.portoFullDayOffPercent });
          } catch (escalaError) {
            // A navigation hiccup for one technician shouldn't abort the whole import — log it and
            // move on; that technician's rows for the month are left untouched.
            details.push({ qra: socorrista.qra, technician_id: technician.id, technician_name: technician.name, action: 'escala_fetch_failed', month: `${year}-${month}`, error: escalaError instanceof Error ? escalaError.message : String(escalaError) });
            continue;
          }

          // No escala at all on Porto for the month (next month not published yet, or a technician
          // without escala — on leave, the account owner): leave that technician's rows alone.
          // Replacing them would wipe whatever schedule exists in the system and put nothing back,
          // every night now that the import runs daily.
          const published = escalaDays.some((day) => day.startTime || day.endTime || day.unavailable);
          if (!published) {
            details.push({
              qra: socorrista.qra,
              technician_id: technician.id,
              technician_name: technician.name,
              action: offset > 0 ? 'next_month_not_published' : 'no_escala_on_porto',
              month: `${year}-${month}`,
            });
            continue;
          }
          technicianIdsByMonth[index].push(technician.id);

          let daysWithoutEscalaData = 0;
          for (const day of escalaDays) {
            // Some accounts have no escala time at all for any day (confirmed live: the account
            // owner's own QRA, plus at least one technician on extended leave — Porto just renders
            // an empty cell, not an indisponibilidade-marked one). Writing "scheduled 00:00-00:00"
            // for those is misleading (looks like a real, zero-length shift) — skip the row entirely
            // instead when there's truly nothing to report.
            if (!day.startTime && !day.endTime && !day.unavailable) {
              daysWithoutEscalaData++;
              continue;
            }

            const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
            if (dateKey < startDate) continue;
            const reason = day.unavailable ? day.reason || 'indisponibilidade' : 'escala normal';

            // schedule.start_time/end_time expect a valid time literal even on non-working days —
            // mirrors the fallback convention already used by buildPersistedSchedule in schedule-planner.ts.
            rowsByMonth[index].push({
              technician_id: technician.id,
              date: dateKey,
              start_time: day.startTime ?? '00:00',
              end_time: day.endTime ?? '00:00',
              status: day.unavailable ? 'cancelled' : 'scheduled',
              notes: `${PORTO_SCHEDULE_NOTE_PREFIX} ${reason}`,
            });
          }

          details.push({
            qra: socorrista.qra,
            technician_id: technician.id,
            technician_name: technician.name,
            action: 'imported',
            month: `${year}-${month}`,
            days: escalaDays.length - daysWithoutEscalaData,
            daysWithoutEscalaData: daysWithoutEscalaData || undefined,
          });
        }
      }
      const rows = rowsByMonth.flat();

      const warnings: string[] = [];
      const checked = summarizeDetails(details);
      if (!socorristas.length) warnings.push('A lista de socorristas do Porto veio vazia — o portal pode ter mudado de layout.');
      if (socorristas.length && !technicianIdsByMonth[0].length && (checked.no_escala_on_porto ?? 0) > 0) {
        warnings.push('Nenhum técnico tem escala no Porto para este mês — nada foi importado. O calendário pode ter mudado.');
      }
      if (checked.escala_fetch_failed) warnings.push(`${checked.escala_fetch_failed} escala(s) de técnico não puderam ser abertas — ficaram como estavam.`);
      // One technician's escala failing is a hiccup; none of them opening is the calendar changing.
      const layoutSuspect =
        !socorristas.length ||
        (!technicianIdsByMonth[0].length && ((checked.no_escala_on_porto ?? 0) > 0 || (checked.escala_fetch_failed ?? 0) > 0));
      const warningMessage = warnings.length ? `Atenção: ${warnings.join(' | ')}` : null;

      const dryRun = options.forceWrite ? false : options.manual || config.dry_run_only !== false;

      if (dryRun) {
        // Modo teste: calcula o que seria importado mas não grava, e não marca o mês como
        // importado — senão, ao desligar o modo teste, o import real seria pulado por engano.
        rowsWritten = rows.length;
        await finishSyncLog(logId, {
          status: 'dry_run',
          technicians_processed: techniciansProcessed,
          rows_written: rowsWritten,
          details,
          error_message: warningMessage,
          layout_suspect: layoutSuspect,
        });
        return { status: 'dry_run', technicians_processed: techniciansProcessed, would_write: rowsWritten, summary: summarizeDetails(details), warnings, layout_suspect: layoutSuspect, details };
      }

      for (const [index, { startDate, endDate }] of months.entries()) {
        if (!technicianIdsByMonth[index].length || !rowsByMonth[index].length) continue;
        const { inserted } = await replacePortoScheduleRows({
          organizationId: options.organizationId,
          technicianIds: technicianIdsByMonth[index],
          startDate,
          endDate,
          rows: rowsByMonth[index],
        });
        rowsWritten += inserted.length;
      }

      const overallStatus = technicianIdsByMonth[0].length ? 'success' : 'partial';
      await recordScheduleImportResult(options.organizationId, { monthKey: currentMonthKey, status: overallStatus, error: warningMessage });
      await finishSyncLog(logId, {
        status: overallStatus,
        technicians_processed: techniciansProcessed,
        rows_written: rowsWritten,
        details,
        error_message: warningMessage,
        layout_suspect: layoutSuspect,
      });

      return { status: overallStatus, technicians_processed: techniciansProcessed, rows_written: rowsWritten, summary: summarizeDetails(details), warnings, layout_suspect: layoutSuspect, details };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const message =
      error instanceof PortoLoginError
        ? error.message
        : `Erro inesperado ao importar escala do Porto: ${error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : String(error)}`;
    console.error('[porto-jobs/schedule] error:', error);
    const layoutError = isPortoLayoutError(error);
    if (!options.manual) {
      await recordScheduleImportResult(options.organizationId, { monthKey: currentMonthKey, status: 'error', error: message });
    }
    await finishSyncLog(logId, { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, details, error_message: message, layout_suspect: layoutError });
    return { status: 'error', technicians_processed: techniciansProcessed, rows_written: rowsWritten, error: message, summary: summarizeDetails(details), layout_suspect: layoutError, details };
  }
}
