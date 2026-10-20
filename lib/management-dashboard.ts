// Pure calculations shared by the dashboard and its regression tests.
import { DEFAULT_ORGANIZATION_SETTINGS, netOfDailyBreak, type OrganizationSettings } from './organization-settings';

export const MONTH_NAMES = [
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
export type ManagementTechnician = { id: string; name: string; qra: string | null; status: string };
export type ProductionRow = {
  month: string;
  technicianId: string;
  serviceType: string;
  revenue: number;
  count: number;
};
export type PayrollRow = {
  month: string;
  technicianId: string;
  status: string;
  net: number;
  advances: number;
  benefits: number;
};
export type ExpenseRow = { month: string; category: string; status: string; amount: number; paid: number };
export type OperationRow = {
  month: string;
  technicianId: string;
  worked: number;
  planned: number;
  credits: number;
  debits: number;
  missed: number;
  justified: number;
  daysOff: number;
  pending: number;
  observed: number;
};
export type ManagementData = {
  year: number;
  years: number[];
  updatedAt: string;
  today: string;
  financeAvailable: boolean;
  technicians: ManagementTechnician[];
  production: ProductionRow[];
  payroll: PayrollRow[];
  expenses: ExpenseRow[];
  operations: OperationRow[];
};
export type ManagementFilters = {
  mode: 'monthly' | 'annual';
  year: number;
  month: number;
  technicianIds: string[];
  technicianStatus: 'all' | 'active' | 'inactive';
  serviceType: string;
  expenseCategory: string;
  expenseStatus: 'all' | 'paid' | 'pending';
  payrollStatus: 'closed' | 'all' | 'draft';
  costScope: 'all' | 'payroll' | 'expenses';
};
export function number(value: unknown): number {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}
export function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
export function monthKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
export function shiftMonth(value: string, shift: number) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + shift, 1));
  return monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1);
}
export function variation(current: number, previous: number): number | null {
  return previous === 0 ? (current === 0 ? 0 : null) : round(((current - previous) / Math.abs(previous)) * 100);
}
export function defaultManagementFilters(today: string): ManagementFilters {
  return {
    mode: 'monthly',
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    technicianIds: [],
    technicianStatus: 'all',
    serviceType: 'all',
    expenseCategory: 'all',
    expenseStatus: 'all',
    payrollStatus: 'closed',
    costScope: 'all',
  };
}

export type AttendanceSchedule = {
  technicianId: string;
  date: string;
  status: string;
  notes: string | null;
  start: string | null;
  end: string | null;
};
export type AttendanceHours = { technicianId: string; date: string; hours: number };

/** The Configurações rules the attendance aggregation follows (same as the admin hour bank). */
export type AttendanceRules = Pick<OrganizationSettings, 'dailyBreakMinutes' | 'chargeCancelledServicePlanned'>;

