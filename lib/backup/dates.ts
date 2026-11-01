// Backup days are Brasília days. Brazil has no daylight saving time (since 2019), so Brasília is UTC-3 all year.
// Dependency-free.

const BRASILIA_OFFSET_HOURS = 3;

/** "YYYY-MM-DD" of the Brasília day that `date` falls in. */
export function brasiliaDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

/** The next 00:00 in Brasília that is after `now`. */
export function nextBackupTime(now: Date): Date {
  const [year, month, day] = brasiliaDay(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, BRASILIA_OFFSET_HOURS, 0, 0));
}

/** When the backups of `day` ("YYYY-MM-DD") start: 00:00 in Brasília. */
export function backupTimeOf(day: string): Date {
  const [year, month, dayOfMonth] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth, BRASILIA_OFFSET_HOURS, 0, 0));
}
