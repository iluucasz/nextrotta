// After a failed Porto import (today or yesterday) the company fixes the cause — usually the password — and the import
// of that day must be done again. This works out, from the plain history, whether there is something to recover and in
// which state: the robot is already on it, it should start on its own (the login was fixed and nothing ran since), or
// it did not work and a person has to retry or open a ticket. Pure (no database, no React): the screen only draws it.
import { describePortoError, needsSupport } from './porto-login-errors';

export type RecoveryLog = {
  job_type: 'hours' | 'schedule';
  started_at: string;
  status: string;
  error_message: string | null;
  range_start?: string | null;
  range_end?: string | null;
};

export type RecoveryJob = {
  job: 'hours' | 'schedule';
  /** The days to import again (hours only; the escala is imported as a whole). */
  start: string | null;
  end: string | null;
  /** When the newest failure of this job started. */
  failedAt: string;
};

export type PortoRecovery =
  | { state: 'none' }
  /** A run is already going: the one that recovers, or a manual one. */
  | { state: 'running'; jobs: RecoveryJob[] }
  /** The login works again and nothing ran since: start on our own. */
  | { state: 'auto'; jobs: RecoveryJob[] }
  /** Needs a person: the retry did not work, or the failure is not one a fixed password solves. */
  | { state: 'failed'; jobs: RecoveryJob[]; message: string; support: boolean; retried: boolean };

const TZ = 'America/Sao_Paulo';
const JOB_ORDER = ['hours', 'schedule'] as const;
/** A run still "running" after this long is stuck, not working. */
const STUCK_AFTER_MS = 2 * 60 * 60_000;

export const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const addDay = (day: string, amount: number) => new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);

export function findPortoRecovery(input: {
  logs: RecoveryLog[];
  now: Date;
  /** Only an import that writes for real has something to recover. */
  live: boolean;
  /** The login test failed: the login problem comes first, nothing to retry yet. */
  loginFailed: boolean;
  /** When the last login test worked (null = never, or it failed). */
  loginOkAt: string | null;
}): PortoRecovery {
  const { logs, now } = input;
  if (!input.live || input.loginFailed) return { state: 'none' };

  const since = addDay(dayOf(now.toISOString()), -1); // yesterday: the day before the failure may still matter
  const real = logs.filter((log) => log.status !== 'skipped' && log.status !== 'dry_run').sort((a, b) => b.started_at.localeCompare(a.started_at));

  const jobs: RecoveryJob[] = [];
  let running = false;
  const attempted = new Map<string, boolean>();

  for (const job of JOB_ORDER) {
    const own = real.filter((log) => log.job_type === job);
    if (own.some((log) => log.status === 'running' && now.getTime() - Date.parse(log.started_at) < STUCK_AFTER_MS)) running = true;

    const lastSuccess = own.find((log) => log.status === 'success' || log.status === 'partial')?.started_at ?? '';
    const failures = own.filter((log) => log.status === 'error' && dayOf(log.started_at) >= since && log.started_at > lastSuccess);
    if (!failures.length) continue;

    const days = failures.flatMap((log) => [log.range_start ?? dayOf(log.started_at), log.range_end ?? log.range_start ?? dayOf(log.started_at)]).sort();
    jobs.push({ job, start: job === 'hours' ? days[0] : null, end: job === 'hours' ? days[days.length - 1] : null, failedAt: failures[0].started_at });
    // "Tried again" only counts after the fix: a login test that worked after the failure, and a run that came later.
    const fixed = input.loginOkAt !== null && failures.some((log) => log.started_at < input.loginOkAt!) ? input.loginOkAt : null;
    attempted.set(job, fixed !== null && own.some((log) => log.started_at > fixed));
  }

  if (running) return { state: 'running', jobs };
  if (!jobs.length) return { state: 'none' };

  const fixedAt = input.loginOkAt;
  const auto = fixedAt !== null && jobs.every((job) => fixedAt > job.failedAt && !attempted.get(job.job));
  if (auto) return { state: 'auto', jobs };

  const newest = real.find((log) => log.status === 'error' && jobs.some((job) => job.job === log.job_type));
  const message = describePortoError(newest?.error_message).message;
  const retried = [...attempted.values()].some(Boolean);
  return { state: 'failed', jobs, message, support: needsSupport(message) || retried, retried };
}

/** "as horas de 04/11", "as horas de 03/11 a 04/11" or "a escala": what the screen says is being redone. */
export function recoveryJobLabel(job: RecoveryJob): string {
  if (job.job === 'schedule') return 'a escala';
  const short = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  if (!job.start) return 'as horas';
  return job.start === job.end || !job.end ? `as horas de ${short(job.start)}` : `as horas de ${short(job.start)} a ${short(job.end)}`;
}
