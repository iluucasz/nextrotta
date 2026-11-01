'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock3, FlaskConical, Loader2, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
import { ChartEmpty, Panel } from '@/components/management-ui';
import type { PortoStatus, RunKind, RunSummary } from '@/lib/porto-status';
import type { PortoSyncLog } from '@/lib/porto-ui-helpers';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<RunKind, LucideIcon> = { ok: CheckCircle2, warning: TriangleAlert, error: XCircle, test: FlaskConical, running: Loader2, skipped: Clock3 };

/** One card per job: how the last run went and when the next one is. */
function JobCard({ title, last, next }: { title: string; last: RunSummary | null; next: string | null }) {
  const Icon = last ? KIND_ICON[last.kind] : Clock3;
  return (
    <article className={cn('po-job', last?.kind)}>
      <header>
        <span className="po-job-icon" aria-hidden="true">
          <Icon size={18} className={last?.kind === 'running' ? 'animate-spin' : ''} />
        </span>
        <strong>{title}</strong>
      </header>
      {last ? (
        <>
          <p className="po-job-main">{last.label}</p>
          <p className="po-job-sub">
            {last.when}
            {last.summary && last.kind !== 'error' ? ` · ${last.summary}` : ''}
          </p>
        </>
      ) : (
        <>
          <p className="po-job-main">Ainda não rodou</p>
          <p className="po-job-sub">O resultado aparece aqui depois da primeira importação.</p>
        </>
      )}
      {next ? <p className="po-job-next">Próxima: {next}</p> : null}
    </article>
  );
}

/**
 * What the robot has been doing: the two jobs at a glance, then the latest runs in plain words. A run opens in a
 * window with what it found; "Só com problema" cuts the list down to what may need a look.
 */
export function Activity({ status, logs, running, onOpen }: { status: PortoStatus; logs: PortoSyncLog[]; running: boolean; onOpen: (log: PortoSyncLog) => void }) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const rows = useMemo(() => status.recent.map((run, index) => ({ run, log: logs[index] })).filter(({ run }) => !onlyProblems || run.problem), [logs, onlyProblems, status.recent]);
  const problems = status.recent.filter((run) => run.problem).length;

  return (
    <Panel
      title="Atividade"
      description="O que o robô fez nas últimas vezes."
      badge={
        problems ? (
          <button type="button" className={cn('po-filter', onlyProblems && 'on')} aria-pressed={onlyProblems} onClick={() => setOnlyProblems((value) => !value)}>
            {onlyProblems ? 'Mostrar tudo' : `Só com problema (${problems})`}
          </button>
        ) : undefined
      }
    >
      <div className="po-jobs">
        <JobCard title="Horas trabalhadas" last={status.lastRun.hours} next={status.nextRun.hours} />
        <JobCard title="Escala" last={status.lastRun.schedule} next={status.nextRun.schedule} />
      </div>

      {rows.length ? (
        <ul className="po-runs">
          {rows.map(({ run, log }) => {
            const Icon = KIND_ICON[run.kind];
            return (
              <li key={run.id}>
                <button type="button" onClick={() => log && !running && onOpen(log)} className={cn('po-run', run.kind)} disabled={running}>
                  <span className="po-run-icon" aria-hidden="true">
                    <Icon size={16} className={run.kind === 'running' ? 'animate-spin' : ''} />
                  </span>
                  <span className="po-run-main">
                    <strong>{run.title}</strong>
                    <small>
                      {run.when}
                      {run.trigger ? ` · ${run.trigger}` : ''}
                    </small>
                  </span>
                  <span className="po-run-summary">{run.summary}</span>
                  <span className="po-run-label">{run.warnings && run.kind !== 'error' ? `${run.label} (${run.warnings})` : run.label}</span>
                  <ChevronRight size={16} aria-hidden="true" className="po-run-arrow" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ChartEmpty message={onlyProblems ? 'Nenhuma importação com problema.' : 'Nenhuma importação ainda.'} />
      )}
    </Panel>
  );
}
