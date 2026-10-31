// The Faturamento report: what the services billed, what the folha cost and what was left, for a month or a
// year, against the previous one. Pure (no database, no React): the screen only draws what this returns.
// Same criteria as the Dashboard Gerencial: only closed folhas count, and a technician's cost is the net
// paid plus the advances already given plus the meal/food cards.
import { resolveCompetenceMonth } from './formatters';
import type { Payroll, Service, Technician } from './types';

export type BillingMode = 'monthly' | 'annual';

export type BillingFilters = {
  mode: BillingMode;
  year: number;
  /** 1-12; ignored in the annual mode. */
  month: number;
  technicianId: string;
};

export const BILLING_MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SHORT_MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export type BillingTotals = {
  revenue: number;
  services: number;
  payrollCost: number;
  payrollCount: number;
  net: number;
  /** Net over revenue, in %. */
  margin: number;
  ticket: number;
  /** Technician-months with services but no closed folha: the result is partial. */
  missingPayroll: number;
  /** The same, when a draft exists (not counted as cost until closed). */
  draftPayroll: number;
  /** Technicians with at least one service in the period. */
  producers: number;
};

export type BillingTrendPoint = { key: string; label: string; revenue: number; cost: number; net: number; services: number };
export type BillingTypeRow = { name: string; revenue: number; count: number };
export type BillingTechnicianRow = {
  id: string;
  name: string;
  qra: string;
  services: number;
  revenue: number;
  ticket: number;
  payrollCost: number;
  net: number;
  margin: number;
  missingPayroll: number;
  draftPayroll: number;
};

export type BillingReport = {
  current: BillingTotals;
  previous: BillingTotals;
  trend: BillingTrendPoint[];
  types: BillingTypeRow[];
  technicians: BillingTechnicianRow[];
  activeTechnicians: number;
  periodLabel: string;
  comparisonLabel: string;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const money = (value: unknown) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};
