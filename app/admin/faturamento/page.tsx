'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CalendarDays,
  Landmark,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  Wrench,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { formatCurrency, formatNumber, normalizeText, resolveCompetenceMonth } from '@/lib/formatters';
import { valueOrDefault } from '@/lib/organization-settings';
import type { Payroll, Service, Technician } from '@/lib/types';
import { CHART_COLORS as chartColors } from '@/lib/chart-theme';

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

const shortMonthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const currentDate = new Date();
const currentYear = String(currentDate.getFullYear());
const currentMonthNum = String(currentDate.getMonth() + 1).padStart(2, '0');
const ALL_OPTION = 'all';

type MonthSummary = {
  monthKey: string;
  monthLabel: string;
  serviceRevenue: number;
  revenue: number;
  payrollCost: number;
  expenses: number;
  profit: number;
  margin: number;
  services: number;
  payrolls: number;
  employees: number;
};

type RawMonthSummary = Omit<MonthSummary, 'employees'> & {
  employeeIds: Set<string>;
};

type TechnicianFinancialSummary = {
  id: string;
  name: string;
  serviceCount: number;
  revenue: number;
  calculationBase: number;
  payrollCost: number;
  profit: number;
  margin: number;
};

type TypeRevenueSummary = {
  name: string;
  revenue: number;
  count: number;
};

