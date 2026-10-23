'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Boxes,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Coins,
  Download,
  Filter,
  Layers3,
  Package,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/formatters';
import type { FinanceReport } from '@/lib/parts/finance';
import { addMonths, formatMonthLabel } from '@/lib/parts/types';
import type { CatalogResponse } from './catalog-tab';
import { Alert, currentMonthKey, formatDateTime, inputClass, Spinner, useParts } from '../shared';

/**
 * Role-based hues, validated for color-blind separation: money in = purple, money out = amber,
 * result = teal, an open balance / alert = rose, "other" = neutral gray. Same role, same hue, in every chart.
 */
const C = { income: '#7161ef', expense: '#d98a2b', result: '#34b6aa', alert: '#c2527a', other: '#66889a' };

const axis = { tickLine: false, axisLine: false, tick: { fill: '#8a8b9b', fontSize: 11 }, minTickGap: 12 };
const tooltipStyle = { border: '1px solid #eeedf4', borderRadius: 12, boxShadow: '0 8px 30px #25233d12', fontSize: 12, color: '#252337' };
const compact = (value: number) => value.toLocaleString('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const money = (value: unknown) => formatCurrency(Number(value));

const METHOD_LABELS = { pix: 'Pix', cash: 'Dinheiro', transfer: 'Transferência', other: 'Outros' } as const;
const METHOD_COLORS = { pix: C.income, cash: C.result, transfer: C.expense, other: C.other } as const;

type View = 'overview' | 'technicians' | 'parts' | 'cash';
const VIEWS: Array<{ value: View; label: string; icon: typeof Layers3 }> = [
  { value: 'overview', label: 'Visão geral', icon: Layers3 },
  { value: 'technicians', label: 'Técnicos', icon: Users },
  { value: 'parts', label: 'Peças', icon: Package },
  { value: 'cash', label: 'Caixa', icon: Banknote },
];

function shortMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, number - 1, 1))).replace('.', '');
  return `${name}/${String(year).slice(2)}`;
}

/** Percent change against the previous period; null when there is nothing to compare with. */
function change(current: number, previous: number) {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ---------------------------------------------------------------- building blocks

type ChipKind = 'up-good' | 'up-bad' | 'neutral';

/** The change against the previous period, as a tinted pill. `up-bad` for what should shrink; `neutral` for spending. */
function Chip({ value, kind = 'up-good', dark = false }: { value: number | null; kind?: ChipKind; dark?: boolean }) {
  if (value === null) return <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${dark ? 'bg-white/10 text-white/70' : 'bg-muted text-muted-foreground'}`}>sem base</span>;
  if (Math.abs(value) < 0.05) return <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${dark ? 'bg-white/10 text-white/70' : 'bg-muted text-muted-foreground'}`}>igual</span>;
  const up = value > 0;
  const good = kind === 'neutral' ? null : (kind === 'up-good') === up;
  const tone =
    good === null
      ? dark ? 'bg-white/10 text-white/80' : 'bg-muted text-foreground/70'
      : good
        ? dark ? 'bg-emerald-400/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
        : dark ? 'bg-rose-400/20 text-rose-200' : 'bg-rose-50 text-rose-700';
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${tone}`}>
      <Icon className="h-3 w-3" />
      {up ? '+' : '−'}
      {formatPercent(Math.abs(value))}
    </span>
  );
}

function Hero({ label, value, hint, icon: Icon, chip, dark = false, tone }: { label: string; value: string; hint?: string; icon: typeof Wallet; chip?: React.ReactNode; dark?: boolean; tone?: 'danger' }) {
  return (
    <div className={`relative overflow-hidden rounded-xl border p-5 ${dark ? 'border-transparent bg-[#252337] text-white' : 'bg-card'}`}>
      {dark ? <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/5" aria-hidden="true" /> : null}
      <div className="relative flex items-start justify-between gap-3">
        <p className={`text-xs ${dark ? 'text-white/70' : 'text-muted-foreground'}`}>{label}</p>
        <span className={`grid h-8 w-8 shrink-0 place-content-center rounded-lg ${dark ? 'bg-white/10 text-white' : 'bg-primary/10 text-primary'}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`relative mt-5 text-3xl font-semibold tabular-nums tracking-tight ${tone === 'danger' ? (dark ? 'text-rose-200' : 'text-rose-700') : ''}`}>{value}</p>
      <div className="relative mt-3 flex flex-wrap items-center gap-2">
        {chip}
        {hint ? <span className={`text-xs ${dark ? 'text-white/65' : 'text-muted-foreground'}`}>{hint}</span> : null}
      </div>
    </div>
  );
}

