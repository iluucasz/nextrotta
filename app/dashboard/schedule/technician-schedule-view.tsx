'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { formatDate, formatTime, formatTimeRange } from '@/lib/formatters';
import { enumerateDateKeys, normalizeDateKey } from '@/lib/schedule-planner';
import type { Schedule } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useTechnicianVisibility } from '@/hooks/use-technician-visibility';
import { resolveAllowedMonth } from '@/lib/technician-visibility';

type PeriodMode = 'week' | 'month';

interface ScheduleViewEntry {
  date: string;
  entry?: Schedule;
}

interface MonthCalendarCell {
  key: string;
  date?: string;
  entry?: Schedule;
  isEmpty?: boolean;
}

interface ScheduleFilterActionProps {
  periodMode: PeriodMode;
  onPeriodModeChange: (value: PeriodMode) => void;
  selectedMonth: string;
  onSelectedMonthChange: (value: string) => void;
  monthOptions: string[];
}

const periodLabels: Record<PeriodMode, string> = {
  week: 'semanal',
  month: 'mensal',
};

const weekdayShortLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'];
const weekdayLongLabels = ['Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado', 'Domingo'];

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluido';
  return 'Escalado';
}

function getStatusTone(status: Schedule['status']) {
  if (status === 'cancelled') return 'warning' as const;
  if (status === 'completed') return 'success' as const;
  return 'info' as const;
}

function getSchedulePriority(status: Schedule['status']) {
  if (status === 'scheduled') return 3;
  if (status === 'completed') return 2;
  return 1;
}

