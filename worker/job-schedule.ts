import { timeToMinutes } from '../lib/whatsapp/dates';

/** A missed time (worker restarting, VPS down) is still run up to this long after it. */
export const JOB_CATCH_UP_MINUTES = 60;

/**
 * Whether a daily job configured for `scheduledTime` ("HH:MM", Brasília) should start now: at or
 * after that time, within the catch-up window, and not already run today.
 */
export function isJobDue(input: { scheduledTime: string; nowMinutes: number; today: string; lastRunDay: string | null }): boolean {
  const scheduledAt = timeToMinutes(input.scheduledTime);
  if (scheduledAt === null || input.lastRunDay === input.today) return false;
  const late = input.nowMinutes - scheduledAt;
  return late >= 0 && late < JOB_CATCH_UP_MINUTES;
}
