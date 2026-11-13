'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, FileText, WalletCards, Wrench } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { ProgressGauge } from '@/components/progress-gauge';
import { StatusBadge } from '@/components/status-badge';
import { brasiliaDateKey, formatCurrency, formatDate, formatHours, formatNumber, formatTime, formatTimeRange, monthKeyFromDate, resolveCompetenceMonth } from '@/lib/formatters';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { hasPeriods, isPeriodKey, periodDescription, periodForDay, periodKeys, periodLabel, type PeriodKey } from '@/lib/pay-calendar';
import type { Payroll, Schedule, Service, ServiceFortnight, WorkHours } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useTechnicianVisibility } from '@/hooks/use-technician-visibility';
import { resolveAllowedMonth } from '@/lib/technician-visibility';
import { CHART_COLORS as chartColors } from '@/lib/chart-theme';

const SERVICES_PAGE_SIZE = 12;
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

type PeriodFilter = 'monthly' | ServiceFortnight;

/** The month, then each payment period the company has (none when it pays by the month). */
function periodOptionsFor(cutDays: number[]): Array<{ value: PeriodFilter; label: string; description: string }> {
  return [
    { value: 'monthly', label: 'Mensal', description: 'Todas as OS do mês' },
    ...periodKeys(cutDays).map((key) => ({ value: key, label: periodLabel(key, cutDays), description: periodDescription(key, cutDays) })),
  ];
}

/** Tailwind needs the whole class name: one column for the month plus one for each period. */
const COLUMNS_BY_COUNT: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6' };

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
}

function getServiceCompetence(service: Service) {
  return resolveCompetenceMonth(service.competence_month, service.date_performed);
}

function getDateDay(value: string | Date | null | undefined) {
  if (!value) return 0;

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return Number(value.slice(8, 10));
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getDate();
}

/** The service's own period, or the one its day falls in by the company's cut days (null when it pays by the month). */
function getServicePeriod(service: Service, cutDays: number[]): PeriodKey | null {
  if (!hasPeriods(cutDays)) return null;
  if (isPeriodKey(service.fortnight_period)) return service.fortnight_period;

  return periodForDay(getDateDay(service.date_performed), cutDays);
}

