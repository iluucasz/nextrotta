'use client';

import Link from 'next/link';
import { Check, Circle, LifeBuoy, LoaderCircle, RotateCw, X, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDuration, type RecoveryStep } from '@/lib/porto-recovery';
import { whenLabel } from '@/lib/porto-status';
import { cn } from '@/lib/utils';
import type { RecoveryView } from './use-recovery';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function stepText(step: RecoveryStep, now: Date) {
  if (step.status === 'done') {
    return `Concluído ${whenLabel(step.finishedAt, now)}${step.durationMs !== null ? ` · ${formatDuration(step.durationMs)}` : ''}`;
  }
  return { running: 'Rodando…', waiting: 'Na fila', failed: 'Falhou' }[step.status];
}

/** What was redone, one line each like the steps of a deploy: a check with when it finished, a spinner while it runs. */
function Steps({ steps }: { steps: RecoveryStep[] }) {
  const now = new Date();
  return (
    <ul className="po-recovery-steps">
      {steps.map((step) => (
        <li key={step.job} className={cn('po-recovery-step', step.status)}>
          <span className="po-recovery-step-icon" aria-hidden="true">
            {step.status === 'done' ? <Check size={14} /> : step.status === 'running' ? <LoaderCircle size={14} className="mg-spin" /> : step.status === 'failed' ? <X size={14} /> : <Circle size={10} />}
          </span>
          <span className="po-recovery-step-label">{capitalize(step.label)}</span>
          <span className="po-recovery-step-state">{stepText(step, now)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The import that failed and is being redone (a spinner and what is running), that is done (a check and when it
 * finished), or did not work again (the way to try again and the way to Suporte). Nothing shows when there was no failure.
 */
export function Recovery({ view, onRetry }: { view: RecoveryView; onRetry: () => void }) {
  if (view.state === 'none') return null;

  if (view.state === 'running') {
    return (
      <section className="po-recovery running" role="status" aria-live="polite" aria-label="Recuperando a importação">
        <span className="po-recovery-icon" aria-hidden="true">
          <LoaderCircle size={22} className="mg-spin" />
        </span>
        <div className="po-recovery-text">
          <strong>Recuperando a importação</strong>
          <p>Rodando agora {view.label}, por causa da falha. Leva alguns minutos; pode sair desta tela, o robô continua.</p>
          <Steps steps={view.steps} />
        </div>
      </section>
    );
  }

  if (view.state === 'done') {
    return (
      <section className="po-recovery done" role="status" aria-label="Importação recuperada">
        <span className="po-recovery-icon" aria-hidden="true">
          <Check size={22} />
        </span>
        <div className="po-recovery-text">
          <strong>Importação recuperada</strong>
          <p>O que tinha falhado foi importado de novo. A falha continua registrada no histórico, marcada como concluída.</p>
          <Steps steps={view.steps} />
        </div>
      </section>
    );
  }

  return (
    <section className="po-recovery failed" role="alert">
      <span className="po-recovery-icon" aria-hidden="true">
        <XCircle size={22} />
      </span>
      <div className="po-recovery-text">
        <strong>{view.retried ? 'Não deu para recuperar a importação' : 'A importação falhou'}</strong>
        <p>{view.message}</p>
        <Steps steps={view.steps} />
      </div>
      <div className="po-recovery-actions">
        <Button type="button" size="sm" onClick={onRetry}>
          <RotateCw className="h-4 w-4" />
          Tentar novamente
        </Button>
        {view.support || view.retried ? (
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href="/admin/suporte">
              <LifeBuoy className="h-4 w-4" />
              Abrir chamado
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
