'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Download, Loader2, PackagePlus, Search, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import type { MovementKind } from '@/lib/parts/types';
import { Alert, Field, formatDateTime, inputClass, partsApi, Spinner, useParts } from '../shared';
import type { CatalogResponse } from './catalog-tab';

interface MovementRow {
  id: string;
  partId: string;
  partName: string;
  technicianId: string | null;
  technicianName: string | null;
  quantity: number;
  kind: MovementKind;
  kindLabel: string;
  transferNumber: number | null;
  saleNumber: number | null;
  inventoryNumber: number | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

interface MovementSummary {
  purchased: number;
  sent: number;
  returned: number;
  sold: number;
  adjusted: number;
}

interface MovementPage {
  movements: MovementRow[];
  total: number;
  summary: MovementSummary;
}

type Group = '' | 'purchase' | 'transfer' | 'sale' | 'adjustment' | 'inventory';

const GROUPS: Array<[Group, string]> = [
  ['', 'Todas'],
  ['purchase', 'Compras'],
  ['transfer', 'Remessas e devoluções'],
  ['sale', 'Vendas'],
  ['adjustment', 'Ajustes'],
  ['inventory', 'Inventário'],
];

const PAGE_SIZE = 50;

function isoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

/** Quick periods. "Tudo" leaves both dates empty. */
const PERIODS: Array<{ key: string; label: string; range: () => [string, string] }> = [
  { key: 'today', label: 'Hoje', range: () => [daysAgo(0), daysAgo(0)] },
  { key: '7', label: '7 dias', range: () => [daysAgo(6), daysAgo(0)] },
  { key: '30', label: '30 dias', range: () => [daysAgo(29), daysAgo(0)] },
  {
    key: 'month',
    label: 'Este mês',
    range: () => {
      const now = new Date();
      return [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), daysAgo(0)];
    },
  },
  { key: 'all', label: 'Tudo', range: () => ['', ''] },
];

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = isoDate(new Date());
  const that = isoDate(date);
  if (that === today) return 'Hoje';
  if (that === daysAgo(1)) return 'Ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function referenceOf(row: MovementRow) {
  if (row.saleNumber) return `Venda nº ${row.saleNumber}`;
  if (row.transferNumber) return `Termo nº ${row.transferNumber}`;
  if (row.inventoryNumber) return `Inventário nº ${row.inventoryNumber}`;
  return null;
}

