import { sql } from './db';
import { calculateServiceAward, valueOrDefault, type OrganizationSettings } from './organization-settings';
import { getOrganizationSettings } from './organization-settings-store';

function roundCurrency(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

async function isTechnicianActive(organizationId: string, technicianId: string) {
  const result = await sql`
    SELECT status
    FROM technicians
    WHERE id = ${technicianId}
      AND organization_id = ${organizationId}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  return result[0]?.status === 'active';
}

function createEmptyPayrollResult(technicianId: string, competenceMonth: string): PayrollCalculationResult {
  return {
    technician_id: technicianId,
    competence_month: competenceMonth,
    total_services_value: 0,
    commission_value: 0,
    base_salary: 0,
    va_deduction: 0,
    vr_deduction: 0,
    discounts_total: 0,
    advances_total: 0,
    extra_hours_value: 0,
    extraordinary_award_value: 0,
    hour_bank_balance: 0,
    net_total: 0,
  };
}

export interface PayrollCalculationInput {
  organizationId: string;
  technicianId: string;
  competenceMonth: string; // Format: YYYY-MM
}

export interface PayrollCalculationResult {
  technician_id: string;
  competence_month: string;
  total_services_value: number;
  commission_value: number;
  base_salary: number;
  va_deduction: number;
  vr_deduction: number;
  discounts_total: number;
  advances_total: number;
  extra_hours_value: number;
  extraordinary_award_value: number;
  hour_bank_balance: number;
  net_total: number;
}

type PayrollReference = PayrollCalculationResult;

/**
 * Calculate total value of services for the month
 */
export async function calculateTotalServices(
  organizationId: string,
  technicianId: string,
  competenceMonth: string
): Promise<number> {
  const result = await sql`
    SELECT COALESCE(SUM(value), 0) as total
    FROM services
    WHERE organization_id = ${organizationId}
    AND technician_id = ${technicianId}
    AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM technicians t WHERE t.id = services.technician_id AND t.status = 'active')
    AND COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed::date, 'YYYY-MM')) = ${competenceMonth}
  `;

  return roundCurrency(result[0]?.total || 0);
}

export async function calculateServiceCount(
  organizationId: string,
  technicianId: string,
  competenceMonth: string
): Promise<number> {
  const result = await sql`
    SELECT COUNT(*) as total
    FROM services
    WHERE organization_id = ${organizationId}
    AND technician_id = ${technicianId}
    AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM technicians t WHERE t.id = services.technician_id AND t.status = 'active')
    AND COALESCE(NULLIF(competence_month, ''), TO_CHAR(date_performed::date, 'YYYY-MM')) = ${competenceMonth}
  `;

  return Number(result[0]?.total || 0);
}

function calculateCommissionFromTotals(
  totalServices: number,
  commissionPercentage: number,
): number {
  return roundCurrency(Math.max(0, totalServices) * (commissionPercentage / 100));
}

function calculateCommissionRemainder(
  calculationBase: number,
  baseSalary: number,
  vaAllowance: number,
  vrAllowance: number,
): number {
  return roundCurrency(
    Math.max(
      0,
      roundCurrency(calculationBase) -
        roundCurrency(baseSalary) -
        roundCurrency(vaAllowance) -
        roundCurrency(vrAllowance),
    ),
  );
}

async function getPayrollReference(
  organizationId: string,
  technicianId: string,
  competenceMonth: string,
): Promise<PayrollReference | null> {
  const result = await sql`
    SELECT
      technician_id,
      competence_month,
      total_services_value,
      commission_value,
      base_salary,
      va_deduction,
      vr_deduction,
      discounts_total,
      advances_total,
      extra_hours_value,
      extraordinary_award_value,
      hour_bank_balance,
      net_total
    FROM payroll
    WHERE organization_id = ${organizationId}
    AND technician_id = ${technicianId}
    AND competence_month = ${competenceMonth}
    AND deleted_at IS NULL
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `;

  if (!result.length) {
    return null;
  }

  const row = result[0] as Record<string, unknown>;
  const toCurrency = (value: unknown) => roundCurrency(value as number | string | null | undefined);

  return {
    technician_id: String(row.technician_id ?? technicianId),
    competence_month: String(row.competence_month ?? ''),
    total_services_value: toCurrency(row.total_services_value),
    commission_value: toCurrency(row.commission_value),
    base_salary: toCurrency(row.base_salary),
    va_deduction: toCurrency(row.va_deduction),
    vr_deduction: toCurrency(row.vr_deduction),
    discounts_total: toCurrency(row.discounts_total),
    advances_total: toCurrency(row.advances_total),
    extra_hours_value: toCurrency(row.extra_hours_value),
    extraordinary_award_value: toCurrency(row.extraordinary_award_value),
    hour_bank_balance: toCurrency(row.hour_bank_balance),
    net_total: toCurrency(row.net_total),
  };
}

function shouldUsePayrollReference(
  totalServices: number,
  reference: PayrollReference | null,
): boolean {
  if (!reference) {
    return false;
  }

  return totalServices <= 0;
}

/**
 * Calculate commission based on services and commission percentage
 */
export async function calculateCommission(
  organizationId: string,
  technicianId: string,
  competenceMonth: string,
  totalServices: number,
  settings: OrganizationSettings,
): Promise<number> {
  const technician = await sql`
    SELECT commission_percentage, base_salary, va_allowance, vr_allowance
    FROM technicians
    WHERE id = ${technicianId}
      AND organization_id = ${organizationId}
      AND status = 'active'
      AND deleted_at IS NULL
  `;

  if (!technician || technician.length === 0) {
    return 0;
  }

  const calculationBase = calculateCommissionFromTotals(
    totalServices,
    valueOrDefault(technician[0]?.commission_percentage, settings.commissionPercentage),
  );

  return calculateCommissionRemainder(
    calculationBase,
    valueOrDefault(technician[0]?.base_salary, settings.baseSalary),
    valueOrDefault(technician[0]?.va_allowance, settings.vaAllowance),
    valueOrDefault(technician[0]?.vr_allowance, settings.vrAllowance),
  );
}

/**
 * Calculate total work hours for the month
 */
export async function calculateTotalHours(
  organizationId: string,
  technicianId: string,
  competenceMonth: string
): Promise<number> {
  const result = await sql`
    SELECT COALESCE(SUM(hours_worked), 0) as total
    FROM work_hours
    WHERE organization_id = ${organizationId}
    AND technician_id = ${technicianId}
    AND deleted_at IS NULL
    AND TO_CHAR(date, 'YYYY-MM') = ${competenceMonth}
  `;

  return Number(result[0]?.total || 0);
}

/**
 * Calculate extra hours and hour bank balance against the organization's monthly working hours.
 */
export async function calculateHourBank(
  organizationId: string,
  technicianId: string,
  competenceMonth: string,
  totalHours: number,
  monthlyHours: number,
): Promise<{ extra_hours: number; bank_balance: number }> {
  const extraHours = Math.max(0, totalHours - monthlyHours);

  // Get current bank balance
  const previousMonth = new Date(competenceMonth + '-01');
  previousMonth.setMonth(previousMonth.getMonth() - 1);
  const previousMonthStr = previousMonth.toISOString().slice(0, 7);

  const previousPayroll = await sql`
    SELECT hour_bank_balance
    FROM payroll
    WHERE organization_id = ${organizationId}
    AND technician_id = ${technicianId}
    AND competence_month = ${previousMonthStr}
    AND deleted_at IS NULL
  `;

  const previousBalance = Number(previousPayroll[0]?.hour_bank_balance || 0);
  const newBalance = previousBalance + extraHours;

  return {
    extra_hours: extraHours,
    bank_balance: newBalance,
  };
}

/**
 * Calculate total discounts and advances
 */
export async function calculateDiscounts(
  organizationId: string,
  technicianId: string,
  competenceMonth: string
): Promise<{ discounts_total: number; advances_total: number }> {
  const result = await sql`
    SELECT 
      COALESCE(SUM(CASE WHEN type IN ('discount', 'other') THEN amount ELSE 0 END), 0) as discounts,
      COALESCE(SUM(CASE WHEN type = 'advance' THEN amount ELSE 0 END), 0) as advances
    FROM discounts
    WHERE organization_id = ${organizationId}
    AND technician_id = ${technicianId}
    AND competence_month = ${competenceMonth}
    AND deleted_at IS NULL
  `;

  return {
    discounts_total: roundCurrency(result[0]?.discounts || 0),
    advances_total: roundCurrency(result[0]?.advances || 0),
  };
}

/**
 * Get technician allowances
 */
/** The technician's own values, each falling back to the Configurações default when unset (0). */
export async function getTechnicianAllowances(
  organizationId: string,
  technicianId: string,
  settings: OrganizationSettings,
): Promise<{ va_allowance: number; vr_allowance: number; base_salary: number; commission_percentage: number }> {
  const result = await sql`
    SELECT base_salary, va_allowance, vr_allowance, commission_percentage
    FROM technicians
    WHERE id = ${technicianId}
      AND organization_id = ${organizationId}
      AND status = 'active'
      AND deleted_at IS NULL
  `;

  if (!result || result.length === 0) {
    return { va_allowance: 0, vr_allowance: 0, base_salary: 0, commission_percentage: settings.commissionPercentage };
  }

  return {
    base_salary: roundCurrency(valueOrDefault(result[0]?.base_salary, settings.baseSalary)),
    va_allowance: roundCurrency(valueOrDefault(result[0]?.va_allowance, settings.vaAllowance)),
    vr_allowance: roundCurrency(valueOrDefault(result[0]?.vr_allowance, settings.vrAllowance)),
    commission_percentage: roundCurrency(valueOrDefault(result[0]?.commission_percentage, settings.commissionPercentage)),
  };
}

/**
 * Calculate extra hours value: hourly rate (base salary / monthly hours) times the organization's
 * overtime multiplier.
 */
export async function calculateExtraHoursValue(
  extraHours: number,
  baseSalary: number,
  settings: OrganizationSettings,
): Promise<number> {
  const hourlyRate = baseSalary / settings.monthlyHours;

  return roundCurrency(extraHours * hourlyRate * settings.overtimeMultiplier);
}

/**
 * Complete payroll calculation for a technician in a given month
 */
export async function calculatePayroll(
  input: PayrollCalculationInput
): Promise<PayrollCalculationResult> {
  const { organizationId, technicianId, competenceMonth } = input;

  if (!(await isTechnicianActive(organizationId, technicianId))) {
    return createEmptyPayrollResult(technicianId, competenceMonth);
  }

  // Get base info
  const settings = await getOrganizationSettings(organizationId);
  const allowances = await getTechnicianAllowances(organizationId, technicianId, settings);
  const payrollReference = await getPayrollReference(organizationId, technicianId, competenceMonth);

  // Calculate services and commission
  const calculatedTotalServices = await calculateTotalServices(organizationId, technicianId, competenceMonth);
  const serviceCount = await calculateServiceCount(organizationId, technicianId, competenceMonth);
  const usePayrollReference = shouldUsePayrollReference(calculatedTotalServices, payrollReference);
  const totalServices = usePayrollReference
    ? roundCurrency(payrollReference?.total_services_value)
    : roundCurrency(calculatedTotalServices);
  const calculationBase = calculateCommissionFromTotals(totalServices, allowances.commission_percentage);
  const commission = calculateCommissionRemainder(
    calculationBase,
    allowances.base_salary,
    allowances.va_allowance,
    allowances.vr_allowance,
  );
  const extraordinaryAward = calculateServiceAward(serviceCount, settings.serviceAwardTiers);

  // Calculate hours
  const totalHours = await calculateTotalHours(organizationId, technicianId, competenceMonth);
  const { extra_hours, bank_balance } = await calculateHourBank(
    organizationId,
    technicianId,
    competenceMonth,
    totalHours,
    settings.monthlyHours,
  );
  const extraHoursValue = await calculateExtraHoursValue(extra_hours, allowances.base_salary, settings);

  // Calculate discounts
  const calculatedDiscounts = await calculateDiscounts(organizationId, technicianId, competenceMonth);
  const discounts_total =
    usePayrollReference && calculatedDiscounts.discounts_total === 0
      ? roundCurrency(payrollReference?.discounts_total)
      : roundCurrency(calculatedDiscounts.discounts_total);
  const advances_total =
    usePayrollReference && calculatedDiscounts.advances_total === 0
      ? roundCurrency(payrollReference?.advances_total)
      : roundCurrency(calculatedDiscounts.advances_total);

  // Calculate net total
  const grossCashTotal = roundCurrency(
    allowances.base_salary +
    commission +
    extraHoursValue +
    extraordinaryAward,
  );

  const netTotal = roundCurrency(
    grossCashTotal -
    discounts_total -
    advances_total,
  );

  return {
    technician_id: technicianId,
    competence_month: competenceMonth,
    total_services_value: roundCurrency(totalServices),
    commission_value: roundCurrency(commission),
    base_salary: roundCurrency(allowances.base_salary),
    va_deduction: roundCurrency(allowances.va_allowance),
    vr_deduction: roundCurrency(allowances.vr_allowance),
    discounts_total,
    advances_total,
    extra_hours_value: roundCurrency(extraHoursValue),
    extraordinary_award_value: roundCurrency(extraordinaryAward),
    hour_bank_balance: roundCurrency(bank_balance),
    net_total: roundCurrency(netTotal),
  };
}
