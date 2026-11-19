'use client';

// Small pieces shared by the Carros screens (cars, fines, the technician's own fines).
import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { dueState, type DueState } from '@/lib/vehicles/rules';
import type { VehicleRow } from '@/lib/vehicles/store';
import { brDate } from './call';

export type Technician = { id: string; name: string };

export const FIELD = 'h-10 w-full rounded-md border border-input bg-background px-3 text-[15px]';
export const AREA = 'w-full rounded-md border border-input bg-background px-3 py-2 text-[15px]';

export const carName = (car: Pick<VehicleRow, 'brand' | 'model' | 'year'>) => [car.brand, car.model, car.year].filter(Boolean).join(' ');

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`cr-field${wide ? ' is-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function DueBadge({ label, state, date }: { label: string; state: DueState; date: string | null }) {
  if (state === 'none') return null;
  const text = state === 'overdue' ? 'vencido' : state === 'soon' ? 'vence em breve' : 'em dia';
  return (
    <span className={`cr-due is-${state}`} title={`${label}: ${brDate(date)} (${text})`}>
      {label} {brDate(date)}
    </span>
  );
}

/** The licensing and insurance dates of a car as small badges; nothing at all when it has none (`empty` draws a dash instead). */
export function Dues({ car, today, empty = false }: { car: Pick<VehicleRow, 'licensingDue' | 'insuranceDue'>; today: string; empty?: boolean }) {
  const licensing = dueState(car.licensingDue, today);
  const insurance = dueState(car.insuranceDue, today);
  if (licensing === 'none' && insurance === 'none') return empty ? <span className="cr-muted">—</span> : null;
  return (
    <span className="cr-dues">
      <DueBadge label="Licenc." state={licensing} date={car.licensingDue} />
      <DueBadge label="Seguro" state={insurance} date={car.insuranceDue} />
    </span>
  );
}

/** "2 multas": flags a car that has fines still open, so the company knows which one to open. Red when a deadline is near or gone. */
export function FineFlag({ fines }: { fines: { open: number; urgent: boolean } | undefined }) {
  if (!fines) return null;
  const text = fines.open === 1 ? '1 multa' : `${fines.open} multas`;
  return (
    <span className={`cr-fine-flag${fines.urgent ? ' is-urgent' : ''}`} title={fines.urgent ? `${text} em aberto, com prazo acabando` : `${text} em aberto`}>
      <TriangleAlert size={13} aria-hidden="true" /> {text}
    </span>
  );
}
