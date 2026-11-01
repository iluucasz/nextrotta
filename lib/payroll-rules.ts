// The folha's arithmetic, in one place: the server (preview, calculate) and the Folha screen use the same
// functions, so what the admin sees while editing is what the system would have calculated.
// Dependency-free on purpose (also read by the tests). Relative imports only.
import type { CommissionMode, ServiceAwardTier } from './organization-settings';

export function roundCents(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;

  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

/** The production percentage: total of the month's OS × commission %. */
export function commissionBase(totalServices: number, percentage: number): number {
  return roundCents(Math.max(0, totalServices) * (percentage / 100));
}

/** What the company must pay before commission starts to exist (salary + the two cards). */
export function fixedCosts(baseSalary: number, vrAllowance: number, vaAllowance: number): number {
  return roundCents(roundCents(baseSalary) + roundCents(vrAllowance) + roundCents(vaAllowance));
}

/** What the amount stored next to a commission mode means: a percentage, or R$ per service, hour or day. */
export type RateKind = 'percent' | 'service' | 'hour' | 'day';

export function rateKindOf(mode: CommissionMode): RateKind | null {
  switch (mode) {
    case 'excess':
    case 'percentage':
      return 'percent';
    case 'per_service':
      return 'service';
    case 'per_hour':
      return 'hour';
    case 'per_day':
      return 'day';
    default:
      return null;
  }
}

/** Keeps the month's commission inside the optional guaranteed minimum and cap (0 = not used). The cap has the last word. */
export function boundCommission(value: number, minimum = 0, maximum = 0): number {
  let bounded = value;
  if (minimum > 0) bounded = Math.max(bounded, minimum);
  if (maximum > 0) bounded = Math.min(bounded, maximum);
  return roundCents(bounded);
}

export interface CommissionInput {
  mode: CommissionMode;
  /** Total value of the month's OS, in R$ (the percentage modes). */
  totalServices: number;
  /** Commission percentage (the percentage modes). */
  percentage: number;
  baseSalary: number;
  vrAllowance: number;
  vaAllowance: number;
  /** Number of OS in the month (per_service). */
  serviceCount?: number;
  /** Hours worked in the month (per_hour). */
  totalHours?: number;
  /** Days with hours worked in the month (per_day). */
  daysWorked?: number;
  /** R$ per service, hour or day, according to the mode. */
  rate?: number;
  /** Guaranteed minimum and cap of the month's commission, in R$ (0 = not used). */
  minimum?: number;
  maximum?: number;
}

/**
 * - `excess`: the commission is what the production percentage leaves after the salary and the cards (never below 0).
 * - `percentage`: the commission is the production percentage itself, paid on top of the salary.
 * - `per_service`: a fixed amount for each OS of the month.
 * - `per_hour`: a fixed amount for each hour worked in the month.
 * - `per_day`: a fixed amount for each day worked in the month.
 * - `none`: there is no commission.
 * Except for `none`, the result is held between the guaranteed minimum and the cap when they are set.
 */
export function calculateCommissionValue(input: CommissionInput): number {
  if (input.mode === 'none') return 0;

  const rate = Math.max(0, Number(input.rate) || 0);
  let value: number;

  switch (input.mode) {
    case 'percentage':
      value = commissionBase(input.totalServices, input.percentage);
      break;
    case 'per_service':
      value = roundCents(Math.max(0, input.serviceCount ?? 0) * rate);
      break;
    case 'per_hour':
      value = roundCents(Math.max(0, input.totalHours ?? 0) * rate);
      break;
    case 'per_day':
      value = roundCents(Math.max(0, input.daysWorked ?? 0) * rate);
      break;
    default:
      value = roundCents(Math.max(0, commissionBase(input.totalServices, input.percentage) - fixedCosts(input.baseSalary, input.vrAllowance, input.vaAllowance)));
  }

  return boundCommission(value, input.minimum, input.maximum);
}

/** Overtime: hours over the monthly target, paid at the hourly rate (salary ÷ target) × the multiplier. */
export function calculateOvertime(input: { totalHours: number; monthlyHours: number; baseSalary: number; multiplier: number }) {
  const extraHours = Math.max(0, input.totalHours - input.monthlyHours);
  const hourlyRate = input.monthlyHours > 0 ? input.baseSalary / input.monthlyHours : 0;

  return { extraHours, hourlyRate, value: roundCents(extraHours * hourlyRate * input.multiplier) };
}

/** The award of the highest tier reached, plus the next one still to reach. */
export function awardProgress(serviceCount: number, tiers: ServiceAwardTier[]) {
  const sorted = [...tiers].sort((a, b) => a.minServices - b.minServices);
  let reached: ServiceAwardTier | null = null;
  let next: ServiceAwardTier | null = null;

  for (const tier of sorted) {
    if (serviceCount >= tier.minServices) reached = tier;
    else if (!next) next = tier;
  }

  return { reached, next };
}

/** Salary + commission + overtime + award − discounts − advances: what goes to the technician's account. */
export function calculateCashNet(parts: {
  baseSalary: number;
  commission: number;
  extraHours: number;
  award: number;
  discounts: number;
  advances: number;
}): number {
  return roundCents(parts.baseSalary + parts.commission + parts.extraHours + parts.award - parts.discounts - parts.advances);
}

/** How a calculated folha came about: lets the screen explain each value. Never stored. */
export interface PayrollDetails {
  commissionMode: CommissionMode;
  commissionPercentage: number;
  /** R$ per service, hour or day (the per_* modes). */
  commissionRate: number;
  commissionMinimum: number;
  commissionMaximum: number;
  serviceCount: number;
  /** Days with hours worked in the month. */
  daysWorked: number;
  totalHours: number;
  monthlyHours: number;
  extraHours: number;
  hourlyRate: number;
  overtimeMultiplier: number;
  /** The hour bank balance carried from the previous month's folha. */
  previousHourBank: number;
}
