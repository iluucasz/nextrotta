import { isCredentialsRejection, isPortoLoginRejection } from '../lib/porto-login-errors';

/** What an unattended run must report for the retry decision (HoursJobResult / ScheduleJobResult). */
export type RetryableResult = {
  status: string;
  error?: string;
  layout_suspect?: boolean;
  summary?: Record<string, number>;
};

/**
 * Waits between attempts of the same unattended run: the Porto portal is slow or unreachable in
 * short bursts (a 2-minute login timeout was seen live on 2026-10-13), so a second try a few
 * minutes later usually works. Three attempts in total.
 */
export const AUTO_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000];

/**
 * Waits before trying again after the portal said "wrong CPF or password" to a login that had
 * worked recently (see `loginRejectionLooksTransient`). Longer than the others on purpose: it is
 * only worth repeating once the portal had time to recover, and a wrong password must not be
 * hammered (the account can lock). Four attempts in total.
 */
export const LOGIN_REJECTION_RETRY_DELAYS_MS = [15 * 60_000, 20 * 60_000, 30 * 60_000];

/** How long a working login keeps counting as proof that the saved password is right. */
const LOGIN_PROOF_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Whether a "wrong CPF or password" answer is probably the portal's fault: the same saved credentials
 * got into the portal within the last 48 hours (a run or a login test), so the password was fine
 * shortly before. Saving the configuration again (new password, or any change) invalidates that proof,
 * because the proof then predates the saved credentials.
 */
export function loginRejectionLooksTransient(input: {
  /** Latest login known to have worked (finished run that logged in, or successful login test). */
  lastWorkingLoginAt: Date | string | null;
  /** When the Porto configuration was last saved. */
  credentialsSavedAt: Date | string | null;
  now?: number;
}): boolean {
  const worked = input.lastWorkingLoginAt ? new Date(input.lastWorkingLoginAt).getTime() : NaN;
  if (!Number.isFinite(worked)) return false;
  const now = input.now ?? Date.now();
  if (now - worked > LOGIN_PROOF_MAX_AGE_MS) return false;
  const saved = input.credentialsSavedAt ? new Date(input.credentialsSavedAt).getTime() : NaN;
  return !Number.isFinite(saved) || worked >= saved;
}

/**
 * Failures a retry can't fix, or would make worse: missing credentials need a person in Configurações,
 * and a rejected login is only repeated when it looks like a hiccup (`retryLoginRejection`). Every other
 * login problem (expired password, block, no QRA) stays final: it is already tried twice inside a run
 * (launchAuthenticatedPortoSession) and repeating it risks locking the Porto account.
 */
const NON_RETRYABLE_ERRORS = [/^Credenciais não configuradas/];

export type RetryOptions = {
  /** The portal's "wrong CPF or password" may be tried again later (the credentials worked recently). */
  retryLoginRejection?: boolean;
};

function isRetryableLoginRejection(result: RetryableResult, options: RetryOptions) {
  return Boolean(options.retryLoginRejection) && result.status === 'error' && isCredentialsRejection(result.error);
}

/** Why a finished run should be tried again, or null when the result is final. */
export function retryReason(result: RetryableResult, options: RetryOptions = {}): string | null {
  if (result.status === 'error') {
    const error = result.error ?? '';
    if (isRetryableLoginRejection(result, options)) return 'o Porto recusou o login, mas a senha funcionou recentemente';
    if (isPortoLoginRejection(error) || NON_RETRYABLE_ERRORS.some((pattern) => pattern.test(error))) return null;
    return error ? `erro: ${error}` : 'erro sem detalhe';
  }
  // Only real runs: manual tests and paused automation have nothing to retry.
  if (result.status !== 'success' && result.status !== 'partial') return null;
  // Possibly just a portal that answered badly this time; a second look tells it from a real change.
  if (result.layout_suspect) return 'o portal parece ter mudado de layout';
  const failedPages = result.summary?.service_detail_failed ?? 0;
  if (failedPages > 0) return `${failedPages} serviço(s) não puderam ser abertos`;
  return null;
}

export type RetryInfo = { attempt: number; maxAttempts: number; delayMs: number; reason: string };

/**
 * Runs `run` and tries it again — after each delay in `delaysMs` — when it throws (e.g. the
 * database was unreachable for a moment) or its result asks for a retry. A rejected login that
 * looks like a portal hiccup (`retryLoginRejection`) follows its own, longer delays and its own
 * limit. The caller's `run` should take the Porto lock itself, so the lock is never held while
 * waiting between attempts. Returns the last result, or rethrows the last error when every
 * attempt threw.
 */
export async function runWithRetries<R extends RetryableResult>(options: {
  run: () => Promise<R>;
  delaysMs?: number[];
  loginRejectionDelaysMs?: number[];
  retryLoginRejection?: boolean;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: RetryInfo) => void;
}): Promise<{ result: R; attempts: number }> {
  const delays = options.delaysMs ?? AUTO_RETRY_DELAYS_MS;
  const loginDelays = options.loginRejectionDelaysMs ?? LOGIN_REJECTION_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = delays.length + 1;
  const retryOptions: RetryOptions = { retryLoginRejection: options.retryLoginRejection };
  let loginRetries = 0;

  for (let attempt = 1; ; attempt++) {
    let reason: string | null;
    let result: R | undefined;
    let failure: unknown;
    try {
      result = await options.run();
      reason = retryReason(result, retryOptions);
    } catch (error) {
      failure = error;
      reason = `exceção: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
    }

    const loginRejected = result !== undefined && isRetryableLoginRejection(result, retryOptions);
    const exhausted = loginRejected ? loginRetries >= loginDelays.length : attempt >= maxAttempts;

    if (reason === null || exhausted) {
      if (result !== undefined) return { result, attempts: attempt };
      throw failure;
    }

    const delayMs = loginRejected ? loginDelays[loginRetries++] : delays[attempt - 1];
    options.onRetry?.({ attempt, maxAttempts: loginRejected ? loginDelays.length + 1 : maxAttempts, delayMs, reason });
    await sleep(delayMs);
  }
}