function getScheduleTimestamp(entry: Schedule) {
  const timestamp = Date.parse(entry.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBestScheduleEntry(entries: Schedule[]) {
  return entries.reduce<Schedule | undefined>((best, entry) => {
    if (!best) return entry;

    const entryTimestamp = getScheduleTimestamp(entry);
    const bestTimestamp = getScheduleTimestamp(best);

    if (entryTimestamp > bestTimestamp || (entryTimestamp === bestTimestamp && getSchedulePriority(entry.status) > getSchedulePriority(best.status))) {
      return entry;
    }

    return best;
  }, undefined);
}

function getMonthValue(value: string) {
  return normalizeDateKey(value).slice(0, 7);
}

function formatMonthLabel(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, 1));

  return date.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function getWeekRange(dateValue: string) {
  const dateKey = normalizeDateKey(dateValue);
  const start = new Date(`${dateKey}T00:00:00Z`);

  if (Number.isNaN(start.getTime())) return null;

  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getWeekdayColumnIndex(dateValue: string) {
  const date = new Date(`${normalizeDateKey(dateValue)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  return (date.getUTCDay() + 6) % 7;
}

function formatWeekdayLabel(dateValue: string, variant: 'short' | 'long' = 'short') {
  const labels = variant === 'long' ? weekdayLongLabels : weekdayShortLabels;
  return labels[getWeekdayColumnIndex(dateValue)] ?? 'Dia';
}

function buildMonthCalendarCells(entries: ScheduleViewEntry[], monthValue: string) {
  const monthRange = getMonthRange(monthValue);
  const leadingCells: MonthCalendarCell[] = Array.from({ length: getWeekdayColumnIndex(monthRange.start) }, (_, index) => ({
    key: `leading-${monthValue}-${index}`,
    isEmpty: true,
  }));

  const filledCells: MonthCalendarCell[] = entries.map((item) => ({
    key: item.date,
    date: item.date,
    entry: item.entry,
  }));

  const allCells: MonthCalendarCell[] = [...leadingCells, ...filledCells];
  const trailingCount = allCells.length % 7 === 0 ? 0 : 7 - (allCells.length % 7);
  const trailingCells: MonthCalendarCell[] = Array.from({ length: trailingCount }, (_, index) => ({
    key: `trailing-${monthValue}-${index}`,
    isEmpty: true,
  }));

  return [...allCells, ...trailingCells];
}

function getMonthRange(monthValue: string) {
  const [year, month] = monthValue.split('-').map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : 1;
  const monthIndex = Math.max(safeMonth - 1, 0);
  const start = new Date(Date.UTC(safeYear, monthIndex, 1));
  const end = new Date(Date.UTC(safeYear, monthIndex + 1, 0));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function getPeriodRange(periodMode: PeriodMode, referenceDate: string, selectedMonth: string) {
  if (periodMode === 'week') {
    return getWeekRange(referenceDate);
  }

  return getMonthRange(selectedMonth || getMonthValue(referenceDate));
}

function buildScheduleViewEntries(schedule: Schedule[], periodMode: PeriodMode, referenceDate: string, selectedMonth: string) {
  const range = getPeriodRange(periodMode, referenceDate, selectedMonth);
  if (!range) return [] as ScheduleViewEntry[];

  const scheduleByDate = new Map<string, Schedule[]>();

  schedule.forEach((item) => {
    const dateKey = normalizeDateKey(item.date);
    if (dateKey < range.start || dateKey > range.end) return;

    scheduleByDate.set(dateKey, [...(scheduleByDate.get(dateKey) ?? []), item]);
  });

  return enumerateDateKeys(range.start, range.end).map((dateKey) => ({
    date: dateKey,
    entry: getBestScheduleEntry(scheduleByDate.get(dateKey) ?? []),
  }));
}

function ScheduleFilterAction({
  periodMode,
  onPeriodModeChange,
  selectedMonth,
  onSelectedMonthChange,
  monthOptions,
}: ScheduleFilterActionProps) {
  return (
    <div className="flex flex-col gap-2 sm:items-end">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <button
          type="button"
          onClick={() => onPeriodModeChange('week')}
          className={`rounded-md border px-3 py-1.5 text-sm ${periodMode === 'week' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
        >
          Semanal
        </button>
        <button
          type="button"
          onClick={() => onPeriodModeChange('month')}
          className={`rounded-md border px-3 py-1.5 text-sm ${periodMode === 'month' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'}`}
        >
          Mensal
        </button>
      </div>

      {periodMode === 'month' ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Mes</span>
          <select
            value={selectedMonth}
            onChange={(event) => onSelectedMonthChange(event.target.value)}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
          >
            {monthOptions.map((monthValue) => (
              <option key={monthValue} value={monthValue}>
                {formatMonthLabel(monthValue)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

export function TechnicianScheduleViewPage() {
  const { user, loading } = useAppSession();
  const { visibility, loading: visibilityLoading, blocked } = useTechnicianVisibility({ page: 'schedule' });
  const allowedMonth = resolveAllowedMonth(visibility.schedule.month);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [calendarPeriodMode, setCalendarPeriodMode] = useState<PeriodMode>('month');
  const [calendarSelectedMonth, setCalendarSelectedMonth] = useState(() => getMonthValue(new Date().toISOString()));
  const [listPeriodMode, setListPeriodMode] = useState<PeriodMode>('month');
  const [listSelectedMonth, setListSelectedMonth] = useState(() => getMonthValue(new Date().toISOString()));

  useEffect(() => {
    let mounted = true;

    async function loadSchedule() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      try {
        const technicianId = user.technicianId ?? user.userId;
        const response = await fetch(`/api/schedule?technicianId=${technicianId}`);

        if (!response.ok) {
          throw new Error('schedule_fetch_failed');
        }

        const data = await response.json();
        if (mounted) {
          setSchedule(Array.isArray(data.schedules) ? data.schedules : []);
        }
      } catch {
        if (mounted) {
          setSchedule([]);
          setDataError('Nao foi possivel carregar dados reais de escala.');
        }
      } finally {
        if (mounted) {
          setIsDataLoading(false);
        }
      }
    }

    loadSchedule();

    return () => {
      mounted = false;
    };
  }, [user]);

  // A pinned month filters the data itself, so the weekly view and the summary cards can't show
  // days from outside it either — not just the month picker.
  const sortedSchedule = useMemo(() => {
    return schedule
      .filter((item) => !allowedMonth || getMonthValue(normalizeDateKey(item.date)) === allowedMonth)
      .sort((left, right) => normalizeDateKey(left.date).localeCompare(normalizeDateKey(right.date)));
  }, [allowedMonth, schedule]);

  const todayKey = normalizeDateKey(new Date().toISOString());
  const currentMonthValue = getMonthValue(todayKey);
  const referenceDateKey = useMemo(() => {
    const upcoming = sortedSchedule.find((item) => normalizeDateKey(item.date) >= todayKey && item.status !== 'cancelled');
    if (upcoming) return normalizeDateKey(upcoming.date);
    if (sortedSchedule.length) return normalizeDateKey(sortedSchedule[sortedSchedule.length - 1].date);
    return todayKey;
  }, [sortedSchedule, todayKey]);

  const monthOptions = useMemo(() => {
    if (allowedMonth) return [allowedMonth];

    const values = new Set<string>([currentMonthValue]);

    sortedSchedule.forEach((item) => {
      values.add(getMonthValue(item.date));
    });

    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [allowedMonth, currentMonthValue, sortedSchedule]);

  useEffect(() => {
    if (!monthOptions.includes(calendarSelectedMonth)) {
      setCalendarSelectedMonth(monthOptions[0]);
    }
    if (!monthOptions.includes(listSelectedMonth)) {
      setListSelectedMonth(monthOptions[0]);
    }
  }, [calendarSelectedMonth, listSelectedMonth, monthOptions]);

  const calendarSchedule = useMemo(
    () => (dataError ? [] : buildScheduleViewEntries(sortedSchedule, calendarPeriodMode, referenceDateKey, calendarSelectedMonth)),
    [calendarPeriodMode, calendarSelectedMonth, dataError, referenceDateKey, sortedSchedule],
  );
  const monthlyCalendarCells = useMemo(
    () => (calendarPeriodMode === 'month' ? buildMonthCalendarCells(calendarSchedule, calendarSelectedMonth) : []),
    [calendarPeriodMode, calendarSchedule, calendarSelectedMonth],
  );

  const listSchedule = useMemo(
    () => (dataError ? [] : buildScheduleViewEntries(sortedSchedule, listPeriodMode, referenceDateKey, listSelectedMonth)),
    [dataError, listPeriodMode, listSelectedMonth, referenceDateKey, sortedSchedule],
  );

  const summarySchedule = useMemo(
    () => (dataError ? [] : buildScheduleViewEntries(sortedSchedule, 'week', referenceDateKey, getMonthValue(referenceDateKey))),
    [dataError, referenceDateKey, sortedSchedule],
  );

  if (loading || isDataLoading || visibilityLoading || blocked || !user) {
    return <LoadingShell role="technician" />;
  }

  const hasCalendarEntries = calendarSchedule.some((item) => item.entry);
  const hasListEntries = listSchedule.some((item) => item.entry);
  const scheduled = summarySchedule.filter((item) => item.entry && item.entry.status !== 'cancelled').length;
  const dayOff = summarySchedule.filter((item) => item.entry?.status === 'cancelled').length;
  const nextSchedule =
    summarySchedule.find((item) => item.entry && item.entry.status !== 'cancelled' && item.date >= todayKey) ??
    summarySchedule.find((item) => item.entry && item.entry.status !== 'cancelled');
  const calendarTitle = `Calendario ${periodLabels[calendarPeriodMode]}`;
  const calendarDescription =
    calendarPeriodMode === 'week'
      ? 'Escala persistida da semana.'
      : 'Escala persistida do mes.';
  const listDescription =
    listPeriodMode === 'week'
      ? 'Lista da semana usando apenas os registros gravados no banco.'
      : 'Lista do mes usando apenas os registros gravados no banco.';

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Agenda" title="Minha escala" description="Visualize apenas a escala real persistida para voce, sem projeção padrao no front." />

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard title="Proximas escalas" value={scheduled} hint="Registros reais no proximo ciclo" icon={CalendarDays} />
        <MetricCard title="Folgas" value={dayOff} hint="Cancelamentos reais no proximo ciclo" icon={CalendarDays} tone="warning" />
        <MetricCard
          title="Proximo horario"
          value={nextSchedule?.entry?.start_time ? formatTime(nextSchedule.entry.start_time) : 'Sem escala'}
          hint={nextSchedule?.entry ? formatDate(nextSchedule.date) : 'Nenhum turno persistido'}
          icon={Clock3}
        />
      </div>

      <div className="mt-5">
        <DataPanel
          title={calendarTitle}
          description={calendarDescription}
          action={
            <ScheduleFilterAction
              periodMode={calendarPeriodMode}
              onPeriodModeChange={setCalendarPeriodMode}
              selectedMonth={calendarSelectedMonth}
              onSelectedMonthChange={setCalendarSelectedMonth}
              monthOptions={monthOptions}
            />
          }
        >
          {hasCalendarEntries ? (
            calendarPeriodMode === 'month' ? (
              <div className="overflow-x-auto">
                <div className="min-w-232">
                  <div className="grid grid-cols-7 gap-2">
                    {weekdayShortLabels.map((label) => (
                      <div key={label} className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {label}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-7 gap-2">
                    {monthlyCalendarCells.map((item) => {
                      if (item.isEmpty || !item.date) {
                        return <div key={item.key} className="min-h-40 rounded-xl border border-dashed border-border/60 bg-muted/20" />;
                      }

                      const weekdayLabel = formatWeekdayLabel(item.date);
                      const isToday = item.date === todayKey;

                      return (
                        <div
                          key={item.key}
                          className={`min-h-40 rounded-xl border p-3 ${isToday ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-background'}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{weekdayLabel}</p>
                              <p className="text-sm font-semibold">{formatDate(item.date)}</p>
                            </div>
                            {isToday ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">Hoje</span> : null}
                          </div>

                          <div className="mt-3">
                            <StatusBadge tone={item.entry ? getStatusTone(item.entry.status) : 'neutral'}>
                              {item.entry ? getStatusLabel(item.entry.status) : 'Sem escala'}
                            </StatusBadge>
                          </div>

                          <p className="mt-3 text-sm font-medium">
                            {item.entry
                              ? item.entry.status === 'cancelled'
                                ? item.entry.notes || 'Folga planejada'
                                : formatTimeRange(item.entry.start_time, item.entry.end_time)
                              : 'Sem registro persistido'}
                          </p>

                          <p className="mt-2 text-xs text-muted-foreground">
                            {item.entry?.status === 'cancelled'
                              ? 'Dia sem expediente.'
                              : item.entry?.notes || (item.entry ? 'Turno persistido no banco.' : 'Nenhuma escala gravada para esta data.')}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
                {calendarSchedule.map((item) => (
                  <div key={item.date} className="rounded-md border border-border bg-background p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatWeekdayLabel(item.date, 'long')}</p>
                    <p className="mt-1 text-sm font-semibold">{formatDate(item.date)}</p>
                    <div className="mt-3">
                      <StatusBadge tone={item.entry ? getStatusTone(item.entry.status) : 'neutral'}>
                        {item.entry ? getStatusLabel(item.entry.status) : 'Sem escala'}
                      </StatusBadge>
                    </div>
                    <p className="mt-3 text-sm">
                      {item.entry ? item.entry.status === 'cancelled' ? item.entry.notes || 'Folga planejada' : formatTimeRange(item.entry.start_time, item.entry.end_time) : 'Sem registro persistido para esta data.'}
                    </p>
                  </div>
                ))}
              </div>
            )
          ) : (
            <EmptyState icon={CalendarDays} title="Sem escala persistida no periodo" description="Nao existem registros gravados no banco para o periodo selecionado." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Lista de escala"
          description={listDescription}
          action={
            <ScheduleFilterAction
              periodMode={listPeriodMode}
              onPeriodModeChange={setListPeriodMode}
              selectedMonth={listSelectedMonth}
              onSelectedMonthChange={setListSelectedMonth}
              monthOptions={monthOptions}
            />
          }
        >
          {hasListEntries ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 pr-4 font-medium">Horario</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 font-medium">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {listSchedule.map((item) => (
                    <tr key={item.date} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{formatWeekdayLabel(item.date, 'long')}</p>
                          <p className="mt-1">{formatDate(item.date)}</p>
                        </div>
                      </td>
                      <td className="py-3 pr-4">{item.entry ? item.entry.status === 'cancelled' ? item.entry.notes || 'Folga planejada' : formatTimeRange(item.entry.start_time, item.entry.end_time) : 'Sem registro'}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={item.entry ? getStatusTone(item.entry.status) : 'neutral'}>
                          {item.entry ? getStatusLabel(item.entry.status) : 'Sem escala'}
                        </StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{item.entry?.notes || (item.entry ? '-' : 'Nao persistido')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Sem registros de escala" description="Nao ha escala persistida para o periodo selecionado." />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}