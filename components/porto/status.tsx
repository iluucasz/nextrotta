'use client';

import { AlertTriangle, ArrowRight, CheckCircle2, Circle, FlaskConical, PlugZap, Power, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HelpDot } from '@/components/modal-kit';
import type { PortoStatus, Problem, ProblemAction, Step, Tone } from '@/lib/porto-status';
import { cn } from '@/lib/utils';

export type PortoAction = ProblemAction | 'connect' | 'test-login' | 'simulate' | 'mode-test' | 'mode-live';

const TONE_ICON: Record<Tone, LucideIcon> = { neutral: PlugZap, warning: FlaskConical, success: CheckCircle2, danger: XCircle };

/** The one thing to read first: where the robot stands, in a sentence, with the next move beside it. */
export function Hero({ status, hasCredentials, loginFailed, onAction }: { status: PortoStatus; hasCredentials: boolean; loginFailed: boolean; onAction: (action: PortoAction) => void }) {
  const Icon = status.overall === 'attention' ? AlertTriangle : status.overall === 'off' ? Power : TONE_ICON[status.tone];
  const first = status.overall === 'attention' ? status.problems[0] : undefined;

  let cta: { label: string; action: PortoAction } | null = null;
  if (status.overall === 'not_set_up') cta = { label: 'Conectar a conta', action: 'connect' };
  else if (status.overall === 'off') cta = { label: 'Ligar em teste', action: 'mode-test' };
  else if (status.overall === 'testing') cta = { label: 'Gravar de verdade', action: 'mode-live' };
  else if (first?.action) cta = { label: first.actionLabel ?? 'Resolver', action: first.action };
  else if (hasCredentials && !loginFailed && status.overall === 'ok') cta = null;

  return (
    <section className={cn('po-hero', status.tone)} aria-live="polite">
      <span className="po-hero-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      <div className="po-hero-text">
        <h2>{status.headline}</h2>
        <p>{status.detail}</p>
      </div>
      <div className="po-hero-side">
        {status.nextRun.hours || status.nextRun.schedule ? (
          <dl className="po-facts">
            {status.nextRun.hours ? (
              <div>
                <dt>Próxima importação de horas</dt>
                <dd>{status.nextRun.hours}</dd>
              </div>
            ) : null}
            {status.nextRun.schedule ? (
              <div>
                <dt>Próxima da escala</dt>
                <dd>{status.nextRun.schedule}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {cta ? (
          <Button type="button" onClick={() => onAction(cta.action)} className="po-hero-cta">
            {cta.label}
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Everything else that needs a look, most serious first, each with the button that fixes it. */
export function Problems({ problems, onAction }: { problems: Problem[]; onAction: (action: PortoAction) => void }) {
  if (!problems.length) return null;

  return (
    <section className="po-problems" aria-label="O que precisa de atenção">
      {problems.map((problem) => (
        <div key={problem.key} className={cn('po-problem', problem.tone)}>
          <span className="po-problem-icon" aria-hidden="true">
            {problem.tone === 'danger' ? <XCircle size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div className="po-problem-text">
            <strong>{problem.title}</strong>
            <p>{problem.detail}</p>
          </div>
          {problem.action ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onAction(problem.action!)}>
              {problem.actionLabel ?? 'Resolver'}
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/** The path from nothing to "importing for real": four steps, the one in front highlighted and doable. */
export function Steps({ steps, hasCredentials, loginFailed, busy, onAction }: { steps: Step[]; hasCredentials: boolean; loginFailed: boolean; busy: boolean; onAction: (action: PortoAction) => void }) {
  const accountDone = steps[0].done;

  const button = (step: Step): { label: string; action: PortoAction; enabled: boolean } | null => {
    if (step.done) return null;
    // The hero already holds this button while there is no account at all.
    if (step.key === 'account' && !hasCredentials) return null;
    switch (step.key) {
      case 'account':
        return { label: !hasCredentials ? 'Conectar a conta' : loginFailed ? 'Atualizar a senha' : 'Testar o login', action: hasCredentials && !loginFailed ? 'test-login' : 'connect', enabled: true };
      case 'technicians':
        return { label: 'Vincular técnicos', action: 'match', enabled: accountDone };
      case 'simulation':
        return { label: 'Simular agora', action: 'simulate', enabled: accountDone };
      case 'live':
        return { label: 'Gravar de verdade', action: 'mode-live', enabled: accountDone };
    }
  };

  return (
    <ol className="po-steps">
      {steps.map((step, index) => {
        const action = button(step);
        return (
          <li key={step.key} className={cn(step.done && 'done', step.current && 'current')}>
            <span className="po-step-mark" aria-hidden="true">
              {step.done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
              <b>{index + 1}</b>
            </span>
            <div>
              <strong className="po-step-title">
                {step.title}
                <HelpDot text={step.description} label={step.title} />
              </strong>
            </div>
            {action ? (
              <Button type="button" size="sm" variant={step.current ? 'default' : 'outline'} disabled={!action.enabled || busy} onClick={() => onAction(action.action)}>
                {action.label}
              </Button>
            ) : step.done ? (
              <span className="po-step-done">Pronto</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