function getDateKey(value: string | Date | null | undefined) {
  if (!value) return '';

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function getPeriodLabel(period: PeriodFilter, cutDays: number[]) {
  return periodOptionsFor(cutDays).find((item) => item.value === period)?.label ?? 'Mensal';
}

function formatCompetence(value: string) {
  const [year, month] = value.split('-');
  const monthNumber = Number(month);

  if (!year || !month || !monthNames[monthNumber - 1]) {
    return value || 'Sem data';
  }

  return `${monthNames[monthNumber - 1]}/${year}`;
}

function matchesPeriod(dateValue: string | Date | null | undefined, period: PeriodFilter, cutDays: number[]) {
  if (period === 'monthly') return true;
  return periodForDay(getDateDay(dateValue), cutDays) === period;
}

export default function TechnicianDashboard() {
  const { user, loading } = useAppSession();
  const { visibility, loading: visibilityLoading } = useTechnicianVisibility();
  const { settings } = useOrganizationSettings();
  // The company's payment periods: none when it pays by the month, and then no Q1/Q2 shows on this screen.
  const cutDays = settings.periodCutDays;
  const periodOptions = periodOptionsFor(cutDays);
  const showPeriods = hasPeriods(cutDays);
  const monthlyHoursTarget = settings.monthlyHours;
  // Configurações → Prêmio por produção: the tiers' OS counts are the technician's goals.
  const serviceGoals = settings.serviceAwardTiers.map((tier) => tier.minServices);
  const firstGoal = serviceGoals[0];
  const lastGoal = serviceGoals[serviceGoals.length - 1];
  // When the admin pins this screen to one month, that month is the only option in the filter.
  const allowedMonth = resolveAllowedMonth(visibility.dashboard.month);
  const [services, setServices] = useState<Service[]>([]);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [competenceMonth, setCompetenceMonth] = useState(defaultCompetenceMonth);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('monthly');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [servicesPage, setServicesPage] = useState(1);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const technicianId = user.technicianId ?? user.userId;
      const [servicesResult, hoursResult, payrollResult, scheduleResult] = await Promise.allSettled([
        fetch(`/api/services?technicianId=${technicianId}`),
        fetch(`/api/work-hours?technicianId=${technicianId}`),
        fetch(`/api/payroll?technicianId=${technicianId}`),
        fetch(`/api/schedule?technicianId=${technicianId}`),
      ]);
      const errors: string[] = [];

      if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
        const data = await servicesResult.value.json();
        if (mounted) setServices(Array.isArray(data.services) ? data.services : []);
      } else {
        errors.push('OS');
        if (mounted) setServices([]);
      }

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
        setDataError(errors.length ? `Não foi possível carregar os dados de ${errors.join(', ')}.` : '');
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

    const values = new Set<string>();

    services.forEach((service) => {
      const competence = getServiceCompetence(service);
      if (competence) values.add(competence);
    });


    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [allowedMonth, services]);

  useEffect(() => {
    if (!competenceOptions.length) return;
    if (!competenceOptions.includes(competenceMonth)) {
      setCompetenceMonth(competenceOptions[0]);
    }
  }, [competenceMonth, competenceOptions]);

  const monthlyServices = useMemo(
    () => services.filter((service) => getServiceCompetence(service) === competenceMonth),
    [competenceMonth, services],
  );

  const periodServices = useMemo(
    () => monthlyServices.filter((service) => periodFilter === 'monthly' || getServicePeriod(service, cutDays) === periodFilter),
    [cutDays, monthlyServices, periodFilter],
  );

  const servicesByType = useMemo(() => {
    const grouped = new Map<string, number>();

    periodServices.forEach((service) => {
      grouped.set(service.service_type, (grouped.get(service.service_type) ?? 0) + 1);
    });

    return Array.from(grouped.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count);
  }, [periodServices]);

  const filteredServices = useMemo(() => {
    return periodServices.filter((service) => !typeFilter || service.service_type === typeFilter);
  }, [periodServices, typeFilter]);

  const monthlyWorkHours = useMemo(
    () => workHours.filter((item) => monthKeyFromDate(item.date) === competenceMonth),
    [competenceMonth, workHours],
  );

  const periodWorkHours = useMemo(
    () => monthlyWorkHours.filter((item) => matchesPeriod(item.date, periodFilter, cutDays)),
    [cutDays, monthlyWorkHours, periodFilter],
  );

  const periodServicesCount = (key: PeriodKey) => monthlyServices.filter((service) => getServicePeriod(service, cutDays) === key).length;
  const currentPayroll = payroll.find((item) => resolveCompetenceMonth(item.competence_month) === competenceMonth);
  const nextSchedule = useMemo(() => {
    const todayKey = brasiliaDateKey();

    return schedule
      .filter((item) => item.status !== 'cancelled' && getDateKey(item.date) >= todayKey)
      .sort((left, right) => {
        const dateComparison = getDateKey(left.date).localeCompare(getDateKey(right.date));
        if (dateComparison !== 0) return dateComparison;
        return String(left.start_time ?? '').localeCompare(String(right.start_time ?? ''));
      })[0];
  }, [schedule]);

  const servicesPageCount = Math.max(Math.ceil(filteredServices.length / SERVICES_PAGE_SIZE), 1);
  const visibleServiceRows = useMemo(() => {
    const startIndex = (servicesPage - 1) * SERVICES_PAGE_SIZE;
    return filteredServices.slice(startIndex, startIndex + SERVICES_PAGE_SIZE);
  }, [filteredServices, servicesPage]);
  const servicesStartRange = filteredServices.length ? (servicesPage - 1) * SERVICES_PAGE_SIZE + 1 : 0;
  const servicesEndRange = Math.min(servicesPage * SERVICES_PAGE_SIZE, filteredServices.length);

  useEffect(() => {
    setServicesPage(1);
  }, [competenceMonth, filteredServices.length, periodFilter, typeFilter]);

  if (loading || isDataLoading || visibilityLoading || !user) {
    return <LoadingShell role="technician" />;
  }

  const technicianName = user.name || user.email;
  const payrollClosed = Boolean(currentPayroll);
  const netTotal = roundCurrency(currentPayroll?.net_total);
  const periodHours = periodWorkHours.reduce((total, item) => total + moneyValue(item.hours_worked), 0);
  const monthlyHoursTotal = monthlyWorkHours.reduce((total, item) => total + moneyValue(item.hours_worked), 0);
  const monthlyHoursDebt = Math.max(0, monthlyHoursTarget - monthlyHoursTotal);
  const monthlyHoursExtra = Math.max(0, monthlyHoursTotal - monthlyHoursTarget);
  const monthlyHoursHint = periodFilter === 'monthly'
    ? monthlyHoursDebt > 0
      ? `Fez ${formatHours(monthlyHoursTotal)} • Devendo ${formatHours(monthlyHoursDebt)} • Meta ${formatHours(monthlyHoursTarget)}`
      : monthlyHoursExtra > 0
        ? `Fez ${formatHours(monthlyHoursTotal)} • ${formatHours(monthlyHoursExtra)} acima da meta de ${formatHours(monthlyHoursTarget)}`
        : `Fez ${formatHours(monthlyHoursTotal)} • Meta mensal de ${formatHours(monthlyHoursTarget)} concluída`
    : 'Horas lançadas no recorte';
  const selectedPeriodLabel = getPeriodLabel(periodFilter, cutDays);
  const nextScheduleTime = nextSchedule?.start_time ? formatTime(nextSchedule.start_time) : 'Sem escala';
  const nextScheduleHint = nextSchedule
    ? `${formatDate(nextSchedule.date)}${nextSchedule.end_time ? ` • ${formatTimeRange(nextSchedule.start_time, nextSchedule.end_time)}` : ''}`
    : 'Nenhum registro futuro';

  return (
    <AppShell role={user.role === 'admin' ? 'admin' : 'technician'} userName={technicianName || user.email}>
      <PageHeader
        eyebrow="Dashboard individual"
        title={technicianName}
        description="Produção, pagamento, banco de horas e próxima escala."
      >
        <StatusBadge tone={payrollClosed ? 'success' : 'warning'}>{payrollClosed ? 'Folha fechada' : 'Folha aguardando'}</StatusBadge>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Em conta"
          value={payrollClosed ? formatCurrency(netTotal) : 'Aguardando...'}
          hint={payrollClosed ? `Folha ${formatCompetence(competenceMonth)}` : 'Folha ainda não finalizada'}
          icon={WalletCards}
          tone={payrollClosed ? 'success' : 'warning'}
        />
        <MetricCard title="Ordens" value={formatNumber(filteredServices.length)} hint={`${selectedPeriodLabel} no recorte atual`} icon={Wrench} />
        <MetricCard
          title="Horas realizadas"
          value={formatHours(periodFilter === 'monthly' ? monthlyHoursTotal : periodHours)}
          hint={monthlyHoursHint}
          hintTone={periodFilter === 'monthly' && monthlyHoursDebt > 0 ? 'danger' : 'warning'}
          icon={Clock3}
          tone="warning"
          accentText
        />
        <MetricCard title="Próxima escala" value={nextScheduleTime} hint={nextScheduleHint} icon={CalendarDays} />
      </div>

      <div className="mb-5">
        <DataPanel title="Filtros" description="Escolha a data e o recorte que serão usados nos indicadores, metas e OS.">
          <div className="grid gap-4 lg:grid-cols-[minmax(16rem,0.5fr)_1fr]">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase text-muted-foreground">Data</span>
              <span className="flex h-12 items-center gap-3 rounded-md border border-border bg-background px-3">
                <CalendarDays className="h-4 w-4 text-primary" />
                <select
                  value={competenceMonth}
                  onChange={(event) => setCompetenceMonth(event.target.value)}
                  disabled={Boolean(allowedMonth)}
                  className="w-full bg-transparent text-sm font-semibold outline-none disabled:cursor-default"
                >
                  {competenceOptions.length ? (
                    competenceOptions.map((competence) => (
                      <option key={competence} value={competence}>
                        {formatCompetence(competence)}
                      </option>
                    ))
                  ) : (
                    <option value={competenceMonth}>{formatCompetence(competenceMonth)}</option>
                  )}
                </select>
              </span>
            </label>

            {showPeriods ? (
            <div>
              <span className="text-xs font-medium uppercase text-muted-foreground">Período</span>
              <div className={`mt-2 grid gap-2 ${COLUMNS_BY_COUNT[periodOptions.length] ?? 'sm:grid-cols-3'}`}>
                {periodOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setPeriodFilter(option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      periodFilter === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-secondary'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className={`mt-0.5 block text-xs ${periodFilter === option.value ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            ) : null}
          </div>
        </DataPanel>
      </div>

      <div className={`grid gap-5 ${visibility.dashboard.servicesByType && serviceGoals.length ? 'xl:grid-cols-2' : ''}`}>
        {serviceGoals.length ? (
        <DataPanel
          title="Metas por competência"
          description={`${serviceGoals.map((goal, index) => `Meta ${index + 1}: ${goal} OS.`).join(' ')}${showPeriods ? ' Clique em um card para mudar o período.' : ''}`}
        >
          <div className={`grid gap-3 ${COLUMNS_BY_COUNT[periodOptions.length] ?? 'sm:grid-cols-3'}`}>
            <ProgressGauge
              title="Mensal"
              value={monthlyServices.length}
              goals={serviceGoals}
              subtitle="OS no mês"
              active={periodFilter === 'monthly'}
              celebrationLevel={serviceGoals.length > 1 && monthlyServices.length >= lastGoal ? 'mega' : monthlyServices.length >= firstGoal ? 'goal' : undefined}
              onClick={() => setPeriodFilter('monthly')}
            />
            {periodKeys(cutDays).map((key) => (
              <ProgressGauge
                key={key}
                title={periodLabel(key, cutDays)}
                value={periodServicesCount(key)}
                goals={serviceGoals}
                subtitle={`OS no ${periodLabel(key, cutDays)}`}
                active={periodFilter === key}
                celebrationLevel={periodServicesCount(key) >= firstGoal ? 'goal' : undefined}
                onClick={() => setPeriodFilter(key)}
              />
            ))}
          </div>
        </DataPanel>
        ) : null}

        {visibility.dashboard.servicesByType ? (
        <DataPanel title="Serviços por tipo" description="Clique em uma barra para refinar o recorte.">
          {servicesByType.length ? (
            <>
              <div className="h-84">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={servicesByType} margin={{ left: -24, right: 12, bottom: 28 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={82} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} onClick={(data) => setTypeFilter(typeFilter === data.name ? null : data.name)}>
                      {servicesByType.map((_, index) => (
                        <Cell key={`bar-${index}`} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {typeFilter ? (
                <button type="button" onClick={() => setTypeFilter(null)} className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
                  Limpar filtro de tipo: {typeFilter}
                </button>
              ) : null}
            </>
          ) : (
            <EmptyState icon={Wrench} title="Sem tipos no recorte" description="Não há OS para agrupar nesse período." />
          )}
        </DataPanel>
        ) : null}
      </div>

      {visibility.dashboard.servicesPerformed ? (
      <div className="mt-5">
        <DataPanel title="Serviços realizados" description="OS realizadas no recorte atual.">
          {filteredServices.length ? (
            <div className="overflow-hidden rounded-md border border-border">
              <div className="overflow-x-auto">
                <table className="w-full min-w-180 text-sm">
                  <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">OS</th>
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
                      {showPeriods ? <th className="px-4 py-3 text-left font-medium">Período</th> : null}
                      <th className="px-4 py-3 text-left font-medium">Data</th>
                      <th className="px-4 py-3 text-left font-medium">Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleServiceRows.map((service) => (
                      <tr key={service.id} className="border-t border-border">
                        <td className="px-4 py-3 font-medium">{service.order_code}</td>
                        <td className="px-4 py-3 text-muted-foreground">{service.service_type}</td>
                        {showPeriods ? (
                          <td className="px-4 py-3">
                            <StatusBadge tone="info">{periodLabel(getServicePeriod(service, cutDays) ?? 'Q1', cutDays)}</StatusBadge>
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(service.date_performed)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{service.time_performed ? formatTime(service.time_performed) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                <span>
                  {servicesStartRange} - {servicesEndRange} / {filteredServices.length}
                </span>
                <button
                  type="button"
                  onClick={() => setServicesPage((page) => Math.max(page - 1, 1))}
                  disabled={servicesPage === 1}
                  aria-label="Página anterior"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setServicesPage((page) => Math.min(page + 1, servicesPageCount))}
                  disabled={servicesPage === servicesPageCount}
                  aria-label="Próxima página"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          ) : (
            <EmptyState icon={FileText} title="Nenhuma OS no recorte" description="Altere a competência, período ou tipo para visualizar serviços reais." />
          )}
        </DataPanel>
      </div>
      ) : null}
    </AppShell>
  );
}
