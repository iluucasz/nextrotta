// The folha's arithmetic, in one place: the server (preview, calculate) and the Folha screen use the same
// functions, so what the admin sees while editing is what the system would have calculated.
// Dependency-free on purpose (also read by the tests). Relative imports only.
import type { BenefitPayment, CommissionMode, OrganizationSettings, ServiceAwardTier } from './organization-settings';

export function roundCents(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;

  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

/** The production percentage: total of the month's OS × commission %. */
export function commissionBase(totalServices: number, percentage: number): number {
  return roundCents(Math.max(0, totalServices) * (percentage / 100));
}

/** Which vouchers are taken off the commission (both by default: the original rule). */
export interface BenefitDeduction {
  vrDeducts?: boolean;
  vaDeducts?: boolean;
}

/**
 * What the company must pay before commission starts to exist: the salary plus the vouchers that deduct.
 * A voucher that does not deduct (paid apart, outside the production) is not part of it.
 */
export function fixedCosts(baseSalary: number, vrAllowance: number, vaAllowance: number, deduction: BenefitDeduction = {}): number {
  const vr = deduction.vrDeducts === false ? 0 : roundCents(vrAllowance);
  const va = deduction.vaDeducts === false ? 0 : roundCents(vaAllowance);
  return roundCents(roundCents(baseSalary) + vr + va);
}

/** The settings that decide how the vouchers are treated (a subset, so a technician's screen can use it too). */
export type BenefitRules = Pick<OrganizationSettings, 'vaDeductsFromCommission' | 'vrDeductsFromCommission' | 'vaPayment' | 'vrPayment'>;

export function deductionOf(rules: Pick<BenefitRules, 'vaDeductsFromCommission' | 'vrDeductsFromCommission'>): Required<BenefitDeduction> {
  return { vaDeducts: rules.vaDeductsFromCommission, vrDeducts: rules.vrDeductsFromCommission };
}

/** Where a voucher is paid, in the words the screens use: "no cartão" or "em dinheiro". */
export function benefitPaidPhrase(payment: BenefitPayment): string {
  return payment === 'cash' ? 'em dinheiro' : 'no cartão';
}

/**
 * The heading of the vouchers block of the folha: "Cartões" when both are on a card, "Dinheiro à parte" when both are
 * paid in cash, "Vales (cartão e dinheiro)" when each is paid its own way.
 */
export function benefitsTitle(rules: Pick<BenefitRules, 'vaPayment' | 'vrPayment'>): string {
  if (rules.vaPayment === rules.vrPayment) return rules.vrPayment === 'cash' ? 'Dinheiro à parte' : 'Cartões';
  return 'Vales (cartão e dinheiro)';
}

/** The sentence under that heading, saying how the vouchers relate to the account payment and to the commission. */
export function benefitsExplanation(rules: Pick<BenefitRules, 'vaPayment' | 'vrPayment' | 'vaDeductsFromCommission' | 'vrDeductsFromCommission'>, excessMode: boolean): string {
  const where = rules.vaPayment === rules.vrPayment ? (rules.vrPayment === 'cash' ? 'Pagos em dinheiro' : 'Pagos no cartão') : 'Pagos no cartão ou em dinheiro, cada um do seu jeito';
  const base = `${where}, fora do valor em conta.`;
  if (!excessMode) return base;
  const deducting = [rules.vrDeductsFromCommission && 'VR', rules.vaDeductsFromCommission && 'VA'].filter(Boolean);
  return deducting.length
    ? `${base} ${deducting.join(' e ')} ${deducting.length > 1 ? 'contam' : 'conta'} como fixo: a comissão só começa depois ${deducting.length > 1 ? 'deles' : 'dele'}.`
    : `${base} Não abatem a comissão.`;
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

export interface CommissionInput extends BenefitDeduction {
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
      value = roundCents(Math.max(0, commissionBase(input.totalServices, input.percentage) - fixedCosts(input.baseSalary, input.vrAllowance, input.vaAllowance, input)));
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
