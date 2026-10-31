'use client';

import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { entryState, type EntryType, type ExpenseEntry } from '@/lib/expenses';
import { cn } from '@/lib/utils';

export const inputClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} de ${month.slice(0, 4)}`;
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
export const shortDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export const fullDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** "Pagar" for a bill, "Receber" for something owed to the company: the same action, said the way the person thinks. */
export const payVerb = (type: EntryType) => (type === 'payable' ? 'Pagar' : 'Receber');

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block min-w-0', className)}>
      <span className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function MoneyField({ label, value, onChange, hint, className, autoFocus }: { label: string; value: string; onChange: (value: string) => void; hint?: string; className?: string; autoFocus?: boolean }) {
  return (
    <Field label={label} hint={hint} className={className}>
      <span className="relative block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          // Digits, a decimal comma or dot, and the thousands dot: nothing else.
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ''))}
          className={cn(inputClass, 'pl-9 text-right tabular-nums')}
          placeholder="0,00"
        />
      </span>
    </Field>
  );
}

const LABELS: Record<EntryType, Record<ReturnType<typeof entryState>, string>> = {
  payable: { paid: 'Paga', overdue: 'Vencida', due_today: 'Vence hoje', partial: 'Parcial', upcoming: 'A vencer' },
  receivable: { paid: 'Recebida', overdue: 'Atrasada', due_today: 'Vence hoje', partial: 'Parcial', upcoming: 'A receber' },
};
const TONES = { paid: 'success', overdue: 'danger', due_today: 'warning', partial: 'info', upcoming: 'neutral' } as const;

export function StateBadge({ entry, today }: { entry: Pick<ExpenseEntry, 'type' | 'amount' | 'paid_amount' | 'due_date'>; today: string }) {
  const state = entryState(entry, today);
  return <StatusBadge tone={TONES[state]}>{LABELS[entry.type][state]}</StatusBadge>;
}
