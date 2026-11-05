import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findPortoRecovery, recoveryJobLabel, type PortoRecovery, type RecoveryJob, type RecoveryStep } from '@/lib/porto-recovery';
import { pollJobLog, type PortoJobResult, type PortoSyncLog } from '@/lib/porto-ui-helpers';
import { describePortoError, needsSupport } from '@/lib/porto-login-errors';

export type RecoveryView =
  | { state: 'none' }
  | { state: 'running'; label: string; steps: RecoveryStep[] }
  /** Everything that failed has worked since: stays on screen (until the failure is two days old) saying when. */
  | { state: 'done'; steps: RecoveryStep[] }
  | { state: 'failed'; message: string; support: boolean; retried: boolean; steps: RecoveryStep[] };

/**
 * Redoes the Porto import that failed today or yesterday once the login works again: the robot starts on its own
 * (the log decides, so a reload mid-way still shows it running), and when it fails again the person gets
 * "Tentar novamente" and the way to Suporte. Runs only while the Config. Porto page is open; the run itself
 * keeps going on the worker whatever happens to the page.
 */
export function usePortoRecovery(input: {
  logs: PortoSyncLog[];
  live: boolean;
  loginFailed: boolean;
  loginOkAt: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  notify: (message: string, bad?: boolean) => void;
}) {
  const { logs, live, loginFailed, loginOkAt, loaded, load, notify } = input;
  const [busy, setBusy] = useState<RecoveryJob | null>(null);
  const [localFailure, setLocalFailure] = useState<{ key: string; message: string } | null>(null);
  const started = useRef(new Set<string>());
  const now = useMemo(() => new Date(), [logs]); // eslint-disable-line react-hooks/exhaustive-deps

  const recovery: PortoRecovery = useMemo(() => findPortoRecovery({ logs, now, live, loginFailed, loginOkAt }), [logs, now, live, loginFailed, loginOkAt]);
  const keyOf = (job: RecoveryJob) => `${job.job}:${job.failedAt}`;

  const run = useCallback(
    async (job: RecoveryJob) => {
      setBusy(job);
      setLocalFailure(null);
      try {
        const params = new URLSearchParams({ write: '1' });
        if (job.job === 'hours' && job.start) {
          params.set('start', job.start);
          params.set('end', job.end ?? job.start);
        }
        const response = await fetch(`/api/cron/porto-${job.job}?${params.toString()}`);
        const data = (await response.json().catch(() => null)) as PortoJobResult | null;

        let result: PortoJobResult | null = data;
        if (data?.status === 'started' && data.logId) {
          result = await new Promise<PortoJobResult>((resolve) => void pollJobLog(data.logId!, (done) => resolve(done)));
        }
        if (!result || result.status === 'error') {
          const message = describePortoError(result?.error ?? 'Não foi possível falar com o servidor do robô.').message;
          setLocalFailure({ key: keyOf(job), message });
          notify('Não deu para recuperar a importação.', true);
        } else {
          notify(`Importação recuperada: ${recoveryJobLabel(job)}.`);
        }
      } catch {
        setLocalFailure({ key: keyOf(job), message: 'Não foi possível falar com o servidor do robô. Tente de novo em instantes.' });
        notify('Não deu para recuperar a importação.', true);
      } finally {
        setBusy(null);
        await load();
      }
    },
    [load, notify], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Start on its own, once per failure: what already ran is in the log, what could not even start is remembered here.
  useEffect(() => {
    if (!loaded || busy || recovery.state !== 'auto') return;
    const job = recovery.jobs[0];
    if (started.current.has(keyOf(job))) return;
    started.current.add(keyOf(job));
    void run(job);
  }, [loaded, busy, recovery, run]);

  // A run that is going on (started here before a reload, or by someone else): keep the history fresh until it ends.
  useEffect(() => {
    if (recovery.state !== 'running' || busy) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [recovery.state, busy, load]);

  const todo = recovery.state === 'running' || recovery.state === 'auto' || recovery.state === 'failed' ? recovery.jobs : [];
  const next = todo[0] ?? null;
  const steps = recovery.state === 'none' ? [] : recovery.steps;
  const withStatus = (list: RecoveryStep[], job: string | null, status: RecoveryStep['status']) => list.map((step) => (step.job === job && step.status !== 'done' ? { ...step, status } : step));

  const view: RecoveryView = useMemo(() => {
    if (busy) return { state: 'running', label: recoveryJobLabel(busy), steps: withStatus(steps, busy.job, 'running') };
    if (recovery.state === 'running') return { state: 'running', label: next ? recoveryJobLabel(next) : 'a importação', steps };
    if (recovery.state === 'auto' && next && localFailure?.key === keyOf(next)) {
      return { state: 'failed', message: localFailure.message, support: true, retried: true, steps: withStatus(steps, next.job, 'failed') };
    }
    if (recovery.state === 'auto' && next) return { state: 'running', label: recoveryJobLabel(next), steps: withStatus(steps, next.job, 'running') };
    if (recovery.state === 'failed') {
      return { state: 'failed', message: localFailure?.message ?? recovery.message, support: recovery.support || needsSupport(localFailure?.message), retried: recovery.retried, steps };
    }
    if (recovery.state === 'done') return { state: 'done', steps };
    return { state: 'none' };
  }, [busy, recovery, next, steps, localFailure]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    if (next && !busy) void run(next);
  }, [next, busy, run]);

  /** Jobs still to redo, so the problem list does not repeat their failure. */
  const jobs = todo.map((job) => job.job);

  return { view, retry, jobs };
}
