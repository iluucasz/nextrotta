'use client';

import { Users } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatHours } from '@/lib/formatters';

/**
 * The three zones of the Escala page, presentation only: who works today, the hour bank of the period and
 * the next seven days. The page computes the numbers and passes them in.
 */

export type TodayKind = 'work' | 'off' | 'none';

export interface TodayTechnician {
  id: string;
  name: string;
  kind: TodayKind;
}

const TODAY_STYLE: Record<TodayKind, { bar: string; dot: string; label: string }> = {
  work: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', label: 'Trabalha' },
  off: { bar: 'bg-amber-400', dot: 'bg-amber-400', label: 'Folga' },
  none: { bar: 'bg-border', dot: 'bg-border', label: 'Sem escala' },
};

export function TodayStrip({
  dateLabel,
  technicians,
  plannedUntil,
  missingDays,
}: {
  dateLabel: string;
  technicians: TodayTechnician[];
  /** Last day that has a saved escala (YYYY-MM-DD), or null when nothing is planned yet. */
  plannedUntil: string | null;
  /** Technician-days without escala in the next seven days. */
  missingDays: number;
}) {
  const counts = { work: 0, off: 0, none: 0 };
  technicians.forEach((technician) => {
    counts[technician.kind] += 1;
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-7" aria-label="Hoje">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1)}</p>
          {technicians.length ? (
            <>
              <p className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-foreground">
                <span className="tabular-nums">{counts.work}</span>
                <span className="font-normal text-muted-foreground"> de {technicians.length} {technicians.length === 1 ? 'técnico trabalha' : 'técnicos trabalham'} hoje</span>
              </p>

              <ul className="mt-5 flex gap-1.5" aria-label="Situação de cada técnico hoje">
                {technicians.map((technician) => (
                  <li
                    key={technician.id}
                    title={`${technician.name}: ${TODAY_STYLE[technician.kind].label}`}
                    className={`h-3 min-w-3 max-w-14 flex-1 rounded-full ${TODAY_STYLE[technician.kind].bar}`}
                  >
                    <span className="sr-only">{technician.name}: {TODAY_STYLE[technician.kind].label}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {(['work', 'off', 'none'] as TodayKind[])
                  .filter((kind) => counts[kind] > 0)
                  .map((kind) => (
                    <span key={kind} className="inline-flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${TODAY_STYLE[kind].dot}`} aria-hidden="true" />
                      <span className="tabular-nums text-foreground">{counts[kind]}</span>{' '}
                      {kind === 'work' ? (counts[kind] === 1 ? 'trabalha' : 'trabalham') : kind === 'off' ? (counts[kind] === 1 ? 'de folga' : 'de folga') : 'sem escala'}
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <p className="mt-1 text-lg text-muted-foreground">Nenhum técnico ativo.</p>
          )}
        </div>

        <dl className="flex gap-8 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div>
            <dd className="text-2xl font-semibold tabular-nums text-foreground">{plannedUntil ? formatDate(plannedUntil) : '-'}</dd>
            <dt className="mt-0.5 text-sm text-muted-foreground">{plannedUntil ? 'escala montada até' : 'nenhuma escala montada'}</dt>
          </div>
          <div>
            <dd className={`text-2xl font-semibold tabular-nums ${missingDays > 0 ? 'text-amber-600' : 'text-foreground'}`}>{missingDays}</dd>
            <dt className="mt-0.5 text-sm text-muted-foreground">{missingDays === 1 ? 'dia sem escala' : 'dias sem escala'} nos próximos 7 dias</dt>
          </div>
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------

export interface HourBankSummaryRow {
  technician_id: string;
  technician_name: string;
  planned_hours: number;
  worked_hours: number;
  balance: number;
  worked_days: number;
  day_off_days: number;
  missed_days: number;
  pending_days: number;
}

function signedHours(value: number) {
  return `${value > 0 ? '+' : ''}${formatHours(value)}`;
}

function plural(value: number, singular: string, pluralForm: string) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

export function HourBankNumbers({ planned, worked, balance, pending }: { planned: number; worked: number; balance: number; pending: number }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
      <div>
        <dt className="text-sm text-muted-foreground">Previsto</dt>
        <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatHours(planned)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Realizado</dt>
        <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatHours(worked)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Saldo</dt>
        <dd className={`mt-1 text-2xl font-semibold tabular-nums ${balance < 0 ? 'text-rose-600' : balance > 0 ? 'text-emerald-600' : 'text-foreground'}`}>{signedHours(balance)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Pendências</dt>
        <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{pending}</dd>
      </div>
    </dl>
  );
}

export function HourBankRows({ rows }: { rows: HourBankSummaryRow[] }) {
  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sem técnicos com movimento no período.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-[13px] text-muted-foreground">
            <th className="pb-2 pr-4 font-normal">Técnico</th>
            <th className="pb-2 pr-4 font-normal">Horas no período</th>
            <th className="pb-2 pr-4 text-right font-normal">Saldo</th>
            <th className="pb-2 pl-4 font-normal">Ocorrências</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const progress = row.planned_hours > 0 ? Math.min(100, Math.round((row.worked_hours / row.planned_hours) * 100)) : 0;
            const occurrences = [
              row.day_off_days > 0 ? { key: 'folga', text: plural(row.day_off_days, 'folga', 'folgas'), dot: 'bg-amber-400' } : null,
              row.missed_days > 0 ? { key: 'falta', text: plural(row.missed_days, 'falta', 'faltas'), dot: 'bg-rose-500' } : null,
              row.pending_days > 0 ? { key: 'pendente', text: plural(row.pending_days, 'pendente', 'pendentes'), dot: 'bg-primary' } : null,
            ].filter((item): item is { key: string; text: string; dot: string } => Boolean(item));

            return (
              <tr key={row.technician_id} className="border-t border-border">
                <td className="py-3.5 pr-4">
                  <p className="font-medium text-foreground">{row.technician_name}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{plural(row.worked_days, 'dia trabalhado', 'dias trabalhados')}</p>
                </td>
                <td className="w-[34%] py-3.5 pr-4">
                  <p className="tabular-nums text-foreground">
                    {formatHours(row.worked_hours)}
                    <span className="text-muted-foreground"> de {formatHours(row.planned_hours)}</span>
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${progress}% do previsto`}>
                    <div className={`h-full rounded-full ${row.worked_hours >= row.planned_hours && row.planned_hours > 0 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${progress}%` }} />
                  </div>
                </td>
                <td className={`py-3.5 pr-4 text-right font-semibold tabular-nums ${row.balance < 0 ? 'text-rose-600' : row.balance > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {signedHours(row.balance)}
                </td>
                <td className="py-3.5 pl-4">
                  {occurrences.length ? (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                      {occurrences.map((item) => (
                        <span key={item.key} className="inline-flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} aria-hidden="true" />
                          {item.text}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------

export type WeekCellKind = 'work' | 'done' | 'off' | 'missed' | 'none';

export interface WeekCell {
  date: string;
  kind: WeekCellKind;
  /** Time range, or what the day is ("Folga"). */
  title: string;
  /** Status in words ("Escalado", "Concluído"...). */
  caption: string;
}

export interface WeekRow {
  id: string;
  name: string;
  cells: WeekCell[];
}

const CELL_STYLE: Record<WeekCellKind, string> = {
  work: 'border-primary/25 bg-primary/5 text-foreground',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  off: 'border-amber-200 bg-amber-50 text-amber-950',
  missed: 'border-rose-200 bg-rose-50 text-rose-950',
  none: 'border-dashed border-border bg-transparent text-muted-foreground',
};

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function WeekOverview({ dates, today, rows }: { dates: string[]; today: string; rows: WeekRow[] }) {
  if (!rows.length) {
    return <EmptyState icon={Users} title="Nenhum técnico ativo" description="Não há técnicos ativos para montar a escala." />;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className="grid grid-cols-[minmax(150px,200px)_repeat(7,minmax(0,1fr))] gap-1.5 pb-2">
          <div />
          {dates.map((date) => {
            const isToday = date === today;
            return (
              <div key={date} className={`rounded-lg px-2 py-1.5 text-center ${isToday ? 'bg-primary/10' : ''}`}>
                <p className={`text-[13px] ${isToday ? 'font-semibold text-primary' : 'text-muted-foreground'}`}>
                  {WEEKDAY_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()]}{isToday ? ' · hoje' : ''}
                </p>
                <p className="text-sm font-semibold tabular-nums text-foreground">{formatDate(date).slice(0, 5)}</p>
              </div>
            );
          })}
        </div>

        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[minmax(150px,200px)_repeat(7,minmax(0,1fr))] items-stretch gap-1.5 border-t border-border py-1.5">
            <div className="flex items-center pr-3 text-sm font-medium text-foreground">{row.name}</div>
            {row.cells.map((cell) => (
              <div key={cell.date} className={`min-h-14 rounded-lg border px-2.5 py-2 ${CELL_STYLE[cell.kind]}`}>
                <p className="text-[13px] font-semibold tabular-nums leading-tight">{cell.title}</p>
                <p className="mt-0.5 text-xs opacity-75">{cell.caption}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
