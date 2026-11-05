'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock3, FlaskConical, Loader2, TriangleAlert, XCircle, type LucideIcon } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import type { PortoStatus, RunKind } from '@/lib/porto-status';
import type { PortoSyncLog } from '@/lib/porto-ui-helpers';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<RunKind, LucideIcon> = { ok: CheckCircle2, recovered: CheckCircle2, warning: TriangleAlert, error: XCircle, test: FlaskConical, running: Loader2, skipped: Clock3 };

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
      title="Histórico"
      help="O que o robô fez nas últimas vezes. Clique em uma execução para ver o que ela encontrou."
      badge={
        problems ? (
          <button type="button" className={cn('po-filter', onlyProblems && 'on')} aria-pressed={onlyProblems} onClick={() => setOnlyProblems((value) => !value)}>
            {onlyProblems ? 'Mostrar tudo' : `Só com problema (${problems})`}
          </button>
        ) : undefined
      }
    >
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
        <p className="po-empty">{onlyProblems ? 'Nenhuma importação com problema.' : 'Nenhuma importação ainda.'}</p>
      )}
    </Panel>
  );
}