export function MovementsTab() {
  const catalog = useParts<CatalogResponse>('/api/parts');
  const [period, setPeriod] = useState('30');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [where, setWhere] = useState('');
  const [group, setGroup] = useState<Group>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<MovementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useCallback(
    (offset: number, limit: number) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (group) params.set('group', group);
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (where === 'central') params.set('central', '1');
      else if (where) params.set('technicianId', where);
      return `/api/parts/movements?${params.toString()}`;
    },
    [from, to, group, debouncedSearch, where],
  );

  // A new filter restarts from the first page; an older answer arriving late is ignored.
  useEffect(() => {
    const current = ++requestId.current;
    setLoading(true);
    setError('');
    partsApi<MovementPage>(query(0, PAGE_SIZE))
      .then((page) => {
        if (current !== requestId.current) return;
        setRows(page.movements);
        setTotal(page.total);
        setSummary(page.summary);
      })
      .catch((reason) => {
        if (current === requestId.current) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
  }, [query]);

  async function loadMore() {
    const current = requestId.current;
    setLoadingMore(true);
    try {
      const page = await partsApi<MovementPage>(query(rows.length, PAGE_SIZE));
      if (current !== requestId.current) return;
      setRows((existing) => [...existing, ...page.movements]);
      setTotal(page.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  async function exportSheet() {
    setExporting(true);
    try {
      const page = await partsApi<MovementPage>(query(0, 500));
      const sheetRows = page.movements.map((row) => ({
        Data: formatDateTime(row.createdAt),
        Peça: row.partName,
        Tipo: row.kindLabel,
        Local: row.technicianName ?? 'Estoque central',
        Quantidade: row.quantity,
        Referência: referenceOf(row) ?? '',
        Observação: row.note ?? '',
        'Registrado por': row.createdByName ?? '',
      }));
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheetRows), 'Movimentações');
      XLSX.writeFile(book, `movimentacoes-pecas-${from || 'inicio'}-a-${to || 'hoje'}.xlsx`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }

  function pickPeriod(key: string) {
    const [start, end] = PERIODS.find((item) => item.key === key)!.range();
    setPeriod(key);
    setFrom(start);
    setTo(end);
  }

  const tiles: Array<{ label: string; value: number; hint: string; icon: typeof PackagePlus; signed?: boolean }> = [
    { label: 'Compras', value: summary?.purchased ?? 0, hint: 'entraram no estoque central', icon: PackagePlus },
    { label: 'Enviadas', value: summary?.sent ?? 0, hint: 'do central para os técnicos', icon: ArrowUpFromLine },
    { label: 'Devolvidas', value: summary?.returned ?? 0, hint: 'dos técnicos para o central', icon: ArrowDownToLine },
    { label: 'Vendidas', value: summary?.sold ?? 0, hint: 'pelos técnicos (líquido)', icon: ShoppingCart },
    { label: 'Ajustes', value: summary?.adjusted ?? 0, hint: 'manuais e do inventário', icon: SlidersHorizontal, signed: true },
  ];

  // Rows come newest first; a heading marks each new day.
  let lastDay = '';

  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted-foreground">Tudo o que entrou e saiu de qualquer estoque, do central e dos técnicos. Nada é apagado.</p>

      <section className="grid gap-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Período">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => pickPeriod(item.key)}
              aria-pressed={period === item.key}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${period === item.key ? 'border-primary bg-primary/5 font-medium text-primary' : 'text-muted-foreground hover:border-primary/40'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="De">
            <input
              type="date"
              className={inputClass('h-11 text-base sm:text-sm')}
              value={from}
              max={to || undefined}
              onChange={(event) => {
                setFrom(event.target.value);
                setPeriod('custom');
              }}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              className={inputClass('h-11 text-base sm:text-sm')}
              value={to}
              min={from || undefined}
              onChange={(event) => {
                setTo(event.target.value);
                setPeriod('custom');
              }}
            />
          </Field>
          <Field label="Local">
            <select className={inputClass('h-11 text-base sm:text-sm')} value={where} onChange={(event) => setWhere(event.target.value)}>
              <option value="">Todos os locais</option>
              <option value="central">Estoque central</option>
              {(catalog.data?.technicians ?? []).map((technician) => (
                <option key={technician.id} value={technician.id}>
                  Carro de {technician.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Buscar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input className={inputClass('h-11 pl-9 text-base sm:text-sm')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Peça ou observação" />
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipo de movimentação">
          {GROUPS.map(([value, label]) => (
            <button
              key={value || 'all'}
              type="button"
              onClick={() => setGroup(value)}
              aria-pressed={group === value}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${group === value ? 'border-primary bg-primary/5 font-medium text-primary' : 'text-muted-foreground hover:border-primary/40'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map(({ label, value, hint, icon: Icon, signed }) => (
          <div key={label} className="rounded-xl border bg-card p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${signed && value < 0 ? 'text-rose-700' : ''}`}>
              {signed && value > 0 ? '+' : ''}
              {value}
              <span className="ml-1 text-sm font-normal text-muted-foreground">un.</span>
            </p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
        ))}
      </div>

      {error ? <Alert>{error}</Alert> : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">
            {loading ? 'Carregando…' : `${total} movimentaç${total === 1 ? 'ão' : 'ões'}`}
          </h3>
          <Button variant="outline" size="lg" onClick={exportSheet} disabled={exporting || !total}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Exportar planilha
          </Button>
        </div>

        {loading ? (
          <Spinner />
        ) : !rows.length ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma movimentação com esses filtros.</p>
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => {
              const day = dayLabel(row.createdAt);
              const heading = day !== lastDay;
              lastDay = day;
              const reference = referenceOf(row);
              return (
                <li key={row.id} className="grid gap-2">
                  {heading ? <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">{day}</p> : null}
                  <div className="grid gap-1 rounded-xl border bg-card p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <p className="font-medium wrap-anywhere">{row.partName}</p>
                      <p className="text-sm text-muted-foreground">
                        {row.kindLabel} · <span className="text-foreground/80">{row.technicianName ? `Carro de ${row.technicianName}` : 'Estoque central'}</span>
                      </p>
                      <p className="text-xs text-muted-foreground wrap-anywhere">
                        {new Date(row.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        {reference ? ` · ${reference}` : ''}
                        {row.createdByName ? ` · ${row.createdByName}` : ''}
                        {row.note ? ` · ${row.note}` : ''}
                      </p>
                    </div>
                    <span className={`text-xl font-semibold tabular-nums sm:text-right ${row.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {row.quantity > 0 ? '+' : ''}
                      {row.quantity}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && rows.length < total ? (
          <div className="grid justify-items-center gap-1.5 pt-2">
            <p className="text-xs text-muted-foreground">
              Mostrando {rows.length} de {total}
            </p>
            <Button variant="outline" size="lg" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Carregar mais
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