function plannedHours(start: string | null | undefined, end: string | null | undefined, dailyBreakMinutes: number) {
  const minutes = (value: string | null | undefined) => {
    const match = value?.match(/^(\d{1,2}):(\d{2})/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = minutes(start),
    to = minutes(end);
  if (from === null || to === null || to <= from) return 0;
  // Same daily break netted out by the administrative hour bank.
  return netOfDailyBreak((to - from) / 60, dailyBreakMinutes);
}

export function aggregateOperations(
  schedules: AttendanceSchedule[],
  hours: AttendanceHours[],
  today: string,
  rules: AttendanceRules = DEFAULT_ORGANIZATION_SETTINGS,
): OperationRow[] {
  const daily = new Map<
    string,
    { technicianId: string; date: string; schedule?: AttendanceSchedule; worked: number }
  >();
  for (const schedule of schedules) {
    if (schedule.date > today) continue;
    daily.set(`${schedule.technicianId}:${schedule.date}`, {
      technicianId: schedule.technicianId,
      date: schedule.date,
      schedule,
      worked: 0,
    });
  }
  for (const entry of hours) {
    if (entry.date > today) continue;
    const key = `${entry.technicianId}:${entry.date}`;
    const day = daily.get(key) ?? { technicianId: entry.technicianId, date: entry.date, worked: 0 };
    day.worked += number(entry.hours);
    daily.set(key, day);
  }
  const rows = new Map<string, OperationRow>();
  for (const day of daily.values()) {
    const month = day.date.slice(0, 7),
      key = `${day.technicianId}:${month}`;
    const row = rows.get(key) ?? {
      month,
      technicianId: day.technicianId,
      worked: 0,
      planned: 0,
      credits: 0,
      debits: 0,
      missed: 0,
      justified: 0,
      daysOff: 0,
      pending: 0,
      observed: 0,
    };
    const schedule = day.schedule;
    const status = schedule?.notes
      ?.trim()
      .match(/^Apontamento manual:\s*([^;]+)/i)?.[1]
      ?.toLowerCase();
    const missed = status?.includes('falta') ?? false;
    const justified = status?.includes('justificado') ?? false;
    // By default the hours count but the day's planned hours aren't charged — the cancellation isn't
    // the technician's doing (Configurações → chargeCancelledServicePlanned).
    const cancelledService = /servi[cç]o cancelado/.test(status ?? '') && !rules.chargeCancelledServicePlanned;
    const off = status?.includes('folga') || (schedule?.status === 'cancelled' && !status);
    const worked = day.worked > 0 || status?.includes('trabalhou') || schedule?.status === 'completed';
    const pending = !missed && !justified && !off && !worked && schedule?.status === 'scheduled' && day.date < today;
    const plannedMatch = schedule?.notes?.match(/(?:^|;\s*)previsto=(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/i);
    const planned =
      schedule && !off && !justified && !cancelledService && (missed || worked)
        ? plannedHours(plannedMatch?.[1] ?? schedule.start, plannedMatch?.[2] ?? schedule.end, rules.dailyBreakMinutes)
        : 0;
    // A missing time record or an unknown shift is not proof of an hours debit/credit.
    const balance = planned > 0 && (day.worked > 0 || missed) ? day.worked - planned : 0;
    row.worked += day.worked;
    row.planned += planned;
    row.credits += Math.max(0, balance);
    row.debits += Math.max(0, -balance);
    row.missed += Number(missed);
    row.justified += Number(justified);
    row.daysOff += Number(Boolean(off));
    row.pending += Number(Boolean(pending));
    row.observed += Number(!off && Boolean(missed || justified || worked));
    rows.set(key, row);
  }
  return [...rows.values()].map((row) => ({
    ...row,
    worked: round(row.worked),
    planned: round(row.planned),
    credits: round(row.credits),
    debits: round(row.debits),
  }));
}

function emptyMetrics() {
  return {
    revenue: 0,
    services: 0,
    payrollCost: 0,
    transfer: 0,
    expenses: 0,
    totalCosts: 0,
    net: 0,
    ticket: 0,
    margin: 0,
    worked: 0,
    planned: 0,
    credits: 0,
    debits: 0,
    balance: 0,
    missed: 0,
    justified: 0,
    daysOff: 0,
    pending: 0,
    observed: 0,
    absenceRate: 0,
    missingPayroll: 0,
    draftPayroll: 0,
    payrollCount: 0,
  };
}
export type ManagementMetrics = ReturnType<typeof emptyMetrics>;
function finishMetrics(row: ManagementMetrics): ManagementMetrics {
  row.totalCosts = round(row.payrollCost + row.expenses);
  row.net = round(row.revenue - row.totalCosts);
  row.ticket = row.services ? round(row.revenue / row.services) : 0;
  row.margin = row.revenue ? round((row.net / row.revenue) * 100) : 0;
  row.absenceRate = row.observed ? round(((row.missed + row.justified) / row.observed) * 100) : 0;
  row.balance = round(row.credits - row.debits);
  for (const key of Object.keys(emptyMetrics()) as (keyof ManagementMetrics)[]) row[key] = round(row[key]);
  return row;
}
export function buildManagementDashboard(data: ManagementData, filters: ManagementFilters) {
  const selectedTechnicians = data.technicians.filter(
    (t) =>
      (!filters.technicianIds.length || filters.technicianIds.includes(t.id)) &&
      (filters.technicianStatus === 'all' || t.status === filters.technicianStatus),
  );
  const ids = new Set(selectedTechnicians.map((t) => t.id));
  const scoped =
    filters.technicianIds.length > 0 || filters.technicianStatus !== 'all' || filters.serviceType !== 'all';
  const payrollEnabled = filters.costScope !== 'expenses';
  const expensesEnabled = filters.costScope !== 'payroll';
  const periodKey = monthKey(filters.year, filters.month);
  const currentMonths =
    filters.mode === 'annual' ? Array.from({ length: 12 }, (_, i) => monthKey(filters.year, i + 1)) : [periodKey];
  const previousMonths = currentMonths.map((month) => shiftMonth(month, filters.mode === 'annual' ? -12 : -1));
  const trendMonths =
    filters.mode === 'annual' ? currentMonths : Array.from({ length: 12 }, (_, i) => shiftMonth(periodKey, i - 11));
  const monthRows = new Map<string, ManagementMetrics>();
  const technicianRows = new Map(selectedTechnicians.map((t) => [t.id, { ...t, ...emptyMetrics() }]));
  const types = new Map<string, { name: string; revenue: number; count: number }>();
  const categories = new Map<string, number>();
  const allMonths = new Set([...currentMonths, ...previousMonths, ...trendMonths]);

  for (const month of allMonths) {
    const row = emptyMetrics();
    const production = data.production.filter((p) => p.month === month);
    const totalRevenue = production.reduce((sum, p) => sum + p.revenue, 0);
    const selectedProduction = production.filter(
      (p) => ids.has(p.technicianId) && (filters.serviceType === 'all' || p.serviceType === filters.serviceType),
    );
    const isCurrent = currentMonths.includes(month);
    const byTechnician = new Map<string, { revenue: number; count: number }>();
    for (const entry of selectedProduction) {
      row.revenue += entry.revenue;
      row.services += entry.count;
      const subtotal = byTechnician.get(entry.technicianId) ?? { revenue: 0, count: 0 };
      subtotal.revenue += entry.revenue;
      subtotal.count += entry.count;
      byTechnician.set(entry.technicianId, subtotal);
      if (isCurrent) {
        const type = types.get(entry.serviceType) ?? { name: entry.serviceType, revenue: 0, count: 0 };
        type.revenue += entry.revenue;
        type.count += entry.count;
        types.set(entry.serviceType, type);
      }
    }
    const share = scoped ? (totalRevenue > 0 ? row.revenue / totalRevenue : 0) : 1;
    const expenses = data.expenses.filter(
      (e) => e.month === month && (filters.expenseCategory === 'all' || e.category === filters.expenseCategory),
    );
    let companyExpenses = 0;
    if (expensesEnabled)
      for (const entry of expenses) {
        const amount =
          filters.expenseStatus === 'paid'
            ? entry.paid
            : filters.expenseStatus === 'pending'
              ? Math.max(0, entry.amount - entry.paid)
              : entry.amount;
        companyExpenses += amount;
        if (isCurrent) categories.set(entry.category, (categories.get(entry.category) ?? 0) + amount * share);
      }
    row.expenses = companyExpenses * share;
    for (const technician of selectedTechnicians) {
      const subtotal = byTechnician.get(technician.id) ?? { revenue: 0, count: 0 };
      const technicianRevenue = production
        .filter((p) => p.technicianId === technician.id)
        .reduce((sum, p) => sum + p.revenue, 0);
      const productionShare =
        filters.serviceType === 'all' ? 1 : technicianRevenue > 0 ? subtotal.revenue / technicianRevenue : 0;
      const payroll = data.payroll.find((p) => p.month === month && p.technicianId === technician.id);
      const includePayroll =
        payroll && payrollEnabled && (filters.payrollStatus === 'all' || payroll.status === filters.payrollStatus);
      // Advances were already paid: add them back to avoid understating the company's labor cost.
      const cost = includePayroll ? (payroll.net + payroll.advances + payroll.benefits) * productionShare : 0;
      const transfer = includePayroll ? (payroll.net + payroll.advances) * productionShare : 0;
      const missing = payrollEnabled && subtotal.count > 0 && (!payroll || payroll.status !== 'closed');
      row.payrollCost += cost;
      row.transfer += transfer;
      row.missingPayroll += Number(missing);
      row.draftPayroll += Number(Boolean(includePayroll && payroll.status === 'draft'));
      row.payrollCount += Number(Boolean(includePayroll && productionShare > 0));
      const individual = technicianRows.get(technician.id)!;
      if (isCurrent) {
        individual.revenue += subtotal.revenue;
        individual.services += subtotal.count;
        individual.payrollCost += cost;
        individual.transfer += transfer;
        individual.expenses += totalRevenue > 0 ? (companyExpenses * subtotal.revenue) / totalRevenue : 0;
        individual.missingPayroll += Number(missing);
        individual.draftPayroll += Number(Boolean(includePayroll && payroll.status === 'draft'));
        individual.payrollCount += Number(Boolean(includePayroll && productionShare > 0));
      }
    }
    // Service and expense classifications do not describe attendance; operational scope is period + team.
    for (const operation of data.operations.filter((o) => o.month === month && ids.has(o.technicianId))) {
      const fields = [
        'worked',
        'planned',
        'credits',
        'debits',
        'missed',
        'justified',
        'daysOff',
        'pending',
        'observed',
      ] as const;
      for (const field of fields) {
        row[field] += operation[field];
        if (isCurrent) technicianRows.get(operation.technicianId)![field] += operation[field];
      }
    }
    monthRows.set(month, finishMetrics(row));
  }
  function sumMonths(months: string[]) {
    const result = emptyMetrics();
    for (const month of months) {
      const row = monthRows.get(month)!;
      for (const field of Object.keys(result) as (keyof ManagementMetrics)[]) result[field] += row[field];
    }
    return finishMetrics(result);
  }
  const current = sumMonths(currentMonths),
    previous = sumMonths(previousMonths);
  const trend = trendMonths.map((month) => {
    const accumulated = data.operations
      .filter((o) => o.month <= month && ids.has(o.technicianId))
      .reduce((sum, o) => sum + o.credits - o.debits, 0);
    return {
      ...monthRows.get(month)!,
      month,
      label: `${MONTH_NAMES[Number(month.slice(5)) - 1].slice(0, 3)}/${month.slice(2, 4)}`,
      accumulated: round(accumulated),
    };
  });
  const technicians = [...technicianRows.values()]
    .map((t) => ({ ...t, ...finishMetrics(t) }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name, 'pt-BR'));
  const endMonth = currentMonths[currentMonths.length - 1];
  return {
    current,
    previous,
    trend,
    technicians,
    scoped,
    accumulated: round(
      data.operations
        .filter((o) => o.month <= endMonth && ids.has(o.technicianId))
        .reduce((sum, o) => sum + o.credits - o.debits, 0),
    ),
    types: [...types.values()].sort((a, b) => b.revenue - a.revenue),
    categories: [...categories]
      .map(([name, value]) => ({ name, value: round(value) }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value),
    periodLabel:
      filters.mode === 'annual' ? String(filters.year) : `${MONTH_NAMES[filters.month - 1]} de ${filters.year}`,
    comparisonLabel:
      filters.mode === 'annual'
        ? String(filters.year - 1)
        : `${MONTH_NAMES[Number(previousMonths[0].slice(5)) - 1]} de ${previousMonths[0].slice(0, 4)}`,
  };
}