const pad = (value: number) => String(value).padStart(2, '0');
const monthKey = (year: number, month: number) => {
  // month may be 0 or 13 after a shift: let Date carry the year.
  const date = new Date(Date.UTC(year, month - 1, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};

/** The competences ("YYYY-MM") a period covers: one month, or the twelve of the year. */
export function periodMonths(filters: Pick<BillingFilters, 'mode' | 'year' | 'month'>): string[] {
  return filters.mode === 'annual' ? Array.from({ length: 12 }, (_, index) => monthKey(filters.year, index + 1)) : [monthKey(filters.year, filters.month)];
}

/** What the period is compared with: the month before (December wraps to the previous year) or the previous year. */
export function previousPeriodMonths(filters: Pick<BillingFilters, 'mode' | 'year' | 'month'>): string[] {
  return filters.mode === 'annual'
    ? periodMonths({ mode: 'annual', year: filters.year - 1, month: 1 })
    : [monthKey(filters.year, filters.month - 1)];
}

/** Twelve points for the evolution chart: the year, or the 12 months ending in the selected month. */
export function trendMonths(filters: Pick<BillingFilters, 'mode' | 'year' | 'month'>): string[] {
  return filters.mode === 'annual' ? periodMonths(filters) : Array.from({ length: 12 }, (_, index) => monthKey(filters.year, filters.month - 11 + index));
}

function shortLabel(key: string) {
  return `${SHORT_MONTH_NAMES[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
}

export function periodLabelOf(filters: Pick<BillingFilters, 'mode' | 'year' | 'month'>) {
  return filters.mode === 'annual' ? `Ano ${filters.year}` : `${BILLING_MONTH_NAMES[filters.month - 1]} de ${filters.year}`;
}

export function comparisonLabelOf(filters: Pick<BillingFilters, 'mode' | 'year' | 'month'>) {
  if (filters.mode === 'annual') return `ano ${filters.year - 1}`;
  const previous = previousPeriodMonths(filters)[0];
  return `${BILLING_MONTH_NAMES[Number(previous.slice(5, 7)) - 1].toLowerCase()} de ${previous.slice(0, 4)}`;
}

/** What a closed folha cost the company: the net paid, the advances given earlier and the cards. */
export function payrollCostOf(payroll: Pick<Payroll, 'net_total' | 'advances_total' | 'va_deduction' | 'vr_deduction'>) {
  return cents(money(payroll.net_total) + money(payroll.advances_total) + money(payroll.va_deduction) + money(payroll.vr_deduction));
}

export function buildBillingReport(
  input: { services: Service[]; payroll: Payroll[]; technicians: Technician[] },
  filters: BillingFilters,
): BillingReport {
  const activeIds = new Set(input.technicians.filter((technician) => technician.status === 'active').map((technician) => technician.id));
  const inScope = (technicianId: string) => activeIds.has(technicianId) && (filters.technicianId === 'all' || technicianId === filters.technicianId);

  const services = input.services.filter((service) => service.technician_id && inScope(service.technician_id));
  const payroll = input.payroll.filter((item) => inScope(item.technician_id));
  const closedPayroll = payroll.filter((item) => item.status === 'closed');
  const draftKeys = new Set(payroll.filter((item) => item.status !== 'closed').map((item) => `${item.technician_id}|${item.competence_month}`));
  const closedKeys = new Set(closedPayroll.map((item) => `${item.technician_id}|${item.competence_month}`));

  const competenceOf = (service: Service) => resolveCompetenceMonth(service.competence_month, service.date_performed);

  function totalsFor(months: string[]): BillingTotals {
    const set = new Set(months);
    const periodServices = services.filter((service) => set.has(competenceOf(service)));
    const periodPayroll = closedPayroll.filter((item) => set.has(item.competence_month));

    const revenue = cents(periodServices.reduce((total, service) => total + money(service.value), 0));
    const payrollCost = cents(periodPayroll.reduce((total, item) => total + payrollCostOf(item), 0));
    const net = cents(revenue - payrollCost);

    const producedMonths = new Set(periodServices.map((service) => `${service.technician_id}|${competenceOf(service)}`));
    let missingPayroll = 0;
    let draftPayroll = 0;
    producedMonths.forEach((key) => {
      if (closedKeys.has(key)) return;
      if (draftKeys.has(key)) draftPayroll += 1;
      else missingPayroll += 1;
    });

    return {
      revenue,
      services: periodServices.length,
      payrollCost,
      payrollCount: periodPayroll.length,
      net,
      margin: revenue > 0 ? cents((net / revenue) * 100) : 0,
      ticket: periodServices.length ? cents(revenue / periodServices.length) : 0,
      missingPayroll,
      draftPayroll,
      producers: new Set(periodServices.map((service) => service.technician_id)).size,
    };
  }

  const months = periodMonths(filters);
  const current = totalsFor(months);
  const previous = totalsFor(previousPeriodMonths(filters));

  const trend = trendMonths(filters).map((key) => {
    const totals = totalsFor([key]);
    return { key, label: shortLabel(key), revenue: totals.revenue, cost: totals.payrollCost, net: totals.net, services: totals.services };
  });

  const monthSet = new Set(months);
  const periodServices = services.filter((service) => monthSet.has(competenceOf(service)));

  const typeGroups = new Map<string, BillingTypeRow>();
  periodServices.forEach((service) => {
    const name = service.service_type || 'Sem tipo';
    const row = typeGroups.get(name) ?? { name, revenue: 0, count: 0 };
    row.revenue = cents(row.revenue + money(service.value));
    row.count += 1;
    typeGroups.set(name, row);
  });
  const types = Array.from(typeGroups.values()).sort((left, right) => right.revenue - left.revenue);

  const rows = new Map<string, BillingTechnicianRow>();
  const technicianById = new Map(input.technicians.map((technician) => [technician.id, technician]));
  const rowOf = (id: string) => {
    let row = rows.get(id);
    if (!row) {
      const technician = technicianById.get(id);
      row = { id, name: technician?.name ?? 'Técnico', qra: technician?.qra ?? '', services: 0, revenue: 0, ticket: 0, payrollCost: 0, net: 0, margin: 0, missingPayroll: 0, draftPayroll: 0 };
      rows.set(id, row);
    }
    return row;
  };
  periodServices.forEach((service) => {
    const row = rowOf(service.technician_id);
    row.services += 1;
    row.revenue = cents(row.revenue + money(service.value));
  });
  closedPayroll
    .filter((item) => monthSet.has(item.competence_month))
    .forEach((item) => {
      const row = rowOf(item.technician_id);
      row.payrollCost = cents(row.payrollCost + payrollCostOf(item));
    });
  new Set(periodServices.map((service) => `${service.technician_id}|${competenceOf(service)}`)).forEach((key) => {
    if (closedKeys.has(key)) return;
    const row = rowOf(key.split('|')[0]);
    if (draftKeys.has(key)) row.draftPayroll += 1;
    else row.missingPayroll += 1;
  });

  const technicians = Array.from(rows.values()).map((row) => {
    const net = cents(row.revenue - row.payrollCost);
    return { ...row, net, ticket: row.services ? cents(row.revenue / row.services) : 0, margin: row.revenue > 0 ? cents((net / row.revenue) * 100) : 0 };
  });

  return {
    current,
    previous,
    trend,
    types,
    technicians,
    activeTechnicians: filters.technicianId === 'all' ? activeIds.size : 1,
    periodLabel: periodLabelOf(filters),
    comparisonLabel: comparisonLabelOf(filters),
  };
}