function moneyValue(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function roundCurrency(value: number | string | null | undefined) {
  return Math.round((moneyValue(value) + Number.EPSILON) * 100) / 100;
}

function formatPercent(value: number | string | null | undefined) {
  return `${Number(value ?? 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })}%`;
}

function formatCompactCurrency(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
}

function formatChartCurrency(value: unknown) {
  return formatCurrency(Number(value ?? 0));
}

function formatChartPercent(value: unknown) {
  return formatPercent(Number(value ?? 0));
}

function getServiceCompetence(service: Service) {
  return resolveCompetenceMonth(service.competence_month, service.date_performed);
}

function getPayrollCost(payroll: Payroll) {
  return roundCurrency(moneyValue(payroll.net_total) + moneyValue(payroll.va_deduction) + moneyValue(payroll.vr_deduction));
}

function calcMargin(profit: number, revenue: number) {
  return revenue > 0 ? roundCurrency((profit / revenue) * 100) : 0;
}

function finalizeMonthSummary(raw: RawMonthSummary): MonthSummary {
  const revenue = roundCurrency(raw.serviceRevenue);
  const expenses = roundCurrency(raw.payrollCost);
  const profit = roundCurrency(revenue - expenses);

  return {
    ...raw,
    serviceRevenue: roundCurrency(raw.serviceRevenue),
    revenue,
    payrollCost: roundCurrency(raw.payrollCost),
    expenses,
    profit,
    margin: calcMargin(profit, revenue),
    employees: raw.employeeIds.size,
  };
}

function getMetricTone(value: number): 'success' | 'danger' {
  return value >= 0 ? 'success' : 'danger';
}

export default function AdminFaturamentoPage() {
  const { user, loading } = useAppSession();
  // Technicians without their own commission use the organization's default.
  const { settings: organizationSettings } = useOrganizationSettings();
  const defaultCommissionPercentage = organizationSettings.commissionPercentage;
  const [services, setServices] = useState<Service[]>([]);
  const [payroll, setPayroll] = useState<Payroll[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthNum);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState('all');
  const [employeeQuery, setEmployeeQuery] = useState('');

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      const [servicesResult, payrollResult, techniciansResult] = await Promise.allSettled([
        fetch('/api/services'),
        fetch('/api/payroll'),
        fetch('/api/technicians'),
      ]);
      const errors: string[] = [];

      if (servicesResult.status === 'fulfilled' && servicesResult.value.ok) {
        const data = await servicesResult.value.json();
        if (mounted) setServices(Array.isArray(data.services) ? data.services : []);
      } else {
        errors.push('serviços');
        if (mounted) setServices([]);
      }

      if (payrollResult.status === 'fulfilled' && payrollResult.value.ok) {
        const data = await payrollResult.value.json();
        if (mounted) setPayroll(Array.isArray(data.payrolls) ? data.payrolls : []);
      } else {
        errors.push('folha');
        if (mounted) setPayroll([]);
      }

      if (techniciansResult.status === 'fulfilled' && techniciansResult.value.ok) {
        const data = await techniciansResult.value.json();
        if (mounted) setTechnicians(Array.isArray(data.technicians) ? data.technicians : []);
      } else {
        errors.push('funcionários');
        if (mounted) setTechnicians([]);
      }

      if (mounted) {
        setDataError(errors.length ? `Não foi possível carregar dados de ${errors.join(', ')}.` : '');
        setIsDataLoading(false);
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const activeTechnicianIds = useMemo(
    () => new Set(technicians.filter((technician) => technician.status === 'active').map((technician) => technician.id)),
    [technicians],
  );
  const activeServices = useMemo(
    () => services.filter((service) => activeTechnicianIds.has(service.technician_id)),
    [activeTechnicianIds, services],
  );
  const activePayroll = useMemo(
    () => payroll.filter((item) => activeTechnicianIds.has(item.technician_id)),
    [activeTechnicianIds, payroll],
  );

  const technicianOptions = useMemo(
    () =>
      technicians
        .filter((technician) => technician.status === 'active')
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [technicians],
  );

  const commissionPercentageMap = useMemo(
    () =>
      new Map(
        technicians.map((technician) => [
          technician.id,
          valueOrDefault(technician.commission_percentage, defaultCommissionPercentage),
        ]),
      ),
    [defaultCommissionPercentage, technicians],
  );

  useEffect(() => {
    if (selectedTechnicianId !== 'all' && !activeTechnicianIds.has(selectedTechnicianId)) {
      setSelectedTechnicianId('all');
    }
  }, [activeTechnicianIds, selectedTechnicianId]);

  // Escopo do dashboard: quando um técnico é escolhido, todas as métricas,
  // gráficos e rankings passam a considerar apenas os dados dele.
  const scopedServices = useMemo(
    () => (selectedTechnicianId === 'all' ? activeServices : activeServices.filter((service) => service.technician_id === selectedTechnicianId)),
    [activeServices, selectedTechnicianId],
  );
  const scopedPayroll = useMemo(
    () => (selectedTechnicianId === 'all' ? activePayroll : activePayroll.filter((item) => item.technician_id === selectedTechnicianId)),
    [activePayroll, selectedTechnicianId],
  );

  function calculateBaseFromServices(list: Service[]) {
    return roundCurrency(
      list.reduce(
        (total, service) => total + moneyValue(service.value) * ((commissionPercentageMap.get(service.technician_id) ?? defaultCommissionPercentage) / 100),
        0,
      ),
    );
  }

  const yearOptions = useMemo(() => {
    const values = new Set<string>([currentYear]);

    activeServices.forEach((service) => {
      const competence = getServiceCompetence(service);
      if (/^\d{4}-\d{2}$/.test(competence)) values.add(competence.slice(0, 4));
    });

    activePayroll.forEach((item) => {
      if (/^\d{4}-\d{2}$/.test(item.competence_month)) values.add(item.competence_month.slice(0, 4));
    });

    return Array.from(values).sort((left, right) => right.localeCompare(left, 'pt-BR'));
  }, [activePayroll, activeServices]);

  useEffect(() => {
    if (selectedYear !== ALL_OPTION && !yearOptions.includes(selectedYear)) {
      setSelectedYear(yearOptions[0] ?? currentYear);
    }
  }, [selectedYear, yearOptions]);

  const technicianNameMap = useMemo(() => {
    return new Map(technicians.map((technician) => [technician.id, technician.name]));
  }, [technicians]);

  const matchesYear = (competence: string) => selectedYear === ALL_OPTION || competence.slice(0, 4) === selectedYear;
  const matchesMonth = (competence: string) => selectedMonth === ALL_OPTION || competence.slice(5, 7) === selectedMonth;

  // Escopo por ano (todos os meses) — alimenta os cards anuais e o gráfico de evolução.
  const yearScopedServices = useMemo(
    () => scopedServices.filter((service) => matchesYear(getServiceCompetence(service))),
    [scopedServices, selectedYear],
  );
  const yearScopedPayroll = useMemo(
    () => scopedPayroll.filter((item) => matchesYear(item.competence_month)),
    [scopedPayroll, selectedYear],
  );

  // Escopo do período (ano + mês) — alimenta os cards do período, composições e rankings.
  const periodServices = useMemo(
    () => yearScopedServices.filter((service) => matchesMonth(getServiceCompetence(service))),
    [yearScopedServices, selectedMonth],
  );
  const periodPayroll = useMemo(
    () => yearScopedPayroll.filter((item) => matchesMonth(item.competence_month)),
    [yearScopedPayroll, selectedMonth],
  );

  function aggregate(servicesList: Service[], payrollList: Payroll[]) {
    const serviceRevenue = roundCurrency(servicesList.reduce((total, service) => total + moneyValue(service.value), 0));
    const payrollCost = roundCurrency(payrollList.reduce((total, item) => total + getPayrollCost(item), 0));
    const profit = roundCurrency(serviceRevenue - payrollCost);
    const employeeIds = new Set<string>();
    servicesList.forEach((service) => service.technician_id && employeeIds.add(service.technician_id));
    payrollList.forEach((item) => item.technician_id && employeeIds.add(item.technician_id));

    return {
      serviceRevenue,
      revenue: serviceRevenue,
      payrollCost,
      expenses: payrollCost,
      profit,
      margin: calcMargin(profit, serviceRevenue),
      services: servicesList.length,
      payrolls: payrollList.length,
      employees: employeeIds.size,
    };
  }

  // Gráfico de evolução: 12 meses do ano selecionado (ou somados entre todos os anos).
  const monthlyData = useMemo<MonthSummary[]>(() => {
    const buckets = Array.from({ length: 12 }, (_, index) => ({
      monthKey: String(index + 1).padStart(2, '0'),
      monthLabel: shortMonthNames[index],
      serviceRevenue: 0,
      revenue: 0,
      payrollCost: 0,
      expenses: 0,
      profit: 0,
      margin: 0,
      services: 0,
      payrolls: 0,
      employeeIds: new Set<string>(),
    }));
    const byMonth = new Map(buckets.map((bucket) => [bucket.monthKey, bucket]));

    yearScopedServices.forEach((service) => {
      const summary = byMonth.get(getServiceCompetence(service).slice(5, 7));
      if (!summary) return;
      summary.serviceRevenue += moneyValue(service.value);
      summary.services += 1;
      if (service.technician_id) summary.employeeIds.add(service.technician_id);
    });

    yearScopedPayroll.forEach((item) => {
      const summary = byMonth.get(item.competence_month.slice(5, 7));
      if (!summary) return;
      summary.payrollCost += getPayrollCost(item);
      summary.payrolls += 1;
      if (item.technician_id) summary.employeeIds.add(item.technician_id);
    });

    return buckets.map(finalizeMonthSummary);
  }, [yearScopedPayroll, yearScopedServices]);

  const periodData = useMemo(() => aggregate(periodServices, periodPayroll), [periodServices, periodPayroll]);
  const annualData = useMemo(() => aggregate(yearScopedServices, yearScopedPayroll), [yearScopedServices, yearScopedPayroll]);

  const monthlyCalculationBase = useMemo(() => calculateBaseFromServices(periodServices), [periodServices, commissionPercentageMap]);
  const annualCalculationBase = useMemo(() => calculateBaseFromServices(yearScopedServices), [yearScopedServices, commissionPercentageMap]);

  const typeRevenueData = useMemo<TypeRevenueSummary[]>(() => {
    const groups = new Map<string, TypeRevenueSummary>();

    periodServices.forEach((service) => {
      const key = service.service_type || 'Sem tipo';
      const current = groups.get(key) ?? { name: key, revenue: 0, count: 0 };
      current.revenue = roundCurrency(current.revenue + moneyValue(service.value));
      current.count += 1;
      groups.set(key, current);
    });

    return Array.from(groups.values())
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 8);
  }, [periodServices]);

  const technicianRows = useMemo<TechnicianFinancialSummary[]>(() => {
    const rows = new Map<string, TechnicianFinancialSummary>();

    function getRow(id: string, fallbackName: string) {
      const row = rows.get(id) ?? {
        id,
        name: technicianNameMap.get(id) || fallbackName || 'Funcionário sem nome',
        serviceCount: 0,
        revenue: 0,
        calculationBase: 0,
        payrollCost: 0,
        profit: 0,
        margin: 0,
      };
      rows.set(id, row);
      return row;
    }

    periodServices.forEach((service) => {
      const id = service.technician_id || normalizeText(service.technician_name || 'sem-funcionario');
      const row = getRow(id, service.technician_name || service.technician_id);
      const percentage = commissionPercentageMap.get(service.technician_id) ?? defaultCommissionPercentage;
      row.serviceCount += 1;
      row.revenue = roundCurrency(row.revenue + moneyValue(service.value));
      row.calculationBase = roundCurrency(row.calculationBase + moneyValue(service.value) * (percentage / 100));
    });

    periodPayroll.forEach((item) => {
      const row = getRow(item.technician_id, technicianNameMap.get(item.technician_id) || item.technician_id);
      row.payrollCost = roundCurrency(row.payrollCost + getPayrollCost(item));
    });

    return Array.from(rows.values())
      .map((row) => ({
        ...row,
        profit: roundCurrency(row.revenue - row.payrollCost),
        margin: calcMargin(row.revenue - row.payrollCost, row.revenue),
      }))
      .filter((row) => {
        const haystack = normalizeText(`${row.name} ${row.id}`);
        return !employeeQuery || haystack.includes(normalizeText(employeeQuery));
      })
      .sort((left, right) => {
        if (right.revenue !== left.revenue) return right.revenue - left.revenue;
        return right.payrollCost - left.payrollCost;
      });
  }, [commissionPercentageMap, defaultCommissionPercentage, employeeQuery, periodPayroll, periodServices, technicianNameMap]);

  const costComposition = useMemo(() => {
    return [
      { name: 'Folha', value: periodData.payrollCost },
    ].filter((item) => item.value > 0);
  }, [periodData.payrollCost]);

  const revenueComposition = useMemo(() => {
    return [
      { name: 'Serviços', value: periodData.serviceRevenue },
    ].filter((item) => item.value > 0);
  }, [periodData.serviceRevenue]);

  const payrollShare = periodData.revenue > 0 ? (periodData.payrollCost / periodData.revenue) * 100 : 0;
  const expenseShare = periodData.revenue > 0 ? (periodData.expenses / periodData.revenue) * 100 : 0;
  const periodAverageTicket = periodData.services > 0 ? periodData.serviceRevenue / periodData.services : 0;
  const annualAverageTicket = annualData.services > 0 ? annualData.serviceRevenue / annualData.services : 0;
  const hasAnyData = scopedServices.length || scopedPayroll.length;
  const selectedTechnicianName =
    selectedTechnicianId === 'all'
      ? 'Todos os técnicos'
      : technicianNameMap.get(selectedTechnicianId) || 'Técnico selecionado';
  const monthLabel = selectedMonth === ALL_OPTION ? 'Todos os meses' : monthNames[Number(selectedMonth) - 1];
  const yearLabel = selectedYear === ALL_OPTION ? 'Todos os anos' : `Ano ${selectedYear}`;
  const periodLabel =
    selectedMonth !== ALL_OPTION && selectedYear !== ALL_OPTION
      ? `${selectedMonth}/${selectedYear} - ${monthNames[Number(selectedMonth) - 1]}`
      : selectedMonth !== ALL_OPTION
        ? `${monthNames[Number(selectedMonth) - 1]} (todos os anos)`
        : selectedYear !== ALL_OPTION
          ? `Ano ${selectedYear}`
          : 'Todos os períodos';

  if (loading || isDataLoading || !user) {
    return <LoadingShell role="admin" />;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Dashboard gerencial"
        title="Faturamento"
        description="Faturamento de serviços, custo de folha e lucro por mês e por ano."
      >
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="info">{monthLabel}</StatusBadge>
          <StatusBadge tone={annualData.profit >= 0 ? 'success' : 'danger'}>{yearLabel}</StatusBadge>
          <StatusBadge tone={selectedTechnicianId === 'all' ? 'neutral' : 'success'}>{selectedTechnicianName}</StatusBadge>
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{dataError}</div> : null}

      {/* Two full rows: period and year results on top (4), cost, ticket and base below (3). */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-12">
        <div className="grid xl:col-span-3">
          <MetricCard title="Faturamento (período)" value={formatCurrency(periodData.revenue)} hint={monthLabel} icon={TrendingUp} tone="success" />
        </div>
        <div className="grid xl:col-span-3">
          <MetricCard
            title="Lucro (período)"
            value={formatCurrency(periodData.profit)}
            hint={`Margem ${formatPercent(periodData.margin)}`}
            icon={Landmark}
            tone={getMetricTone(periodData.profit)}
            accentText
          />
        </div>
        <div className="grid xl:col-span-3">
          <MetricCard title="Faturamento anual" value={formatCurrency(annualData.revenue)} hint={`${formatNumber(annualData.services)} OS · ${yearLabel}`} icon={CalendarDays} />
        </div>
        <div className="grid xl:col-span-3">
          <MetricCard
            title="Lucro anual"
            value={formatCurrency(annualData.profit)}
            hint={`Margem ${formatPercent(annualData.margin)}`}
            icon={TrendingUp}
            tone={getMetricTone(annualData.profit)}
            accentText
          />
        </div>
        <div className="grid xl:col-span-4">
          <MetricCard title="Custo da folha" value={formatCurrency(periodData.payrollCost)} hint={`${formatNumber(periodData.payrolls)} fechamento(s)`} icon={WalletCards} tone="warning" />
        </div>
        <div className="grid xl:col-span-4">
          <MetricCard title="Ticket médio" value={formatCurrency(periodAverageTicket)} hint={`${yearLabel}: ${formatCurrency(annualAverageTicket)}`} icon={Wrench} />
        </div>
        <div className="grid sm:col-span-2 xl:col-span-4">
          <MetricCard title="Base de cálculo (período)" value={formatCurrency(monthlyCalculationBase)} hint={`${yearLabel}: ${formatCurrency(annualCalculationBase)}`} icon={Calculator} />
        </div>
      </div>

      <div className="mt-5">
        <DataPanel title="Período de análise" description="Filtre por técnico, ano e mês. Use &quot;Todos&quot; para ver o consolidado. Os gráficos de evolução mostram o ano inteiro; os demais painéis seguem o período escolhido.">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] xl:items-end">
            <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Técnico</span>
              <select
                value={selectedTechnicianId}
                onChange={(event) => setSelectedTechnicianId(event.target.value)}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                <option value="all">Todos os técnicos</option>
                {technicianOptions.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Ano</span>
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                <option value={ALL_OPTION}>Todos os anos</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1.5 block font-medium">Mês</span>
              <select
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
                className="min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
              >
                <option value={ALL_OPTION}>Todos os meses</option>
                {monthNames.map((month, index) => (
                  <option key={month} value={String(index + 1).padStart(2, '0')}>
                    {month}
                  </option>
                ))}
              </select>
            </label>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Folha / receita</p>
                <p className="mt-1 text-base font-semibold">{formatPercent(payrollShare)}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Custos / receita</p>
                <p className="mt-1 text-base font-semibold">{formatPercent(expenseShare)}</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase text-muted-foreground">Funcionários no período</p>
                <p className="mt-1 text-base font-semibold">{formatNumber(periodData.employees)}</p>
              </div>
            </div>
          </div>
        </DataPanel>
      </div>

      {!hasAnyData ? (
        <div className="mt-5">
          <EmptyState icon={AlertTriangle} title="Sem dados financeiros" description="O dashboard aparece conforme houver OS e folha cadastradas." />
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_0.9fr]">
        <DataPanel title="Evolução mensal" description={`Faturamento, custos e lucro mês a mês · ${yearLabel}.`}>
          <div className="h-86">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyData} margin={{ left: -10, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCompactCurrency} />
                <Tooltip formatter={(value) => formatChartCurrency(value)} />
                <Legend />
                <Bar dataKey="revenue" name="Faturamento" fill={chartColors[0]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Custos" fill={chartColors[2]} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="profit" name="Lucro" stroke={chartColors[1]} strokeWidth={3} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </DataPanel>

        <DataPanel title="Composição do período" description={`Origem do faturamento e custo de folha · ${periodLabel}.`}>
          <div className="grid gap-4">
            <div>
              <p className="mb-2 text-sm font-medium">Faturamento</p>
              {revenueComposition.length ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(value) => formatChartCurrency(value)} />
                      <Pie data={revenueComposition} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3}>
                        {revenueComposition.map((_, index) => (
                          <Cell key={`revenue-${index}`} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={TrendingUp} title="Sem faturamento no mês" />
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Custos</p>
              {costComposition.length ? (
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip formatter={(value) => formatChartCurrency(value)} />
                      <Pie data={costComposition} dataKey="value" nameKey="name" innerRadius={42} outerRadius={70} paddingAngle={3}>
                        {costComposition.map((_, index) => (
                          <Cell key={`cost-${index}`} fill={chartColors[(index + 2) % chartColors.length]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState icon={TrendingDown} title="Sem custos no mês" />
              )}
            </div>
          </div>
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <DataPanel title="Margem de lucro" description="Percentual de lucro sobre o faturamento mensal.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ left: -18, right: 12, top: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
                <Tooltip formatter={(value) => formatChartPercent(value)} />
                <Line type="monotone" dataKey="margin" name="Margem" stroke={chartColors[0]} strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </DataPanel>

        <DataPanel title="Faturamento por tipo de serviço" description={`Top tipos · ${periodLabel}.`}>
          {typeRevenueData.length ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={typeRevenueData} layout="vertical" margin={{ left: 18, right: 16, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={formatCompactCurrency} />
                  <YAxis dataKey="name" type="category" width={112} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatChartCurrency(value)} />
                  <Bar dataKey="revenue" name="Faturamento" radius={[0, 4, 4, 0]}>
                    {typeRevenueData.map((_, index) => (
                      <Cell key={`type-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Wrench} title="Sem serviços no mês" description="Não há OS para agrupar por tipo nesta competência." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.5fr_0.8fr]">
        <DataPanel
          title="Resultado por funcionário"
          description="Faturamento gerado, base de cálculo, custo de folha e lucro bruto no período selecionado."
          action={
            <div className="flex min-h-10 w-full items-center gap-2 rounded-md border border-border bg-background px-3 sm:w-auto">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={employeeQuery}
                onChange={(event) => setEmployeeQuery(event.target.value)}
                placeholder="Buscar funcionário"
                className="w-full bg-transparent text-sm outline-none sm:w-48"
              />
            </div>
          }
        >
          {technicianRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-160 text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Funcionário</th>
                    <th className="py-3 pr-4 font-medium">OS</th>
                    <th className="py-3 pr-4 font-medium">Faturamento</th>
                    <th className="py-3 pr-4 font-medium">Base de cálculo</th>
                    <th className="py-3 pr-4 font-medium">Folha</th>
                    <th className="py-3 pr-4 font-medium">Lucro bruto</th>
                    <th className="py-3 font-medium">Margem</th>
                  </tr>
                </thead>
                <tbody>
                  {technicianRows.slice(0, 12).map((row) => (
                    <tr key={row.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-medium">{row.name}</td>
                      <td className="py-3 pr-4">{formatNumber(row.serviceCount)}</td>
                      <td className="py-3 pr-4 text-emerald-700">{formatCurrency(row.revenue)}</td>
                      <td className="py-3 pr-4">{formatCurrency(row.calculationBase)}</td>
                      <td className="py-3 pr-4 text-amber-700">{formatCurrency(row.payrollCost)}</td>
                      <td className={`py-3 pr-4 font-semibold ${row.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(row.profit)}</td>
                      <td className="py-3">
                        <StatusBadge tone={row.margin >= 0 ? 'success' : 'danger'}>{formatPercent(row.margin)}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="Sem funcionários no recorte" description="Não há OS ou folha no período selecionado para montar o ranking." />
          )}
        </DataPanel>

        <DataPanel title="Leitura rápida" description={`Indicadores gerenciais · ${periodLabel}.`}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3">
              <span className="text-muted-foreground">Receita de serviços</span>
              <strong>{formatCurrency(periodData.serviceRevenue)}</strong>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3">
              <span className="text-muted-foreground">Custo de folha</span>
              <strong>{formatCurrency(periodData.payrollCost)}</strong>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3">
              <span className="text-muted-foreground">OS lançadas</span>
              <strong>{formatNumber(periodData.services)}</strong>
            </div>
          </div>
        </DataPanel>
      </div>
    </AppShell>
  );
}
