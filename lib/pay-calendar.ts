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
  /** The day the month closes (0 = its last day): competence M covers the day after it in M-1 up to it in M. */
  monthClosingDay: number;
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

// ---------------------------------------------------------------------------------------------------------------------
// The closing day. 0 = the month closes on its last day (the competence is the calendar month, what every company had).
// A closing day N from 1 to 27 moves the cut: competence "2026-11" with N = 25 covers 26/10 to 25/11, named by the month in
// which it closes. Everything that is "the month" of a payment (OS, hours, days worked) follows this one rule.

export const MAX_CLOSING_DAY = 27;

/** A closing day as the settings allow it (a whole number from 0 to 27), or null. */
export function normalizeClosingDay(value: unknown): number | null {
  const day = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(day) && day >= 0 && day <= MAX_CLOSING_DAY ? day : null;
}

/** "YYYY-MM-DD" → the competence "YYYY-MM" it falls in, or '' when it is not a real date. */
export function competenceForDate(dateKey: string, closingDay = 0): string {
  if (!isDateKey(dateKey)) return '';
  const month = dateKey.slice(0, 7);
  return closingDay > 0 && Number(dateKey.slice(8, 10)) > closingDay ? shiftMonth(month, 1) : month;
}

/** The first and last day ("YYYY-MM-DD") of a competence. Without a closing day: the whole calendar month. */
export function competenceRange(monthKey: string, closingDay = 0): { from: string; to: string } {
  if (!isMonthKey(monthKey)) return { from: '', to: '' };
  if (closingDay > 0) {
    const day = String(closingDay).padStart(2, '0');
    return { from: `${shiftMonth(monthKey, -1)}-${String(closingDay + 1).padStart(2, '0')}`, to: `${monthKey}-${day}` };
  }
  const [year, month] = monthKey.split('-').map(Number);
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}` };
}

/** How many days have passed since the last closing, counting the date itself (1 = the first day of the competence). */
export function cycleDay(dateKey: string, closingDay = 0): number {
  if (!isDateKey(dateKey)) return 0;
  const day = Number(dateKey.slice(8, 10));
  if (closingDay <= 0 || day > closingDay) return closingDay <= 0 ? day : day - closingDay;
  const previous = shiftMonth(dateKey.slice(0, 7), -1);
  const [year, month] = previous.split('-').map(Number);
  return day + new Date(Date.UTC(year, month, 0)).getUTCDate() - closingDay;
}

/** The month a row of an import goes to: its own date, or the one chosen for the whole batch. */
export function competenceForImportRow(source: CompetenceSource, dateKey: string, batchMonth: string, closingDay = 0): string {
  return source === 'service_date' ? competenceForDate(dateKey, closingDay) : batchMonth;
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
export function defaultCompetenceMonth(todayDateKey: string, settlePreviousMonthUntilDay: number, closingDay = 0): string {
  const current = competenceForDate(todayDateKey, closingDay);
  if (!current) return '';
  // The settle days count from the last closing: up to N days after it, the competence that just closed is still open.
  return settlePreviousMonthUntilDay > 0 && cycleDay(todayDateKey, closingDay) <= settlePreviousMonthUntilDay ? shiftMonth(current, -1) : current;
}

export interface MonthCount {
  month: string;
  count: number;
}

/** How many dates fall in each month, oldest month first. Dates that are not real days are left out. */
export function countByCompetence(dateKeys: string[], closingDay = 0): MonthCount[] {
  const counts = new Map<string, number>();
  for (const dateKey of dateKeys) {
    const month = competenceForDate(dateKey, closingDay);
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

/** The same, from a "YYYY-MM-DD" date ('' → null). With a closing day the cut days count from the start of the competence. */
export function periodForDate(dateKey: string, cutDays: number[], closingDay = 0): PeriodKey | null {
  return isDateKey(dateKey) ? periodForDay(cycleDay(dateKey, closingDay), cutDays) : null;
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
