/**
 * What a technician is allowed to see on their own screens. Configured by an admin from the
 * preview banner, either for every technician at once or as an override for a single one.
 *
 * Dependency-free on purpose: the API route, the pages and the admin modal all share these types
 * and the normalizer, and the pages are client components.
 */

export type MonthScopeMode = 'all' | 'current' | 'fixed';

export interface MonthScope {
  /** `all`: every month with data. `current`: only today's month. `fixed`: only `month`. */
  mode: MonthScopeMode;
  /** YYYY-MM, used only when `mode` is `fixed`. */
  month: string | null;
}

export interface TechnicianVisibility {
  dashboard: {
    month: MonthScope;
    servicesByType: boolean;
    servicesPerformed: boolean;
  };
  hours: {
    visible: boolean;
    month: MonthScope;
    hoursLog: boolean;
  };
  schedule: {
    visible: boolean;
    month: MonthScope;
  };
  payroll: {
    visible: boolean;
    month: MonthScope;
  };
  library: {
    visible: boolean;
  };
}

/** Pages that can be hidden from the technician's menu. `/dashboard` itself always stays. */
export type HideableTechnicianPage = 'hours' | 'schedule' | 'payroll' | 'library';

export const TECHNICIAN_PAGE_PATHS: Record<HideableTechnicianPage, string> = {
  hours: '/dashboard/hours',
  schedule: '/dashboard/schedule',
  payroll: '/dashboard/payroll',
  library: '/dashboard/library',
};

export type VisibilitySource = 'technician' | 'global' | 'default';

const ALL_MONTHS: MonthScope = { mode: 'all', month: null };

