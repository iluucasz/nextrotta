/**
 * Calendar helpers pinned to Brasília time. The notification jobs run on the VPS worker (UTC) and
 * on Vercel (UTC), but "today", "tomorrow" and "09:00" always mean Brasília for the technicians.
 */

const TIME_ZONE = 'America/Sao_Paulo';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface BrasiliaNow {
  /** YYYY-MM-DD */
  dateKey: string;
  /** YYYY-MM */
  monthKey: string;
  /** Day of month, 1-31. */
  day: number;
  /** Minutes since midnight. */
  minutes: number;
}

export function brasiliaNow(now = new Date()): BrasiliaNow {
  const parts = partsFormatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;

  return {
    dateKey,
    monthKey: dateKey.slice(0, 7),
    day: Number(get('day')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Parses "HH:MM" into minutes since midnight, or null when malformed. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

// Noon UTC keeps the calendar date stable no matter which timezone later formats it.
function keyToDate(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

export function addDaysToKey(dateKey: string, days: number) {
  const date = keyToDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 2026-09-19 → 19/09/2026 */
export function formatDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
}

/** 2026-09-19 → 19/09 */
export function formatShortDateKey(dateKey: string) {
  const [, month, day] = dateKey.split('-');
  return `${day}/${month}`;
}

/** 2026-09-19 → sábado */
export function weekdayLabel(dateKey: string) {
  return keyToDate(dateKey).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' });
}

/** 2026-09-19 → sáb */
export function weekdayShortLabel(dateKey: string) {
  return keyToDate(dateKey).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
}

/** 2026-09 → setembro de 2026 */
export function monthLabel(monthKey: string) {
  return keyToDate(`${monthKey}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** 8.5 → 8h30 */
export function formatHoursValue(value: number) {
  const totalMinutes = Math.round(Math.abs(value) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const sign = value < 0 ? '-' : '';

  return minutes ? `${sign}${hours}h${String(minutes).padStart(2, '0')}` : `${sign}${hours}h`;
}
