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

// ---------------------------------------------------------------------------------------------------------------------
// Payment periods inside a month. A company cuts its month at the days it lists: [] = one payment a month, [15] = two
// fortnights, [10, 20] = three periods. A service stores the period it fell in as "Q1".."Q5" (null when the month is not cut).

/** At most this many cut days in a month (so at most MAX_PERIOD_CUTS + 1 periods). */
export const MAX_PERIOD_CUTS = 4;

export type PeriodKey = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5';

const PERIOD_KEYS: readonly PeriodKey[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'];

export function isPeriodKey(value: unknown): value is PeriodKey {
  return typeof value === 'string' && (PERIOD_KEYS as readonly string[]).includes(value);
}

/** The cut days as the settings allow them: whole days 1 to 27, strictly increasing, at most MAX_PERIOD_CUTS. Null when they are not. */
export function normalizeCutDays(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_PERIOD_CUTS) return null;
  const days = value.map((item) => (typeof item === 'number' ? item : Number(item)));
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 27)) return null;
  return days.every((day, index) => index === 0 || day > days[index - 1]) ? days : null;
}

/** Whether a company that cuts at these days has periods inside the month (false = it pays by the month). */
export const hasPeriods = (cutDays: number[]): boolean => cutDays.length > 0;

/** The periods a month has: [] when it is not cut, ["Q1", "Q2"] with one cut day, and so on. */
export function periodKeys(cutDays: number[]): PeriodKey[] {
  return cutDays.length ? PERIOD_KEYS.slice(0, cutDays.length + 1) : [];
}

/** The period a day of the month falls in, or null when the month is not cut. */
export function periodForDay(dayOfMonth: number, cutDays: number[]): PeriodKey | null {
  if (!cutDays.length) return null;
  const index = cutDays.filter((cut) => dayOfMonth > cut).length;
  return PERIOD_KEYS[Math.min(index, PERIOD_KEYS.length - 1)];
}

/** The same, from a "YYYY-MM-DD" date ('' → null). */
export function periodForDate(dateKey: string, cutDays: number[]): PeriodKey | null {
  return isDateKey(dateKey) ? periodForDay(Number(dateKey.slice(8, 10)), cutDays) : null;
}

/** What the screens call a period: "Q1" / "Q2" for the usual two fortnights, "Período 3" when there are more. */
export function periodLabel(key: PeriodKey, cutDays: number[]): string {
  return cutDays.length === 1 ? key : `Período ${key.slice(1)}`;
}

/** The days a period covers: "dias 1 a 15", "dia 16 em diante". */
export function periodDays(key: PeriodKey, cutDays: number[]): string {
  const index = PERIOD_KEYS.indexOf(key);
  const from = index === 0 ? 1 : cutDays[index - 1] + 1;
  return index >= cutDays.length ? `dia ${from} em diante` : `dias ${from} a ${cutDays[index]}`;
}

/** A longer name for a period: "Primeira quinzena" for the usual two, the days otherwise. */
export function periodDescription(key: PeriodKey, cutDays: number[]): string {
  if (cutDays.length === 1) return key === 'Q1' ? 'Primeira quinzena' : 'Segunda quinzena';
  return periodDays(key, cutDays).replace(/^./, (letter) => letter.toUpperCase());
}

/** Reads "10, 20" (comma, semicolon or space) into cut days, or null when it is not a valid list. */
export function parseCutDays(text: string): number[] | null {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  return normalizeCutDays(parts.map(Number));
}