export function createDefaultVisibility(): TechnicianVisibility {
  return {
    dashboard: { month: { ...ALL_MONTHS }, servicesByType: true, servicesPerformed: true },
    hours: { visible: true, month: { ...ALL_MONTHS }, hoursLog: true },
    schedule: { visible: true, month: { ...ALL_MONTHS } },
    payroll: { visible: true, month: { ...ALL_MONTHS } },
    library: { visible: true },
  };
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(source: Record<string, unknown>, key: string, fallback: boolean) {
  return typeof source[key] === 'boolean' ? (source[key] as boolean) : fallback;
}

function readMonthScope(value: unknown): MonthScope {
  if (!isRecord(value)) return { ...ALL_MONTHS };

  const month = typeof value.month === 'string' && MONTH_PATTERN.test(value.month) ? value.month : null;

  if (value.mode === 'current') return { mode: 'current', month: null };
  // A fixed scope without a valid month would leave the technician with nothing to pick, so it
  // degrades to "all" rather than to an empty screen.
  if (value.mode === 'fixed' && month) return { mode: 'fixed', month };

  return { ...ALL_MONTHS };
}

/**
 * Coerces anything (a DB row written by an older version, a request body) into a complete,
 * valid settings object. Missing or malformed fields fall back to "visible".
 */
export function normalizeVisibility(value: unknown): TechnicianVisibility {
  const defaults = createDefaultVisibility();
  if (!isRecord(value)) return defaults;

  const section = (key: keyof TechnicianVisibility) => (isRecord(value[key]) ? (value[key] as Record<string, unknown>) : {});
  const dashboard = section('dashboard');
  const hours = section('hours');
  const schedule = section('schedule');
  const payroll = section('payroll');
  const library = section('library');

  return {
    dashboard: {
      month: readMonthScope(dashboard.month),
      servicesByType: readBoolean(dashboard, 'servicesByType', defaults.dashboard.servicesByType),
      servicesPerformed: readBoolean(dashboard, 'servicesPerformed', defaults.dashboard.servicesPerformed),
    },
    hours: {
      visible: readBoolean(hours, 'visible', defaults.hours.visible),
      month: readMonthScope(hours.month),
      hoursLog: readBoolean(hours, 'hoursLog', defaults.hours.hoursLog),
    },
    schedule: {
      visible: readBoolean(schedule, 'visible', defaults.schedule.visible),
      month: readMonthScope(schedule.month),
    },
    payroll: {
      visible: readBoolean(payroll, 'visible', defaults.payroll.visible),
      month: readMonthScope(payroll.month),
    },
    library: {
      visible: readBoolean(library, 'visible', defaults.library.visible),
    },
  };
}

/** Today's month as YYYY-MM in the viewer's local time (not UTC, which flips a day early in BRT). */
export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** The single month a scope pins the technician to, or `null` when every month is allowed. */
export function resolveAllowedMonth(scope: MonthScope, now = new Date()): string | null {
  if (scope.mode === 'current') return currentMonthKey(now);
  if (scope.mode === 'fixed' && scope.month) return scope.month;
  return null;
}

function formatMonthKey(month: string) {
  const [year, monthNumber] = month.split('-');
  return `${monthNumber}/${year}`;
}

export function describeMonthScope(scope: MonthScope) {
  if (scope.mode === 'current') return 'Somente o mês atual';
  if (scope.mode === 'fixed' && scope.month) return `Somente ${formatMonthKey(scope.month)}`;
  return 'Todas as datas';
}

function sameMonthScope(left: MonthScope, right: MonthScope) {
  return left.mode === right.mode && (left.mode !== 'fixed' || left.month === right.month);
}

export interface VisibilityDifference {
  /** e.g. "Minha visão · Datas no filtro" */
  label: string;
  /** Human-readable value in the first settings object passed to `diffVisibility`. */
  left: string;
  /** Human-readable value in the second one. */
  right: string;
}

type Field =
  | { kind: 'month'; label: string; read: (value: TechnicianVisibility) => MonthScope }
  | { kind: 'toggle'; label: string; read: (value: TechnicianVisibility) => boolean };

// Listed in the same order as the admin modal, so the differences read top to bottom like the form.
const COMPARED_FIELDS: Field[] = [
  { kind: 'month', label: 'Minha visão · Datas no filtro', read: (v) => v.dashboard.month },
  { kind: 'toggle', label: 'Minha visão · Serviços por tipo', read: (v) => v.dashboard.servicesByType },
  { kind: 'toggle', label: 'Minha visão · Serviços realizados', read: (v) => v.dashboard.servicesPerformed },
  { kind: 'toggle', label: 'Banco de horas · Página', read: (v) => v.hours.visible },
  { kind: 'month', label: 'Banco de horas · Meses', read: (v) => v.hours.month },
  { kind: 'toggle', label: 'Banco de horas · Registro de horas', read: (v) => v.hours.hoursLog },
  { kind: 'toggle', label: 'Agenda · Página', read: (v) => v.schedule.visible },
  { kind: 'month', label: 'Agenda · Meses', read: (v) => v.schedule.month },
  { kind: 'toggle', label: 'Pagamento · Página', read: (v) => v.payroll.visible },
  { kind: 'month', label: 'Pagamento · Meses', read: (v) => v.payroll.month },
  { kind: 'toggle', label: 'Biblioteca · Página', read: (v) => v.library.visible },
];

/** Every setting where `left` and `right` disagree, described for display. Empty when identical. */
export function diffVisibility(left: TechnicianVisibility, right: TechnicianVisibility): VisibilityDifference[] {
  return COMPARED_FIELDS.flatMap((field) => {
    if (field.kind === 'month') {
      const [a, b] = [field.read(left), field.read(right)];
      return sameMonthScope(a, b) ? [] : [{ label: field.label, left: describeMonthScope(a), right: describeMonthScope(b) }];
    }

    const [a, b] = [field.read(left), field.read(right)];
    return a === b ? [] : [{ label: field.label, left: a ? 'Visível' : 'Oculto', right: b ? 'Visível' : 'Oculto' }];
  });
}