function Strip({ cells }: { cells: Array<{ label: string; value: string; hint?: string; icon: typeof Wallet; chip?: React.ReactNode }> }) {
  return (
    <div className={`grid divide-y rounded-xl border bg-card sm:divide-x sm:divide-y-0 ${cells.length === 4 ? 'sm:grid-cols-2 lg:grid-cols-4 lg:divide-y-0' : cells.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
      {cells.map((cell) => (
        <div key={cell.label} className="flex items-center gap-3 p-4">
          <cell.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{cell.label}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xl font-semibold tabular-nums">{cell.value}</span>
              {cell.chip}
              {cell.hint ? <span className="text-xs text-muted-foreground">{cell.hint}</span> : null}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ number, title, aside, children }: { number: string; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="flex items-center gap-3 text-base font-semibold">
          <span className="grid h-6 min-w-8 place-content-center rounded-md border px-1 text-[11px] font-normal text-muted-foreground">{number}</span>
          {title}
        </h2>
        {aside ? <p className="text-xs text-muted-foreground">{aside}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Banner({ children, action, onAction }: { children: React.ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <span className="flex items-center gap-2.5">
        <CircleHelp className="h-4 w-4 shrink-0 text-amber-700" />
        {children}
      </span>
      {action && onAction ? (
        <button type="button" onClick={onAction} className="inline-flex items-center gap-1.5 font-semibold hover:underline">
          {action}
          <ArrowRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A panel with a title, an optional tag and legend, and a "Tabela" view with the same numbers (never color-only). */
function Panel({
  title,
  description,
  tag,
  legend,
  columns,
  rows,
  empty,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  tag?: string;
  legend?: Array<{ label: string; color: string }>;
  columns?: string[];
  rows?: Array<Array<string | number>>;
  empty: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const hasTable = Boolean(columns && rows);
  return (
    <section className={`grid content-start gap-3 rounded-xl border bg-card p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tag ? <span className="rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{tag}</span> : null}
          {!empty && hasTable ? (
            <div className="flex rounded-lg bg-muted p-0.5 text-xs" role="group" aria-label="Forma de exibição">
              {(['chart', 'table'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setView(value)}
                  aria-pressed={view === value}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${view === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
                >
                  {value === 'chart' ? 'Gráfico' : 'Tabela'}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {empty ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Sem dados no período.</p>
      ) : view === 'chart' || !hasTable ? (
        <>
          {legend && legend.length > 1 ? <Legend items={legend} /> : null}
          {children}
        </>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border">
          <table className="w-full min-w-max text-sm">
            <thead className="sticky top-0 bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {columns!.map((column, index) => (
                  <th key={column} className={`px-3 py-2 font-medium ${index ? 'text-right' : ''}`}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows!.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
                  {row.map((cell, index) => (
                    <td key={index} className={`px-3 py-2 ${index ? 'text-right tabular-nums' : 'font-medium'}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One step of "de onde vem o resultado": the value, how it moved, and a bar sized against what customers paid. */
function FlowRow({ label, value, previous, base, color, kind = 'up-good', strong = false, negative = false }: { label: string; value: number; previous: number; base: number; color: string; kind?: ChipKind; strong?: boolean; negative?: boolean }) {
  const width = base > 0 ? Math.max(value ? 1.5 : 0, Math.min(100, (Math.abs(value) / base) * 100)) : 0;
  return (
    <li className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
          <span className={strong ? 'font-semibold' : ''}>{label}</span>
          <Chip value={change(value, previous)} kind={kind} />
        </span>
        <span className={`shrink-0 tabular-nums ${strong ? 'font-semibold' : ''}`}>
          {negative && value > 0 ? '− ' : ''}
          {formatCurrency(value)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
    </li>
  );
}

type Sort = { key: string; dir: 1 | -1 };

function SortHeader({ label, k, sort, onSort, align = 'right' }: { label: string; k: string; sort: Sort; onSort: (key: string) => void; align?: 'left' | 'right' }) {
  const active = sort.key === k;
  return (
    <th className={`py-2.5 pr-3 font-medium last:pr-0 ${align === 'right' ? 'text-right' : 'text-left'}`} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 hover:text-foreground ${active ? 'text-foreground' : ''}`}>
        {label}
        {active ? <span aria-hidden="true">{sort.dir === 1 ? '↑' : '↓'}</span> : null}
      </button>
    </th>
  );
}

function useSort(initial: string) {
  const [sort, setSort] = useState<Sort>({ key: initial, dir: -1 });
  const toggle = (key: string) => setSort((current) => (current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 }));
  return [sort, toggle] as const;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input className={inputClass('h-11 pl-9 text-base sm:text-sm')} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

// ---------------------------------------------------------------- tab

export function FinanceTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [month, setMonth] = useState(currentMonthKey());
  const [year, setYear] = useState(currentMonthKey().slice(0, 4));
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<View>('overview');
  const catalog = useParts<CatalogResponse>('/api/parts');

  const url = `/api/parts/finance?${new URLSearchParams({
    mode,
    ...(mode === 'year' ? { year } : { month }),
    ...(selected.length ? { technicianIds: selected.join(',') } : {}),
  }).toString()}`;
  const { data, error, loading, reload } = useParts<{ report: FinanceReport }>(url);
  const report = data?.report;

  // The numbers refresh by themselves every minute while the tab is open.
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  const years = Array.from({ length: 5 }, (_, index) => String(Number(currentMonthKey().slice(0, 4)) - index));
  const versus = mode === 'year' ? 'ano anterior' : 'mês anterior';
  const periodLabel = mode === 'year' ? year : formatMonthLabel(month);
  const inProgress = mode === 'year' ? year === currentMonthKey().slice(0, 4) : month === currentMonthKey();
  const comparison = mode === 'year' ? `Comparativo com ${Number(year) - 1}` : `Comparativo com ${formatMonthLabel(addMonths(month, -1))}`;
  const technicians = (catalog.data?.technicians ?? []).filter((technician) => technician.status === 'active' || selected.includes(technician.id));
  const activeTechnicians = (catalog.data?.technicians ?? []).filter((technician) => technician.status === 'active').length;

  function toggleTechnician(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function exportSheet() {
    if (!report) return;
    const { current, previous, position } = report;
    const book = XLSX.utils.book_new();
    const row = (name: string, now: number, before?: number) => ({ Indicador: name, Período: now, ...(before === undefined ? {} : { 'Período anterior': before }) });
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet([
        row('Faturamento (a receber dos técnicos)', current.revenue, previous.revenue),
        row('Custo das peças vendidas', current.cost, previous.cost),
        row('Lucro bruto', current.profit, previous.profit),
        row('Vendido aos clientes', current.sold, previous.sold),
        row('Ganho dos técnicos', current.technicianGain, previous.technicianGain),
        row('Vendas (quantidade)', current.sales, previous.sales),
        row('Unidades vendidas', current.units, previous.units),
        row('Recebido dos técnicos', current.received, previous.received),
        row('Compras (saída de caixa)', current.purchases, previous.purchases),
        row('Resultado de caixa', current.cashResult, previous.cashResult),
        row('Perdas por faltas assumidas', current.losses, previous.losses),
        row('Resultado após perdas', current.netResult, previous.netResult),
        row('Saldo em aberto (posição)', position.balanceDue),
        row('Estoque central (custo)', position.centralCost),
        row('Estoque com técnicos (custo)', position.technicianCost),
        row('Estoque com técnicos (preço de técnico)', position.technicianValue),
      ]),
      'Resumo',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.series.map((item) => ({ Mês: item.month, Faturamento: item.revenue, Custo: item.cost, Lucro: item.profit, 'Vendido aos clientes': item.sold, Recebido: item.received, Compras: item.purchases }))),
      'Mensal',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.technicians.map((item) => ({ Técnico: item.name, Vendas: item.sales, 'Vendido aos clientes': item.sold, Faturamento: item.revenue, 'Lucro gerado': item.profit, Recebido: item.received, 'Saldo em aberto': item.balanceDue }))),
      'Técnicos',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.parts.map((item) => ({ Peça: item.name, Unidades: item.units, Faturamento: item.revenue, Custo: item.cost, Lucro: item.profit }))),
      'Peças',
    );
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.json_to_sheet(report.recentPayments.map((item) => ({ Data: formatDateTime(item.createdAt), Técnico: item.technicianName, Forma: METHOD_LABELS[item.method], Valor: item.amount, Observação: item.description }))),
      'Recebimentos',
    );
    XLSX.writeFile(book, `financeiro-pecas-${mode === 'year' ? year : month}${selected.length ? '-filtrado' : ''}.xlsx`);
  }

  return (
    <div className="grid gap-6">
      {/* filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <div className="flex rounded-lg bg-muted p-1" role="group" aria-label="Período">
          {([['month', 'Mensal'], ['year', 'Anual']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`min-h-9 rounded-md px-4 text-sm font-medium transition ${mode === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {mode === 'month' ? (
            <input type="month" className={inputClass('h-11 w-auto text-base sm:text-sm')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
          ) : (
            <select className={inputClass('h-11 w-auto text-base sm:text-sm')} value={year} onChange={(event) => setYear(event.target.value)} aria-label="Ano">
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {report ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Atualizado às {new Date(report.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="lg" className="h-11">
                <Filter className="h-4 w-4" />
                Filtros{selected.length ? ` (${selected.length})` : ''}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Técnicos</p>
                <button type="button" className="text-xs font-medium text-primary hover:underline disabled:opacity-40" onClick={() => setSelected([])} disabled={!selected.length}>
                  Limpar
                </button>
              </div>
              <ul className="max-h-64 overflow-y-auto">
                {technicians.map((technician) => (
                  <li key={technician.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/60">
                      <Checkbox checked={selected.includes(technician.id)} onCheckedChange={() => toggleTechnician(technician.id)} />
                      <span className="min-w-0 flex-1 truncate">{technician.name}</span>
                    </label>
                  </li>
                ))}
                {!technicians.length ? <li className="px-2 py-3 text-sm text-muted-foreground">Nenhum técnico.</li> : null}
              </ul>
              <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">Compras e estoque central são da empresa toda e ficam de fora quando há técnicos selecionados.</p>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="icon" className="h-11 w-11" onClick={reload} aria-label="Atualizar agora">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="lg" className="h-11" onClick={exportSheet} disabled={!report}>
            <Download className="h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {/* sub-tabs */}
      <div className="flex flex-wrap items-end justify-between gap-x-4 border-b">
        <div role="tablist" aria-label="Seções do financeiro" className="flex flex-wrap">
          {VIEWS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-medium transition ${view === value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <p className="pb-3 text-xs capitalize text-muted-foreground">{periodLabel}</p>
      </div>

      {!report ? (
        loading ? <Spinner /> : null
      ) : view === 'overview' ? (
        <Overview report={report} versus={versus} comparison={`${comparison}${inProgress ? ' · período atual em andamento' : ''}`} periodLabel={periodLabel} mode={mode} year={year} onNavigate={onNavigate} />
      ) : view === 'technicians' ? (
        <TechniciansView report={report} periodLabel={periodLabel} activeTechnicians={activeTechnicians} />
      ) : view === 'parts' ? (
        <PartsView report={report} periodLabel={periodLabel} versus={versus} />
      ) : (
        <CashView report={report} periodLabel={periodLabel} versus={versus} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- views

function Overview({ report, versus, comparison, periodLabel, mode, year, onNavigate }: { report: FinanceReport; versus: string; comparison: string; periodLabel: string; mode: 'month' | 'year'; year: string; onNavigate?: (tab: string) => void }) {
  const { current, previous, position, series } = report;
  const methodTotal = report.receivedByMethod.reduce((sum, item) => sum + item.amount, 0);
  const cashCells = [
    ...(report.filtered ? [] : [{ label: 'Compras de peças', value: formatCurrency(current.purchases), icon: PackagePlus, chip: <Chip value={change(current.purchases, previous.purchases)} kind="neutral" />, hint: 'entradas no central' }]),
    ...(report.filtered ? [] : [{ label: 'Resultado de caixa', value: formatCurrency(current.cashResult), icon: Wallet, chip: <Chip value={change(current.cashResult, previous.cashResult)} />, hint: 'recebido − compras' }]),
    ...(report.filtered ? [] : [{ label: 'Estoque central', value: formatCurrency(position.centralCost), icon: Boxes, hint: `${formatNumber(position.centralUnits)} un. a custo` }]),
    { label: 'Com os técnicos', value: formatCurrency(position.technicianCost), icon: Truck, hint: `${formatNumber(position.technicianUnits)} un. · a receber ${formatCurrency(position.technicianValue)}` },
    ...(report.filtered ? [{ label: 'Perdas por faltas', value: formatCurrency(current.losses), icon: TriangleAlert, chip: <Chip value={change(current.losses, previous.losses)} kind="up-bad" />, hint: 'assumidas pela empresa' }] : []),
  ];

  return (
    <div className="grid gap-8">
      <Section number="01" title="Um olhar para o resultado" aside={comparison}>
        {report.filtered ? <Banner>Mostrando só os técnicos selecionados. Compras e estoque central, que são da empresa toda, ficam de fora.</Banner> : null}
        {position.balanceDue > 0 ? (
          <Banner action="Ver acerto" onAction={onNavigate ? () => onNavigate('account') : undefined}>
            {formatCurrency(position.balanceDue)} em saldo em aberto com {position.debtors} técnico(s). O lucro só vira caixa quando eles pagam.
          </Banner>
        ) : null}
        {position.awaitingCount > 0 ? (
          <Banner action="Ver vendas" onAction={onNavigate ? () => onNavigate('sales') : undefined}>
            {position.awaitingCount} venda(s) esperando o cliente pagar ({formatCurrency(position.awaitingAmount)}).
          </Banner>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Hero label="Faturamento" value={formatCurrency(current.revenue)} icon={Wallet} chip={<Chip value={change(current.revenue, previous.revenue)} />} hint={`${current.sales} venda(s)`} />
          <Hero
            dark
            label="Lucro bruto"
            value={formatCurrency(current.profit)}
            icon={TrendingUp}
            tone={current.profit < 0 ? 'danger' : undefined}
            chip={<Chip dark value={change(current.profit, previous.profit)} />}
            hint={current.margin === null ? 'sem vendas' : `${formatPercent(current.margin * 100)} de margem`}
          />
          <Hero label="Recebido dos técnicos" value={formatCurrency(current.received)} icon={Banknote} chip={<Chip value={change(current.received, previous.received)} />} hint="pagamentos no Acerto" />
          <Hero label="Saldo em aberto" value={formatCurrency(position.balanceDue)} icon={Coins} tone={position.balanceDue > 0 ? 'danger' : undefined} hint={position.debtors ? `${position.debtors} técnico(s) devem` : 'todos em dia'} />
        </div>

        <Strip
          cells={[
            { label: 'Vendas', value: formatNumber(current.sales), icon: ShoppingCart, chip: <Chip value={change(current.sales, previous.sales)} /> },
            { label: 'Vendido aos clientes', value: formatCurrency(current.sold), icon: Layers3, chip: <Chip value={change(current.sold, previous.sold)} />, hint: `ticket ${formatCurrency(current.averageTicket)}` },
            { label: 'Peças vendidas', value: `${formatNumber(current.units)} un.`, icon: Package, chip: <Chip value={change(current.units, previous.units)} /> },
          ]}
        />
      </Section>

      <Section number="02" title="Evolução e origem do resultado" aside={mode === 'year' ? `Mês a mês em ${year}` : 'Últimos 12 meses'}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Panel
            title="A evolução do resultado"
            description="Faturamento, custo das peças e lucro bruto"
            tag="Por competência"
            legend={[
              { label: 'Faturamento', color: C.income },
              { label: 'Custo das peças', color: C.expense },
              { label: 'Lucro bruto', color: C.result },
            ]}
            columns={['Mês', 'Faturamento', 'Custo', 'Lucro']}
            rows={series.map((item) => [shortMonth(item.month), money(item.revenue), money(item.cost), money(item.profit)])}
            empty={!series.some((item) => item.revenue || item.cost)}
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series.map((item) => ({ ...item, label: shortMonth(item.month) }))} margin={{ top: 12, right: 8, left: 0, bottom: 5 }} accessibilityLayer>
                  <defs>
                    <linearGradient id="fin-income-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.income} stopOpacity={0.17} />
                      <stop offset="100%" stopColor={C.income} stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
                  <XAxis dataKey="label" {...axis} dy={8} />
                  <YAxis {...axis} tickFormatter={compact} width={64} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} />
                  <ReferenceLine y={0} stroke="#dedde9" />
                  <Area type="monotone" dataKey="revenue" name="Faturamento" stroke={C.income} strokeWidth={2.5} fill="url(#fin-income-fill)" dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: C.income }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cost" name="Custo das peças" stroke={C.expense} strokeWidth={2} dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: C.expense }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="profit" name="Lucro bruto" stroke={C.result} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: C.result }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="De onde vem o resultado" description="Do que o cliente pagou ao que fica na empresa" empty={!current.sold && !current.losses}>
            <ul className="grid gap-4">
              <FlowRow label="Vendido aos clientes" value={current.sold} previous={previous.sold} base={current.sold} color={C.other} />
              <FlowRow label="Fica com os técnicos" value={current.technicianGain} previous={previous.technicianGain} base={current.sold} color={C.other} kind="neutral" negative />
              <FlowRow label="Faturamento da empresa" value={current.revenue} previous={previous.revenue} base={current.sold} color={C.income} strong />
              <FlowRow label="Custo das peças" value={current.cost} previous={previous.cost} base={current.sold} color={C.expense} kind="neutral" negative />
              <FlowRow label="Lucro bruto" value={current.profit} previous={previous.profit} base={current.sold} color={C.result} strong />
              <FlowRow label="Perdas por faltas" value={current.losses} previous={previous.losses} base={current.sold} color={C.alert} kind="up-bad" negative />
              <FlowRow label="Resultado após perdas" value={current.netResult} previous={previous.netResult} base={current.sold} color={C.result} strong />
            </ul>
          </Panel>
        </div>
      </Section>

      <Section number="03" title="Caixa e estoque" aside={`Posição ${report.asOf === report.period.to ? `em ${shortMonth(report.asOf)}` : 'de hoje'}`}>
        <Strip cells={cashCells.slice(0, 4)} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CashChart report={report} />
          <MethodsPanel report={report} methodTotal={methodTotal} periodLabel={periodLabel} />
        </div>
      </Section>

      <Method />
    </div>
  );
}

function CashChart({ report }: { report: FinanceReport }) {
  const series = report.series;
  return (
    <Panel
      title="Entradas e saídas de caixa"
      description="O que os técnicos pagaram e o que a empresa gastou em compras"
      tag="Por caixa"
      legend={[
        { label: 'Recebido dos técnicos', color: C.income },
        { label: 'Compras de peças', color: C.expense },
      ]}
      columns={['Mês', 'Recebido', 'Compras', 'Resultado']}
      rows={series.map((item) => [shortMonth(item.month), money(item.received), money(item.purchases), money(item.received - item.purchases)])}
      empty={!series.some((item) => item.received || item.purchases)}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series.map((item) => ({ ...item, label: shortMonth(item.month) }))} margin={{ top: 8, right: 8, left: 0, bottom: 5 }} barGap={2} accessibilityLayer>
            <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" vertical={false} />
            <XAxis dataKey="label" {...axis} dy={8} />
            <YAxis {...axis} tickFormatter={compact} width={64} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} cursor={{ fill: '#f4f3fa' }} />
            <ReferenceLine y={0} stroke="#dedde9" />
            <Bar dataKey="received" name="Recebido dos técnicos" fill={C.income} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Bar dataKey="purchases" name="Compras de peças" fill={C.expense} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function MethodsPanel({ report, methodTotal, periodLabel }: { report: FinanceReport; methodTotal: number; periodLabel: string }) {
  return (
    <Panel
      title="Como os técnicos pagaram"
      description={`Recebido em ${periodLabel}, por forma de pagamento`}
      columns={['Forma', 'Valor', '%']}
      rows={report.receivedByMethod.map((item) => [METHOD_LABELS[item.method], money(item.amount), formatPercent((item.amount / (methodTotal || 1)) * 100)])}
      empty={!methodTotal}
    >
      <div className="grid items-center gap-4 sm:grid-cols-2">
        <div className="relative mx-auto h-52 w-full max-w-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={report.receivedByMethod} dataKey="amount" nameKey="method" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                {report.receivedByMethod.map((item) => (
                  <Cell key={item.method} fill={METHOD_COLORS[item.method]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(value, _name, entry) => [money(value), METHOD_LABELS[(entry?.payload?.method ?? 'other') as keyof typeof METHOD_LABELS]]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-base font-semibold tabular-nums">{formatCurrency(methodTotal)}</p>
          </div>
        </div>
        <ul className="grid gap-2 text-sm">
          {report.receivedByMethod.map((item) => (
            <li key={item.method} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: METHOD_COLORS[item.method] }} aria-hidden="true" />
                {METHOD_LABELS[item.method]}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatCurrency(item.amount)} · {formatPercent((item.amount / (methodTotal || 1)) * 100)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function TechniciansView({ report, periodLabel, activeTechnicians }: { report: FinanceReport; periodLabel: string; activeTechnicians: number }) {
  const [search, setSearch] = useState('');
  const [sort, onSort] = useSort('revenue');
  const withSales = report.technicians.filter((item) => item.sales > 0);
  const revenue = report.technicians.reduce((sum, item) => sum + item.revenue, 0);
  const received = report.technicians.reduce((sum, item) => sum + item.received, 0);
  const top = [...report.technicians].sort((a, b) => b.balanceDue - a.balanceDue)[0];

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const value: Record<string, (item: (typeof report.technicians)[number]) => number | string> = {
      name: (item) => item.name,
      sales: (item) => item.sales,
      sold: (item) => item.sold,
      revenue: (item) => item.revenue,
      profit: (item) => item.profit,
      received: (item) => item.received,
      balanceDue: (item) => item.balanceDue,
    };
    return report.technicians
      .filter((item) => !term || item.name.toLowerCase().includes(term))
      .sort((a, b) => {
        const x = value[sort.key](a);
        const y = value[sort.key](b);
        return (typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y)) * sort.dir;
      });
  }, [report, search, sort]);
  const maxOpen = Math.max(1, ...report.technicians.map((item) => item.balanceDue));
  const chart = [...report.technicians]
    .filter((item) => item.revenue > 0 || item.balanceDue > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map((item) => ({ name: item.name.split(' ').slice(0, 2).join(' '), full: item.name, revenue: item.revenue, open: Math.max(0, item.balanceDue) }));

  return (
    <div className="grid gap-8">
      <Section number="01" title="Técnicos" aside={periodLabel}>
        <Strip
          cells={[
            { label: 'Técnicos com vendas', value: `${withSales.length}${activeTechnicians ? ` de ${activeTechnicians}` : ''}`, icon: Users },
            { label: 'Faturamento médio', value: formatCurrency(withSales.length ? revenue / withSales.length : 0), icon: Wallet, hint: 'por técnico com vendas' },
            { label: 'Maior saldo em aberto', value: formatCurrency(Math.max(0, top?.balanceDue ?? 0)), icon: TriangleAlert, hint: top && top.balanceDue > 0 ? top.name : 'ninguém deve' },
            { label: 'Recebido ÷ faturamento', value: revenue > 0 ? formatPercent((received / revenue) * 100) : '—', icon: Banknote, hint: 'no período' },
          ]}
        />
        <Panel
          title="Faturamento e saldo em aberto"
          description="Os 8 que mais faturaram no período"
          legend={[
            { label: 'Faturamento do período', color: C.income },
            { label: 'Saldo em aberto', color: C.alert },
          ]}
          columns={['Técnico', 'Faturamento', 'Saldo em aberto']}
          rows={chart.map((item) => [item.full, money(item.revenue), money(item.open)])}
          empty={!chart.length}
        >
          <div style={{ height: Math.max(220, chart.length * 52 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }} barGap={2} accessibilityLayer>
                <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={compact} />
                <YAxis type="category" dataKey="name" {...axis} width={96} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} labelFormatter={(label, items) => items?.[0]?.payload?.full ?? label} cursor={{ fill: '#f4f3fa' }} />
                <Bar dataKey="revenue" name="Faturamento do período" fill={C.income} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
                <Bar dataKey="open" name="Saldo em aberto" fill={C.alert} radius={[0, 4, 4, 0]} maxBarSize={12} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </Section>

      <Section number="02" title="Detalhe por técnico" aside="Toque no título da coluna para ordenar">
        <section className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
          <SearchBox value={search} onChange={setSearch} placeholder="Buscar técnico" />
          {!rows.length ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum técnico encontrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-190 text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <SortHeader label="Técnico" k="name" sort={sort} onSort={onSort} align="left" />
                    <SortHeader label="Vendas" k="sales" sort={sort} onSort={onSort} />
                    <SortHeader label="Vendido aos clientes" k="sold" sort={sort} onSort={onSort} />
                    <SortHeader label="Faturamento" k="revenue" sort={sort} onSort={onSort} />
                    <SortHeader label="Lucro gerado" k="profit" sort={sort} onSort={onSort} />
                    <SortHeader label="Recebido" k="received" sort={sort} onSort={onSort} />
                    <SortHeader label="Saldo em aberto" k="balanceDue" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-3 pr-3 font-medium">{item.name}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{item.sales}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(item.sold)}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(item.revenue)}</td>
                      <td className={`py-3 pr-3 text-right tabular-nums ${item.profit < 0 ? 'text-rose-700' : ''}`}>{formatCurrency(item.profit)}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(item.received)}</td>
                      <td className="py-3 text-right">
                        <span className={`font-semibold tabular-nums ${item.balanceDue > 0 ? 'text-rose-700' : ''}`}>{formatCurrency(item.balanceDue)}</span>
                        {item.balanceDue > 0 ? (
                          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                            <span className="block h-full rounded-full" style={{ width: `${(item.balanceDue / maxOpen) * 100}%`, background: C.alert }} />
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Section>
      <Method />
    </div>
  );
}

function PartsView({ report, periodLabel, versus }: { report: FinanceReport; periodLabel: string; versus: string }) {
  const [search, setSearch] = useState('');
  const [sort, onSort] = useSort('profit');
  const { current, previous } = report;
  const totalProfit = report.parts.reduce((sum, item) => sum + item.profit, 0);
  const topThree = report.parts.slice(0, 3).reduce((sum, item) => sum + item.profit, 0);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const value: Record<string, (item: (typeof report.parts)[number]) => number | string> = {
      name: (item) => item.name,
      units: (item) => item.units,
      revenue: (item) => item.revenue,
      cost: (item) => item.cost,
      profit: (item) => item.profit,
      margin: (item) => (item.revenue > 0 ? item.profit / item.revenue : 0),
    };
    return report.parts
      .filter((item) => !term || item.name.toLowerCase().includes(term))
      .sort((a, b) => {
        const x = value[sort.key](a);
        const y = value[sort.key](b);
        return (typeof x === 'string' ? x.localeCompare(String(y)) : Number(x) - Number(y)) * sort.dir;
      });
  }, [report, search, sort]);
  const chart = report.parts.slice(0, 8).map((item) => ({ ...item, short: item.name.length > 16 ? `${item.name.slice(0, 15)}…` : item.name }));

  return (
    <div className="grid gap-8">
      <Section number="01" title="Peças" aside={`${periodLabel} · comparado com o ${versus}`}>
        <Strip
          cells={[
            { label: 'Peças diferentes vendidas', value: formatNumber(report.parts.length), icon: Package },
            { label: 'Unidades vendidas', value: formatNumber(current.units), icon: ShoppingCart, chip: <Chip value={change(current.units, previous.units)} /> },
            { label: 'Margem média', value: current.margin === null ? '—' : formatPercent(current.margin * 100), icon: TrendingUp, hint: 'lucro ÷ faturamento' },
            { label: 'Concentração', value: totalProfit > 0 ? formatPercent((topThree / totalProfit) * 100) : '—', icon: Layers3, hint: 'do lucro nas 3 primeiras' },
          ]}
        />
        <Panel
          title="Peças que mais deram lucro"
          description="Lucro da empresa por peça vendida no período"
          columns={['Peça', 'Unidades', 'Faturamento', 'Lucro']}
          rows={chart.map((item) => [item.name, item.units, money(item.revenue), money(item.profit)])}
          empty={!chart.length}
        >
          <div style={{ height: Math.max(220, chart.length * 40 + 30) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 64, left: 0, bottom: 4 }} accessibilityLayer>
                <CartesianGrid stroke="#eeedf4" strokeDasharray="4 5" horizontal={false} />
                <XAxis type="number" {...axis} tickFormatter={compact} />
                <YAxis type="category" dataKey="short" {...axis} width={96} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => money(value)} labelFormatter={(label, items) => items?.[0]?.payload?.name ?? label} cursor={{ fill: '#f4f3fa' }} />
                <Bar dataKey="profit" name="Lucro da empresa" fill={C.result} radius={[0, 4, 4, 0]} maxBarSize={16} isAnimationActive={false}>
                  <LabelList dataKey="profit" position="right" formatter={(value: unknown) => money(value)} style={{ fill: '#252337', fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </Section>

      <Section number="02" title="Detalhe por peça" aside="Toque no título da coluna para ordenar">
        <section className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
          <SearchBox value={search} onChange={setSearch} placeholder="Buscar peça" />
          {!rows.length ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma peça vendida no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-170 text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <SortHeader label="Peça" k="name" sort={sort} onSort={onSort} align="left" />
                    <SortHeader label="Unidades" k="units" sort={sort} onSort={onSort} />
                    <SortHeader label="Faturamento" k="revenue" sort={sort} onSort={onSort} />
                    <SortHeader label="Custo" k="cost" sort={sort} onSort={onSort} />
                    <SortHeader label="Lucro" k="profit" sort={sort} onSort={onSort} />
                    <SortHeader label="Margem" k="margin" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-3 pr-3 font-medium wrap-anywhere">{item.name}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{item.units}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(item.revenue)}</td>
                      <td className="py-3 pr-3 text-right tabular-nums">{formatCurrency(item.cost)}</td>
                      <td className={`py-3 pr-3 text-right font-semibold tabular-nums ${item.profit < 0 ? 'text-rose-700' : ''}`}>{formatCurrency(item.profit)}</td>
                      <td className="py-3 text-right tabular-nums">{item.revenue > 0 ? formatPercent((item.profit / item.revenue) * 100) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </Section>
      <Method />
    </div>
  );
}

function CashView({ report, periodLabel, versus }: { report: FinanceReport; periodLabel: string; versus: string }) {
  const { current, previous, series } = report;
  const methodTotal = report.receivedByMethod.reduce((sum, item) => sum + item.amount, 0);
  let running = 0;
  const monthly = series.map((item) => {
    running += item.received - item.purchases;
    return { ...item, result: item.received - item.purchases, accumulated: running };
  });

  return (
    <div className="grid gap-8">
      <Section number="01" title="Caixa" aside={`${periodLabel} · comparado com o ${versus}`}>
        {report.filtered ? <Banner>Com técnicos selecionados, só os recebimentos entram. As compras são da empresa toda.</Banner> : null}
        <Strip
          cells={[
            { label: 'Recebido dos técnicos', value: formatCurrency(current.received), icon: Banknote, chip: <Chip value={change(current.received, previous.received)} /> },
            ...(report.filtered
              ? []
              : [
                  { label: 'Compras de peças', value: formatCurrency(current.purchases), icon: PackagePlus, chip: <Chip value={change(current.purchases, previous.purchases)} kind="neutral" /> },
                  { label: 'Resultado de caixa', value: formatCurrency(current.cashResult), icon: Wallet, chip: <Chip value={change(current.cashResult, previous.cashResult)} /> },
                  { label: 'Acumulado na janela', value: formatCurrency(monthly[monthly.length - 1]?.accumulated ?? 0), icon: Coins, hint: 'recebido − compras' },
                ]),
          ]}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <CashChart report={report} />
          <MethodsPanel report={report} methodTotal={methodTotal} periodLabel={periodLabel} />
        </div>
      </Section>

      <Section number="02" title="Últimos recebimentos" aside={`Em ${periodLabel}`}>
        <section className="grid gap-3 rounded-xl border bg-card p-4 sm:p-5">
          {!report.recentPayments.length ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum pagamento registrado no período.</p>
          ) : (
            <ul className="divide-y">
              {report.recentPayments.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{item.technicianName}</p>
                    <p className="text-xs text-muted-foreground wrap-anywhere">
                      {formatDateTime(item.createdAt)} · {METHOD_LABELS[item.method]}
                      {item.description ? ` · ${item.description}` : ''}
                    </p>
                  </div>
                  <span className="text-base font-semibold tabular-nums text-emerald-700">+ {formatCurrency(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Section>

      <Section number="03" title="Mês a mês" aside="Caixa acumulado sobre a janela mostrada">
        <section className="overflow-x-auto rounded-xl border bg-card p-4 sm:p-5">
          <table className="w-full min-w-130 text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2.5 pr-3 font-medium">Mês</th>
                <th className="py-2.5 pr-3 text-right font-medium">Recebido</th>
                <th className="py-2.5 pr-3 text-right font-medium">Compras</th>
                <th className="py-2.5 pr-3 text-right font-medium">Resultado</th>
                <th className="py-2.5 text-right font-medium">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((item) => (
                <tr key={item.month} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium capitalize">{shortMonth(item.month)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(item.received)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatCurrency(item.purchases)}</td>
                  <td className={`py-2.5 pr-3 text-right tabular-nums ${item.result < 0 ? 'text-rose-700' : ''}`}>{formatCurrency(item.result)}</td>
                  <td className={`py-2.5 text-right font-semibold tabular-nums ${item.accumulated < 0 ? 'text-rose-700' : ''}`}>{formatCurrency(item.accumulated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </Section>
      <Method />
    </div>
  );
}

function Method() {
  return (
    <details className="rounded-xl border bg-card px-4 py-3.5 text-sm">
      <summary className="cursor-pointer select-none font-medium">Como os números são calculados</summary>
      <ul className="mt-3 grid gap-1.5 text-muted-foreground">
        <li>
          <strong className="text-foreground">Vendas</strong> contam pelo mês em que foram feitas, sem as canceladas.
        </li>
        <li>
          <strong className="text-foreground">Faturamento</strong> é o preço de técnico: o que os técnicos devem à empresa. <strong className="text-foreground">Vendido aos clientes</strong> é o que o cliente pagou; a diferença fica com o técnico.
        </li>
        <li>
          <strong className="text-foreground">Lucro bruto</strong> = faturamento − custo das peças vendidas (o custo de cada venda fica guardado no momento da venda).
        </li>
        <li>
          <strong className="text-foreground">Recebido</strong> são os pagamentos registrados no Acerto, no dia do registro. <strong className="text-foreground">Compras</strong> são as entradas no estoque central × o custo de cada uma.
        </li>
        <li>
          <strong className="text-foreground">Perdas</strong> são as faltas de inventário que a empresa assumiu (estoque central, ou faltas que ela decidiu não cobrar), pelo custo atual da peça. <strong className="text-foreground">Resultado após perdas</strong> = lucro bruto − perdas.
        </li>
        <li>
          <strong className="text-foreground">Saldo em aberto</strong> e <strong className="text-foreground">estoque</strong> são uma posição, não um total do período. Parcelas de meses futuros não entram no saldo.
        </li>
        <li>Não há impostos, taxas de pagamento nem despesas gerais, porque o sistema não guarda esses valores: o lucro é bruto.</li>
      </ul>
    </details>
  );
}
