// The pay calendar: which month a service belongs to and which month the admin screens open on.
// Dependency-free on purpose (read by the import API, the screens and the tests). Relative imports only.
//
// Every rule here is configured per organization (Configurações → Pagamento) and the defaults keep the
// behavior every organization had before: the month is chosen for the whole batch, and the screens open
// on the current month.

/** Who decides the month (competência) of an imported service. */
export type CompetenceSource = 'batch' | 'service_date';

export const COMPETENCE_SOURCES: readonly CompetenceSource[] = ['batch', 'service_date'];

export interface PayCalendarSettings {
  competenceSource: CompetenceSource;
  /** Until this day of a month the screens still open on the previous month (0 = never). */
  settlePreviousMonthUntilDay: number;
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;

export function isDateKey(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isMonthKey(value: string): boolean {
  const match = MONTH_KEY.exec(value);
  return Boolean(match) && Number(match![2]) >= 1 && Number(match![2]) <= 12;
}

/** "YYYY-MM-DD" → "YYYY-MM", or '' when it is not a real date. */
export function competenceForDate(dateKey: string): string {
  return isDateKey(dateKey) ? dateKey.slice(0, 7) : '';
}

/** The month a row of an import goes to: its own date, or the one chosen for the whole batch. */
export function competenceForImportRow(source: CompetenceSource, dateKey: string, batchMonth: string): string {
  return source === 'service_date' ? competenceForDate(dateKey) : batchMonth;
}

/** "YYYY-MM" shifted by a number of months (negative = back). Pure arithmetic, no time zones. */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * The month the admin screens open on. Companies that settle the month after it ends (the pay for
 * October is closed up to the 5th of November) set a settle day: until then, the previous month.
 */
export function defaultCompetenceMonth(todayDateKey: string, settlePreviousMonthUntilDay: number): string {
  const current = competenceForDate(todayDateKey);
  if (!current) return '';
  const day = Number(todayDateKey.slice(8, 10));
  return settlePreviousMonthUntilDay > 0 && day <= settlePreviousMonthUntilDay ? shiftMonth(current, -1) : current;
}

export interface MonthCount {
  month: string;
  count: number;
}

/** How many dates fall in each month, oldest month first. Dates that are not real days are left out. */
export function countByCompetence(dateKeys: string[]): MonthCount[] {
  const counts = new Map<string, number>();
  for (const dateKey of dateKeys) {
    const month = competenceForDate(dateKey);
    if (month) counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
}

/** "2026-10" → "10/2026". */
export function monthLabel(monthKey: string): string {
  const match = MONTH_KEY.exec(monthKey);
  return match ? `${match[2]}/${match[1]}` : monthKey;
}
