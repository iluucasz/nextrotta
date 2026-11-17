'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight, CarFront, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Problem, StatusAction, StatusCard, Tone } from '@/lib/vehicles/status';
import { cn } from '@/lib/utils';

const TONE_ICON: Record<Tone, LucideIcon> = { neutral: CarFront, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };

/** The one thing to read first: where the fleet (or the fines) stands, in a sentence, with the next move beside it. */
export function StatusHero({ card, onAction }: { card: StatusCard; onAction: (action: StatusAction) => void }) {
  const Icon = TONE_ICON[card.tone];
  return (
    <section className={cn('cr-hero', card.tone)} aria-live="polite">
      <span className="cr-hero-icon" aria-hidden="true">
        <Icon size={26} />
      </span>
      <div className="cr-hero-text">
        <h2>{card.headline}</h2>
        <p>{card.detail}</p>
      </div>
      {card.cta ? (
        <Button type="button" onClick={() => onAction(card.cta!.action)} className="cr-hero-cta">
          {card.cta.label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      ) : null}
    </section>
  );
}

const VISIBLE = 3;

/** Everything else that needs a look, most serious first, each with the button that fixes it. */
export function Problems({ problems, onAction }: { problems: Problem[]; onAction: (action: StatusAction) => void }) {
  const [all, setAll] = useState(false);
  if (!problems.length) return null;
  const shown = all ? problems : problems.slice(0, VISIBLE);

  return (
    <section className="cr-problems" aria-label="O que precisa de atenção">
      {shown.map((problem) => (
        <div key={problem.key} className={cn('cr-problem', problem.tone)}>
          <span className="cr-problem-icon" aria-hidden="true">
            {problem.tone === 'danger' ? <XCircle size={18} /> : <AlertTriangle size={18} />}
          </span>
          <strong className="cr-problem-text">{problem.title}</strong>
          <Button type="button" size="sm" variant="outline" onClick={() => onAction(problem.action)}>
            {problem.actionLabel}
          </Button>
        </div>
      ))}
      {problems.length > VISIBLE ? (
        <button type="button" className="cr-link cr-problems-more" onClick={() => setAll((current) => !current)}>
          {all ? 'Mostrar menos' : `Mostrar mais ${problems.length - VISIBLE}`}
        </button>
      ) : null}
    </section>
  );
}
