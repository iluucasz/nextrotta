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

/**
 * - `excess`: the commission is what the production percentage leaves after the salary and the cards (never below 0).
 * - `percentage`: the commission is the production percentage itself, paid on top of the salary.
 * - `none`: there is no commission.
 */
export function calculateCommissionValue(input: {
  mode: CommissionMode;
  totalServices: number;
  percentage: number;
  baseSalary: number;
  vrAllowance: number;
  vaAllowance: number;
}): number {
  if (input.mode === 'none') return 0;

  const base = commissionBase(input.totalServices, input.percentage);
  if (input.mode === 'percentage') return base;

  return roundCents(Math.max(0, base - fixedCosts(input.baseSalary, input.vrAllowance, input.vaAllowance)));
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
  serviceCount: number;
  totalHours: number;
  monthlyHours: number;
  extraHours: number;
  hourlyRate: number;
  overtimeMultiplier: number;
  /** The hour bank balance carried from the previous month's folha. */
  previousHourBank: number;
}
