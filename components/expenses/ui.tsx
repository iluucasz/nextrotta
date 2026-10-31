'use client';

import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { HelpDot } from '@/components/modal-kit';
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

/** What goes in an amount box when it is opened with a value: 4.200,00 (never 4200 or 6315,4). */
export const amountText = (value: number) => value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A labelled field. `help` opens from a "?" next to the label; `hint` is for what is true right now (never for explanations). */
export function Field({ label, hint, help, children, className, htmlFor }: { label: string; hint?: string; help?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  const generated = useId();
  // A single input, select or textarea gets its id here so the label points at it; anything else passes `htmlFor` itself.
  const single = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type) ? (children as ReactElement<{ id?: string }>) : null;
  const id = htmlFor ?? single?.props.id ?? generated;

  return (
    <div className={cn('block min-w-0', className)}>
      <span className="mb-1.5 flex items-center gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {help ? <HelpDot text={help} label={label} /> : null}
      </span>
      {single && !single.props.id ? cloneElement(single, { id }) : children}
      {hint ? <span className="mt-1 block text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** Two or three figures side by side, never wrapping: the summary at the top of a window. */
export function Figures({ items }: { items: Array<{ label: string; value: ReactNode; tone?: 'bad' }> }) {
  return (
    <dl className="grid divide-x divide-border rounded-xl bg-secondary/40 py-3.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => (
        <div key={item.label} className="px-5 first:pl-5">
          <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
          <dd className={cn('mt-0.5 text-lg font-semibold tabular-nums', item.tone === 'bad' && 'text-rose-700')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MoneyField({ label, value, onChange, hint, className, autoFocus }: { label: string; value: string; onChange: (value: string) => void; hint?: string; className?: string; autoFocus?: boolean }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} className={className} htmlFor={id}>
      <div className="relative block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          // Digits, a decimal comma or dot, and the thousands dot: nothing else.
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ''))}
          className={cn(inputClass, 'pl-9 text-right tabular-nums')}
          placeholder="0,00"
        />
      </div>
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
