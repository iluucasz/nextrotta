'use client';

import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * One look for the working dialogs (Apontar horas, Montar escala and the ones opened from them): the same
 * header, body and footer spacing, plain sections instead of boxes inside boxes, one summary band and one
 * segmented control. Use these classes on DialogHeader / DialogTitle / DialogDescription / DialogFooter.
 */

export const MODAL_HEADER_CLASS = 'gap-1 border-b border-border px-6 py-5 sm:px-8';
export const MODAL_TITLE_CLASS = 'text-xl font-semibold tracking-tight';
export const MODAL_DESCRIPTION_CLASS = 'max-w-2xl text-sm leading-6 text-muted-foreground';
export const MODAL_BODY_CLASS = 'min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8';
export const MODAL_FOOTER_CLASS = 'items-center gap-3 border-t border-border bg-card px-6 py-4 sm:px-8';

/** The little "?" next to a label: the explanation only opens when the person clicks it, so the dialog stays quiet. */
export function HelpDot({ text, label }: { text: string; label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`O que é: ${label}`}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold leading-none text-muted-foreground outline-none transition hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-primary data-[state=open]:text-foreground"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 whitespace-pre-line px-3.5 py-3 text-[13px] leading-relaxed text-foreground">
        {text}
      </PopoverContent>
    </Popover>
  );
}

/** A titled part of a dialog: a heading and its content, no box around it. */
export function ModalSection({
  title,
  description,
  help,
  action,
  children,
  className,
}: {
  title?: string;
  description?: string;
  /** An explanation that opens from a "?" next to the title instead of sitting on the page. */
  help?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {title || action ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? (
              <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                {title}
                {help ? <HelpDot text={help} label={title} /> : null}
              </h3>
            ) : null}
            {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface SummaryItem {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'good' | 'bad';
}

/** The few numbers that sum a dialog up, in one quiet band. */
export function SummaryBand({ items, action }: { items: SummaryItem[]; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-xl bg-secondary/40 px-5 py-3.5">
      <dl className="flex flex-wrap gap-x-9 gap-y-3">
        {items.map((item, index) => (
          <div key={item.label} className={index > 0 ? 'sm:border-l sm:border-border sm:pl-9' : ''}>
            <dt className="text-[13px] text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                'mt-0.5 text-lg font-semibold tabular-nums',
                item.tone === 'bad' ? 'text-rose-600' : item.tone === 'good' ? 'text-emerald-600' : 'text-foreground',
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {action}
    </div>
  );
}

/** Two to four options side by side, one selected: for choices that change what the rest of the dialog shows. */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-10 items-center rounded-lg bg-secondary/70 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-8 rounded-md px-3.5 text-sm font-medium transition',
            value === option.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A message inside a dialog (what went wrong, what happened): same strip everywhere. */
export function ModalNotice({ tone, children }: { tone: 'error' | 'success' | 'warning'; children: ReactNode }) {
  const style =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-800'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
        : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('rounded-lg border px-4 py-3 text-sm', style)}>
      {children}
    </div>
  );
}
