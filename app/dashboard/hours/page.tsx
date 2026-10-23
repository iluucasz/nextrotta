'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { brasiliaDateKey, formatDate, formatHours, formatTime, formatTimeRange, monthKeyFromDate, normalizeText, resolveCompetenceMonth } from '@/lib/formatters';
import type { Payroll, Schedule, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { useTechnicianVisibility } from '@/hooks/use-technician-visibility';
import { resolveAllowedMonth } from '@/lib/technician-visibility';

const defaultCompetenceMonth = brasiliaDateKey().slice(0, 7);
const monthNames = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

function formatCompetenceLabel(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem competência';
  }

  return `${month.padStart(2, '0')}/${year} - ${monthNames[monthNumber - 1]}`;
}

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export default function TechnicianHoursPage() {
  const { user, loading } = useAppSession();
  const { visibility, loading: visibilityLoading, blocked } = useTechnicianVisibility({ page: 'hours' });
  // Configurações → Jornada mensal and the hours alert floor.
  const { settings } = useOrganizationSettings();
  const monthlyHoursTarget = settings.monthlyHours;
  const monthlyHoursWarningFloor = settings.monthlyHoursWarningFloor;
  const allowedMonth = resolveAllowedMonth(visibility.hours.month);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [competenceMonth, setCompetenceMonth] = useState(defaultCompetenceMonth);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const technicianId = user.technicianId ?? user.userId;
      const [hoursResult, payrollResult, scheduleResult] = await Promise.allSettled([
        fetch(`/api/work-hours?technicianId=${technicianId}`),
        fetch(`/api/payroll?technicianId=${technicianId}`),
        fetch(`/api/schedule?technicianId=${technicianId}`),
      ]);
      const errors: string[] = [];

      if (hoursResult.status === 'fulfilled' && hoursResult.value.ok) {
        const data = await hoursResult.value.json();
        if (mounted) setWorkHours(Array.isArray(data.workHours) ? data.workHours : []);
      } else {
        errors.push('banco de horas');
        if (mounted) setWorkHours([]);
      }

      if (payrollResult.status === 'fulfilled' && payrollResult.value.ok) {
        const data = await payrollResult.value.json();
        if (mounted) setPayroll(Array.isArray(data.payrolls) ? data.payrolls : []);
      } else {
        errors.push('folha');
        if (mounted) setPayroll([]);
      }

      if (scheduleResult.status === 'fulfilled' && scheduleResult.value.ok) {
        const data = await scheduleResult.value.json();
        if (mounted) setSchedule(Array.isArray(data.schedules) ? data.schedules : []);
      } else {
        errors.push('escala');
        if (mounted) setSchedule([]);
      }

      if (mounted) {
        setDataError(errors.length ? `Não foi possível carregar dados reais de ${errors.join(', ')}.` : '');
        setIsDataLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const competenceOptions = useMemo(() => {
    if (allowedMonth) return [allowedMonth];

    const values = new Set<string>([defaultCompetenceMonth]);

    workHours.forEach((item) => {
      const competence = monthKeyFromDate(item.date);
      if (competence) values.add(competence);
    });

    payroll.forEach((item) => {
      const competence = resolveCompetenceMonth(item.competence_month);
      if (competence) values.add(competence);
    });

    schedule.forEach((item) => {
      const competence = monthKeyFromDate(item.date);
      if (competence) values.add(competence);
    });

    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [allowedMonth, payroll, schedule, workHours]);

  useEffect(() => {
    if (!competenceOptions.length) return;
    if (!competenceOptions.includes(competenceMonth)) {
      setCompetenceMonth(competenceOptions[0]);
    }
  }, [competenceMonth, competenceOptions]);

  const monthlyWorkHours = useMemo(
    () => workHours.filter((item) => monthKeyFromDate(item.date) === competenceMonth),
    [competenceMonth, workHours],
  );

  const visibleWorkHours = useMemo(() => {
    return monthlyWorkHours.filter((item) => {
      const haystack = normalizeText(`${item.date} ${item.week_number} ${item.month}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [monthlyWorkHours, query]);

  const currentPayroll = payroll.find((item) => resolveCompetenceMonth(item.competence_month) === competenceMonth);
  const payrollClosed = Boolean(currentPayroll);
  const monthlySchedule = useMemo(() => {
    return schedule
      .filter((item) => item.status !== 'cancelled' && monthKeyFromDate(item.date) === competenceMonth)
      .sort((left, right) => {
        const dateComparison = String(left.date ?? '').localeCompare(String(right.date ?? ''));
        if (dateComparison !== 0) return dateComparison;
        return String(left.start_time ?? '').localeCompare(String(right.start_time ?? ''));
      });
  }, [competenceMonth, schedule]);

  if (loading || isDataLoading || visibilityLoading || blocked || !user) {
    return <LoadingShell role="technician" />;
  }

  const totalHours = monthlyWorkHours.reduce((total, item) => total + Number(item.hours_worked), 0);
  const balance = totalHours - monthlyHoursTarget;
  const hoursTone = totalHours >= monthlyHoursTarget ? 'success' : totalHours >= monthlyHoursWarningFloor ? 'warning' : 'danger';
  const balanceHint =
    balance >= 0
      ? `${formatHours(monthlyHoursTarget)} no total • ${formatHours(balance)} acima`
      : `${formatHours(monthlyHoursTarget)} no total • faltam ${formatHours(Math.abs(balance))}`;
  const payrollBalance = currentPayroll ? moneyValue(currentPayroll.hour_bank_balance) : balance;
  const payrollBalanceHint = payrollClosed ? `Saldo salvo na folha ${formatCompetenceLabel(competenceMonth)}` : 'Estimativa pela meta mensal enquanto a folha não fecha';
  const nextScheduledShift = monthlySchedule[0];
  const hasPlannedSchedule = Boolean(nextScheduledShift);

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader eyebrow="Horas" title="Banco de horas" description="Horas realizadas, saldo diário e consolidado por competência. Escala planejada e horas trabalhadas ficam separadas.">
        <StatusBadge tone={payrollClosed ? 'success' : 'info'}>{formatCompetenceLabel(competenceMonth)}</StatusBadge>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="mb-5">
        <DataPanel title="Competência" description="Selecione o mês para ver o banco de horas real salvo no sistema.">
          <label className="block max-w-sm text-sm">
            <span className="mb-1.5 block font-medium">Mês</span>
            <span className="flex min-h-10 items-center gap-2 rounded-lg border border-input bg-background px-3">
              <CalendarDays className="h-4 w-4 text-primary" />
              <select
                value={competenceMonth}
                onChange={(event) => setCompetenceMonth(event.target.value)}
                disabled={Boolean(allowedMonth)}
                className="w-full bg-transparent text-sm outline-none disabled:cursor-default"
              >
                {competenceOptions.length ? (
                  competenceOptions.map((item) => (
                    <option key={item} value={item}>
                      {formatCompetenceLabel(item)}
                    </option>
                  ))
                ) : (
                  <option value={competenceMonth}>{formatCompetenceLabel(competenceMonth)}</option>
                )}
              </select>
            </span>
          </label>
        </DataPanel>
      </div>

      {!monthlyWorkHours.length && hasPlannedSchedule ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Existe escala planejada em {formatDate(nextScheduledShift?.date)}{nextScheduledShift?.start_time ? ` • ${formatTimeRange(nextScheduledShift.start_time, nextScheduledShift.end_time)}` : ''}, mas ainda não existem horas lançadas em banco para este técnico nesta competência.
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Horas realizadas" value={formatHours(totalHours)} hint={`${monthlyWorkHours.length} dia(s) na competência`} icon={Clock3} tone={hoursTone} accentText />
        <MetricCard title="Horas totais" value={formatHours(monthlyHoursTarget)} hint="Jornada mensal da empresa" icon={Clock3} />
        <MetricCard title="Saldo do mês" value={formatHours(balance)} hint={balanceHint} icon={Clock3} tone={hoursTone} accentText />
        <MetricCard title="Banco de horas" value={formatHours(payrollBalance)} hint={payrollBalanceHint} icon={Clock3} tone={payrollBalance < 0 ? 'danger' : 'warning'} />
      </div>

      {visibility.hours.hoursLog ? (
      <div className="mt-5">
        <DataPanel
          title="Registro de horas"
          description="Apontamentos reais da competência selecionada. A busca abaixo filtra apenas a lista."
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar data ou semana" className="w-48 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          {visibleWorkHours.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 pr-4 font-medium">Entrada</th>
                    <th className="py-3 pr-4 font-medium">Saída</th>
                    <th className="py-3 pr-4 font-medium">Trabalhadas</th>
                    <th className="py-3 pr-4 font-medium">Saldo dia</th>
                    <th className="py-3 font-medium">Semana</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWorkHours.map((item) => {
                    const dailyBalance = Number(item.hours_worked) - 8;

                    return (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="py-3 pr-4">{formatDate(item.date)}</td>
                        <td className="py-3 pr-4">{formatTime(item.start_time)}</td>
                        <td className="py-3 pr-4">{formatTime(item.end_time)}</td>
                        <td className="py-3 pr-4">{formatHours(item.hours_worked)}</td>
                        <td className="py-3 pr-4">
                          <StatusBadge tone={dailyBalance < 0 ? 'danger' : dailyBalance > 0 ? 'success' : 'neutral'}>
                            {formatHours(dailyBalance)}
                          </StatusBadge>
                        </td>
                        <td className="py-3 text-muted-foreground">{item.week_number || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Clock3}
              title="Nenhum registro de horas"
              description={query ? 'Ajuste a busca para encontrar registros desta competência.' : hasPlannedSchedule ? 'Existe escala planejada, mas ainda não há apontamentos reais em banco de horas para este técnico nesta competência.' : 'Ainda não há horas lançadas para este técnico nesta competência.'}
            />
          )}
        </DataPanel>
      </div>
      ) : null}
    </AppShell>
  );
}
