'use client';

import { AlertTriangle, ArrowRight, CarFront, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatPlate } from '@/lib/vehicles/rules';
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

/** Each thing that needs a look, most serious first, with the button that fixes it. A row that speaks for several cars lists them. */
export function Problems({ problems, onAction }: { problems: Problem[]; onAction: (action: StatusAction) => void }) {
  if (!problems.length) return null;

  return (
    <section className="cr-problems" aria-label="O que precisa de atenção">
      {problems.map((problem) => (
        <div key={problem.key} className={cn('cr-problem', problem.tone)}>
          <span className="cr-problem-icon" aria-hidden="true">
            {problem.tone === 'danger' ? <XCircle size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div className="cr-problem-body">
            <strong className="cr-problem-text">{problem.title}</strong>
            {problem.cars && problem.cars.length > 1 ? (
              <span className="cr-problem-cars">
                {problem.cars.map((car) => (
                  <button key={car.id} type="button" className="cr-plate-button" aria-label={`Completar o carro ${formatPlate(car.plate)}`} onClick={() => onAction({ kind: 'car', carId: car.id })}>
                    <span className="cr-plate">{formatPlate(car.plate)}</span>
                  </button>
                ))}
              </span>
            ) : null}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => onAction(problem.action)}>
            {problem.cars && problem.cars.length > 1 ? 'Completar o primeiro' : problem.actionLabel}
          </Button>
        </div>
      ))}
    </section>
  );
}
