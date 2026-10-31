/** Validation of what the folha routes receive. Pure (no database), so the tests can load it alone. */

export const PAYROLL_VALUE_FIELDS = [
  'total_services_value',
  'commission_value',
  'base_salary',
  'va_deduction',
  'vr_deduction',
  'discounts_total',
  'advances_total',
  'extra_hours_value',
  'extraordinary_award_value',
  'hour_bank_balance',
  'net_total',
] as const;

export type PayrollValueField = (typeof PAYROLL_VALUE_FIELDS)[number];
export type PayrollValues = Record<PayrollValueField, number>;

/** These may legitimately be negative: the hour bank can be owed, and a net can go below zero. */
const SIGNED_FIELDS: ReadonlySet<PayrollValueField> = new Set(['hour_bank_balance', 'net_total']);

const COMPETENCE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isCompetenceMonth(value: unknown): value is string {
  return typeof value === 'string' && COMPETENCE_PATTERN.test(value);
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Reads the folha amounts from a request body. A field that is missing counts as 0 (the route has always
 * accepted partial bodies), but one that is present must be a finite number, and non-negative unless it is
 * allowed to be signed. Returns the first problem as a message for the admin.
 */
export function parsePayrollValues(body: Record<string, unknown>): { values: PayrollValues } | { error: string } {
  const values = {} as PayrollValues;

  for (const field of PAYROLL_VALUE_FIELDS) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') {
      values[field] = 0;
      continue;
    }

    const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(numeric)) return { error: 'Há um valor inválido na folha. Confira os campos e tente de novo.' };
    if (numeric < 0 && !SIGNED_FIELDS.has(field)) return { error: 'A folha não aceita valores negativos nesse campo.' };
    // Bigger than the narrowest column (hour_bank_balance, NUMERIC(10,2)) would fail in the database with a generic error.
    if (Math.abs(numeric) >= 1e8) return { error: 'Um dos valores da folha é grande demais.' };

    values[field] = roundCurrency(numeric);
  }

  return { values };
}
