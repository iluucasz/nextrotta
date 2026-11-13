'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** One worked example inside an explanation: labelled rows and, optionally, the result they add up to. */
export interface HelpExample {
  /** Defaults to "Exemplo". */
  title?: string;
  rows: Array<[label: string, value: string]>;
  result?: [label: string, value: string];
}

/** The explanation of one option: what it does, one or more worked examples, and an aside. */
export interface OptionHelp {
  what: string;
  examples?: HelpExample[];
  note?: string;
}

/**
 * The "?" that sits on one option of a choice. It opens a short, structured explanation (what it does,
 * an example with numbers, a note) so the screen itself stays quiet.
 */
export function OptionHelpDot({ title, help }: { title: string; help: OptionHelp }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`O que é: ${title}`}
          className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold leading-none text-muted-foreground outline-none transition hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-primary data-[state=open]:text-foreground"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={10} collisionPadding={16} className="max-h-[min(var(--radix-popover-content-available-height),32rem)] w-[22rem] max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto px-4 py-3.5 text-[13px] leading-relaxed text-foreground">
        <p className="text-sm font-semibold">{title}</p>
        <p>{help.what}</p>
        {help.examples?.map((example, index) => (
          <div key={index} className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{example.title ?? 'Exemplo'}</p>
            <dl className="space-y-1">
              {example.rows.map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {example.result ? (
              <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border pt-2 font-semibold">
                <span>{example.result[0]}</span>
                <span className="text-right tabular-nums text-primary">{example.result[1]}</span>
              </div>
            ) : null}
          </div>
        ))}
        {help.note ? <p className="text-muted-foreground">{help.note}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
