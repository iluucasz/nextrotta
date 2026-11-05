/**
 * How long the data of a locked (suspended or canceled) company is kept before it is meant to be permanently deleted
 * (LGPD: no customer data kept without a contract, beyond what the law requires). One place for the number, so the lock page,
 * the legal texts and the job that does the deletion never disagree. No dependencies: used by screens and by the worker.
 */
export const LOCKED_DATA_RETENTION_MONTHS = 3;

/**
 * The last day to reactivate (or pay) before the data is deleted: the lock date plus the months, clamped to the end of the
 * month (31 Nov + 3 months is 28 Feb, not 3 Mar), counted by the calendar day in Brasília.
 */
export function dataDeletionDate(lockedAt: string | Date, months = LOCKED_DATA_RETENTION_MONTHS): Date | null {
  const start = new Date(lockedAt);
  if (Number.isNaN(start.getTime())) return null;
  // The calendar day in Brasília (UTC-3, no daylight saving since 2019).
  const local = new Date(start.getTime() - 3 * 3_600_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(local.getUTCDate(), lastDay);
  // Noon UTC keeps the same calendar day in Brasília whichever way it is formatted.
  return new Date(Date.UTC(year, month, day, 12));
}
