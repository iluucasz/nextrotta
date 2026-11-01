import { createHash } from 'node:crypto';
import { sql } from '../db';

// Brute-force protection for the login (and anything else that can be guessed). A counter per key; too many failures
// inside the window locks the key for a while. Nothing here reveals whether an e-mail exists: the keys are made from
// what was typed, not from what is in the database.

export type ThrottleRule = { key: string; limit: number; windowSeconds: number; lockSeconds: number };

/** The client address as the platform proxy reports it (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip') || 'unknown';
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/** The three counters of a login attempt: this e-mail from this address, this address, and this e-mail from anywhere. */
export function loginRules(email: string, ip: string): ThrottleRule[] {
  const address = email.trim().toLowerCase();
  return [
    { key: `login:pair:${digest(`${address}|${ip}`)}`, limit: 5, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
    { key: `login:ip:${digest(ip)}`, limit: 40, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
    { key: `login:email:${digest(address)}`, limit: 20, windowSeconds: 15 * 60, lockSeconds: 15 * 60 },
  ];
}

/** Seconds until the first rule that is locked lets go; 0 when nothing is locked. */
export async function lockedSeconds(rules: ThrottleRule[]): Promise<number> {
  const rows = await sql`
    SELECT GREATEST(CEIL(EXTRACT(EPOCH FROM (MAX(locked_until) - NOW()))), 0)::int AS seconds
    FROM auth_throttle
    WHERE key = ANY(${rules.map((rule) => rule.key)}) AND locked_until > NOW()
  `;
  return Number(rows[0]?.seconds ?? 0);
}

/** Counts one failure on every rule; a rule that reaches its limit inside its window is locked. */
export async function recordFailure(rules: ThrottleRule[]): Promise<void> {
  for (const rule of rules) {
    await sql`
      INSERT INTO auth_throttle (key, failures, window_started_at)
      VALUES (${rule.key}, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        failures = CASE WHEN auth_throttle.window_started_at < NOW() - make_interval(secs => ${rule.windowSeconds}) THEN 1 ELSE auth_throttle.failures + 1 END,
        window_started_at = CASE WHEN auth_throttle.window_started_at < NOW() - make_interval(secs => ${rule.windowSeconds}) THEN NOW() ELSE auth_throttle.window_started_at END,
        locked_until = CASE
          WHEN (CASE WHEN auth_throttle.window_started_at < NOW() - make_interval(secs => ${rule.windowSeconds}) THEN 1 ELSE auth_throttle.failures + 1 END) >= ${rule.limit}
            THEN NOW() + make_interval(secs => ${rule.lockSeconds})
          ELSE auth_throttle.locked_until
        END
    `;
  }
}

/** A successful login clears the counters of that e-mail from that address (the address-wide one keeps counting). */
export async function clearFailures(rules: ThrottleRule[]): Promise<void> {
  const keys = rules.filter((rule) => rule.key.startsWith('login:pair:') || rule.key.startsWith('login:email:')).map((rule) => rule.key);
  if (!keys.length) return;
  await sql`UPDATE auth_throttle SET failures = 0, locked_until = NULL WHERE key = ANY(${keys})`;
}

export function waitMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Muitas tentativas. Tente de novo em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
}
