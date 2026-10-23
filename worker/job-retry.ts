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
 * minutes later usually works. Three attempts in total, well inside the 60-minute catch-up window.
 */
export const AUTO_RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000];

/**
 * Failures a retry can't fix, or would make worse: a rejected login is already tried twice inside a
 * run (launchAuthenticatedPortoSession), and repeating a wrong password risks locking the Porto
 * account; missing credentials need a person in Configurações.
 */
const NON_RETRYABLE_ERRORS = [/^Login no Porto falhou/, /^Credenciais não configuradas/];

/** Why a finished run should be tried again, or null when the result is final. */
export function retryReason(result: RetryableResult): string | null {
  if (result.status === 'error') {
    const error = result.error ?? '';
    if (NON_RETRYABLE_ERRORS.some((pattern) => pattern.test(error))) return null;
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
 * database was unreachable for a moment) or its result asks for a retry. The caller's `run`
 * should take the Porto lock itself, so the lock is never held while waiting between attempts.
 * Returns the last result, or rethrows the last error when every attempt threw.
 */
export async function runWithRetries<R extends RetryableResult>(options: {
  run: () => Promise<R>;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: RetryInfo) => void;
}): Promise<{ result: R; attempts: number }> {
  const delays = options.delaysMs ?? AUTO_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = delays.length + 1;

  for (let attempt = 1; ; attempt++) {
    let reason: string | null;
    let result: R | undefined;
    let failure: unknown;
    try {
      result = await options.run();
      reason = retryReason(result);
    } catch (error) {
      failure = error;
      reason = `exceção: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
    }

    if (reason === null || attempt >= maxAttempts) {
      if (result !== undefined) return { result, attempts: attempt };
      throw failure;
    }

    const delayMs = delays[attempt - 1];
    options.onRetry?.({ attempt, maxAttempts, delayMs, reason });
    await sleep(delayMs);
  }
}
