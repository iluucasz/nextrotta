'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/management-ui';
import { calendarMonth, cents, entryState, remainingOf, type ExpenseEntry } from '@/lib/expenses';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { fullDate, payVerb } from './ui';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** The month as a calendar of due dates: one look at which days are heavy, and a click on a day to see and pay. */
export function Calendar({ entries, today, month, onOpen, onPay, onNew }: { entries: ExpenseEntry[]; today: string; month: string; onOpen: (entry: ExpenseEntry) => void; onPay: (entry: ExpenseEntry) => void; onNew: (dueDate: string) => void }) {
  const days = useMemo(() => calendarMonth(entries, month, today), [entries, month, today]);
  const [picked, setPicked] = useState<string | null>(null);

  // Opening the month on today (or its first day) keeps the side list useful without a click.
  const selected = picked && days.some((day) => day.date === picked && day.inMonth) ? picked : month === today.slice(0, 7) ? today : `${month}-01`;
  const day = days.find((item) => item.date === selected);
  const monthEntries = days.filter((item) => item.inMonth).flatMap((item) => item.entries);
  const toPay = cents(monthEntries.filter((entry) => entry.type === 'payable').reduce((total, entry) => total + entry.amount, 0));
  const toReceive = cents(monthEntries.filter((entry) => entry.type === 'receivable').reduce((total, entry) => total + entry.amount, 0));

  return (
    <section className="mg-section">
      <div className="mg-grid-finance" style={{ gridTemplateColumns: 'minmax(0, 2.2fr) minmax(280px, 1fr)' }}>
        <Panel title="Calendário de vencimentos" description={`A pagar no mês: ${formatCurrency(toPay)}${toReceive ? ` · a receber: ${formatCurrency(toReceive)}` : ''}`}>
          <div className="ex-calendar" role="grid" aria-label="Vencimentos do mês">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday} className="ex-weekday" role="columnheader">
                {weekday}
              </div>
            ))}
            {days.map((item) => (
              <button
                key={item.date}
                type="button"
                role="gridcell"
                aria-label={`${fullDate(item.date)}: ${item.entries.length} conta(s)`}
                className={cn('ex-day', !item.inMonth && 'outside', item.isToday && 'today', item.date === selected && 'selected')}
                onClick={() => setPicked(item.date)}
              >
                <span className="ex-day-number">{Number(item.date.slice(8, 10))}</span>
                {item.entries.slice(0, 2).map((entry) => (
                  <span key={entry.id} className={cn('ex-chip', entryState(entry, today), entry.type)} title={`${entry.description} · ${formatCurrency(entry.amount)}`}>
                    {entry.description}
                  </span>
                ))}
                {item.entries.length > 2 ? <span className="ex-day-more">+{item.entries.length - 2}</span> : null}
              </button>
            ))}
          </div>
          <Legend />
        </Panel>

        <Panel title={fullDate(selected)} description={day?.entries.length ? `${day.entries.length} conta(s) neste dia` : 'Nenhuma conta neste dia'}>
          {day?.entries.length ? (
            <div>
              {day.entries.map((entry) => (
                <div className="ex-row" key={entry.id} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                  <button type="button" className="ex-row-main" onClick={() => onOpen(entry)}>
                    <strong>{entry.description}</strong>
                    <small>
                      {entry.type === 'receivable' ? 'A receber' : entry.category} · {formatCurrency(entry.amount)}
                    </small>
                  </button>
                  {remainingOf(entry) > 0 ? (
                    <Button type="button" size="sm" onClick={() => onPay(entry)}>
                      {payVerb(entry.type)}
                    </Button>
                  ) : (
                    <span className="text-sm text-muted-foreground">{entry.type === 'payable' ? 'Paga' : 'Recebida'}</span>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onNew(selected)}>
            Nova conta neste dia
          </Button>
        </Panel>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="mg-legend" style={{ marginTop: 12 }}>
      <span>
        <i style={{ background: '#fde4e1' }} />
        Vencida
      </span>
      <span>
        <i style={{ background: '#fff1d6' }} />
        Vence hoje
      </span>
      <span>
        <i style={{ background: '#eef0ff' }} />
        A vencer
      </span>
      <span>
        <i style={{ background: '#e3f5ec' }} />
        Paga
      </span>
      <span>
        <i style={{ background: '#15803d' }} />
        Barra verde: a receber
      </span>
    </div>
  );
}
