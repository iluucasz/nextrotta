'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Users } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { formatDate, formatHours } from '@/lib/formatters';

/**
 * The three zones of the Escala page, presentation only: who works today, the hour bank of the period and
 * the next seven days. The page computes the numbers and passes them in.
 */

/** What the company's Porto robot is doing: it fills in the escala and the hours by itself when it is on. */
export type PortoStatus = 'active' | 'test' | 'off';

const PORTO_STATUS_STYLE: Record<PortoStatus, { dot: string; title: string; text: string }> = {
  active: { dot: 'bg-emerald-500', title: 'Porto ativo', text: 'A escala e o apontamento de horas são feitos sozinhos, todo dia.' },
  test: { dot: 'bg-amber-400', title: 'Porto em modo teste', text: 'Ele ainda não grava nada: monte a escala e aponte as horas à mão.' },
  off: { dot: 'bg-border', title: 'Porto desligado', text: 'Monte a escala e aponte as horas à mão.' },
};

/** One line under the page title: is the Porto doing the escala and the hours, or is it up to the admin? */
export function PortoStatusBar({ status, lastImport }: { status: PortoStatus; lastImport?: string | null }) {
  const style = PORTO_STATUS_STYLE[status];

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-5 py-3 text-sm">
      <span className="inline-flex items-center gap-2 font-semibold text-foreground">
        <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden="true" />
        {style.title}
      </span>
      <span className="text-muted-foreground">{style.text}</span>
      {status === 'active' && lastImport ? <span className="text-muted-foreground">Última importação: {lastImport}.</span> : null}
      <Link href="/admin/config-porto" className="ml-auto font-medium text-primary hover:underline">
        Config. Porto
      </Link>
    </div>
  );
}

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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
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
                    className={`h-3 min-w-2 flex-1 rounded-full ${TODAY_STYLE[technician.kind].bar}`}
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

        <div className="flex items-center border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
          <dl className="flex items-start gap-10">
          <div>
            <dd className="text-2xl font-semibold tabular-nums text-foreground">{plannedUntil ? formatDate(plannedUntil) : '-'}</dd>
            <dt className="mt-0.5 max-w-40 text-sm text-muted-foreground">{plannedUntil ? 'escala montada até' : 'nenhuma escala montada'}</dt>
          </div>
          <div>
            <dd className={`text-2xl font-semibold tabular-nums ${missingDays > 0 ? 'text-amber-600' : 'text-foreground'}`}>{missingDays}</dd>
            <dt className="mt-0.5 max-w-40 text-sm text-muted-foreground">{missingDays === 1 ? 'dia sem escala' : 'dias sem escala'} nos próximos 7 dias</dt>
          </div>
        </dl>
        </div>
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

/** One decimal, like the screen shows it: -0,01h reads as 0,0h, never "-0,0h". */
function oneDecimal(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

function signedHours(value: number) {
  const rounded = oneDecimal(value);
  return `${rounded > 0 ? '+' : ''}${formatHours(rounded)}`;
}

function plural(value: number, singular: string, pluralForm: string) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

/** The four totals of the period, in one band; `action` sits at the end of the same band. */
export function HourBankNumbers({ planned, worked, balance, pending, action }: { planned: number; worked: number; balance: number; pending: number; action?: ReactNode }) {
  const items = [
    { label: 'Previsto', value: formatHours(planned), tone: 'text-foreground' },
    { label: 'Realizado', value: formatHours(worked), tone: 'text-foreground' },
    { label: 'Saldo', value: signedHours(balance), tone: oneDecimal(balance) < 0 ? 'text-rose-600' : oneDecimal(balance) > 0 ? 'text-emerald-600' : 'text-foreground' },
    { label: 'Pendências', value: String(pending), tone: 'text-foreground' },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-xl bg-secondary/40 px-5 py-4">
      <dl className="flex flex-wrap gap-x-10 gap-y-4">
        {items.map((item, index) => (
          <div key={item.label} className={index > 0 ? 'sm:border-l sm:border-border sm:pl-10' : ''}>
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className={`mt-0.5 text-2xl font-semibold tabular-nums ${item.tone}`}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {action}
    </div>
  );
}

export function HourBankRows({ rows }: { rows: HourBankSummaryRow[] }) {
  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Sem técnicos com movimento no período.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-transparent">
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
                <td className={`py-3.5 pr-4 text-right font-semibold tabular-nums ${oneDecimal(row.balance) < 0 ? 'text-rose-600' : oneDecimal(row.balance) > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
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
