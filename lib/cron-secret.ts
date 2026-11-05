import { timingSafeEqual } from 'node:crypto';

/**
 * Whether a scheduled call (Vercel Cron) is ours: it sends `Authorization: Bearer <CRON_SECRET>`. Without a CRON_SECRET
 * configured nothing is authorized, so a missing variable closes the route instead of opening it.
 */
export function isCronAuthorized(authorization: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
