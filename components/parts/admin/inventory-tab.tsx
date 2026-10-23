'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ChevronRight, ClipboardCheck, Loader2, Minus, Plus, ScanBarcode, Search } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, normalizeText } from '@/lib/formatters';
import type { InventoryLine } from '@/lib/parts/stock';
import { addMonths } from '@/lib/parts/types';
import { Alert, BarcodeScanner, currentMonthKey, Field, formatDateTime, inputClassName, PartImage, partsApi, Spinner, useParts, inputClass } from '../shared';
import type { CatalogResponse } from './catalog-tab';

interface InventorySummary {
  id: string;
  number: number;
  technicianId: string | null;
  technicianName: string | null;
  status: 'open' | 'closed' | 'canceled';
  startedAt: string;
  closedAt: string | null;
  counted: number;
  shortageValue: number | null;
  surplusUnits: number | null;
}

interface InventoryDetail extends Omit<InventorySummary, 'counted' | 'surplusUnits'> {
  note: string | null;
  debtId: string | null;
  debtNumber: number | null;
  items: InventoryLine[];
  totals: { expected: number; counted: number; missingUnits: number; surplusUnits: number; missingValue: number };
}

const STATUS_LABELS = { open: 'Em contagem', closed: 'Encerrado', canceled: 'Cancelado' } as const;
const STATUS_TONES = { open: 'warning', closed: 'success', canceled: 'neutral' } as const;

type HistoryResult = 'all' | 'shortage' | 'clean' | 'canceled';

// ---------------------------------------------------------------- list

export function InventoryTab() {
  const list = useParts<{ inventories: InventorySummary[] }>('/api/parts/inventories');
  const catalog = useParts<CatalogResponse>('/api/parts');
  const [openId, setOpenId] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyWhere, setHistoryWhere] = useState('');
  const [historyResult, setHistoryResult] = useState<HistoryResult>('all');

  async function start() {
    setBusy(true);
    setError('');
    try {
      const { inventory } = await partsApi<{ inventory: InventoryDetail }>('/api/parts/inventories', { method: 'POST', json: { technicianId: technicianId || null } });
      list.reload();
      setOpenId(inventory.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <InventoryScreen
        id={openId}
        onBack={() => {
          setOpenId(null);
          list.reload();
        }}
      />
    );
  }

  const inventories = list.data?.inventories ?? [];
  const inProgress = inventories.filter((inventory) => inventory.status === 'open');
  const history = inventories.filter((inventory) => inventory.status !== 'open');

  // Past counts can be searched by number or place, narrowed to one place and to one result.
  const locations = Array.from(new Map(history.map((inventory): [string, string] => [inventory.technicianId ?? 'central', inventory.technicianName ?? 'Estoque central'])).entries());
  const resultOf = (inventory: InventorySummary): Exclude<HistoryResult, 'all'> => (inventory.status === 'canceled' ? 'canceled' : inventory.shortageValue ? 'shortage' : 'clean');
  const term = normalizeText(historySearch);
  const matching = history.filter(
    (inventory) =>
      (!term || normalizeText(`${inventory.number} ${inventory.technicianName ?? 'Estoque central'}`).includes(term)) &&
      (!historyWhere || (inventory.technicianId ?? 'central') === historyWhere),
  );
  const shownHistory = matching.filter((inventory) => historyResult === 'all' || resultOf(inventory) === historyResult);
  const resultFilters: Array<[HistoryResult, string, number]> = [
    ['all', 'Todos', matching.length],
    ['shortage', 'Com faltas', matching.filter((inventory) => resultOf(inventory) === 'shortage').length],
    ['clean', 'Sem faltas', matching.filter((inventory) => resultOf(inventory) === 'clean').length],
    ['canceled', 'Cancelados', matching.filter((inventory) => resultOf(inventory) === 'canceled').length],
  ];

  return (
    <div className="grid gap-6">
      {inProgress.length ? (
        <section className="grid gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contagem em andamento</h3>
          {inProgress.map((inventory) => (
            <div key={inventory.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="min-w-0">
                <p className="font-medium text-amber-950">
                  Inventário nº {inventory.number} · {inventory.technicianName ?? 'Estoque central'}
                </p>
                <p className="text-xs text-amber-900/80">
                  Começou em {formatDateTime(inventory.startedAt)} · {inventory.counted} leitura(s)
                </p>
              </div>
              <Button size="lg" onClick={() => setOpenId(inventory.id)}>
                Continuar contagem
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </section>
      ) : null}

      <DataPanel title="Novo inventário" description="Conte as peças de um carro ou do estoque central. O sistema compara com o que deveria ter.">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field label="O que você vai contar?">
            <select className={inputClass('h-11 text-base sm:text-sm')} value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
              <option value="">Estoque central (da empresa)</option>
              {(catalog.data?.technicians ?? []).map((technician) => (
                <option key={technician.id} value={technician.id}>
                  Carro de {technician.name}
                </option>
              ))}
            </select>
          </Field>
          <Button size="lg" className="h-11" onClick={start} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            Começar contagem
          </Button>
        </div>
        {error ? <Alert className="mt-3">{error}</Alert> : null}
      </DataPanel>

      <section className="grid gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
        {history.length ? (
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className={inputClass('h-11 pl-9 text-base sm:text-sm')}
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Buscar por número ou técnico"
                  aria-label="Buscar inventário"
                />
              </div>
              <select className={inputClass('h-11 text-base sm:text-sm')} value={historyWhere} onChange={(event) => setHistoryWhere(event.target.value)} aria-label="Filtrar por local">
                <option value="">Todos os locais</option>
                {locations.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por resultado">
              {resultFilters.map(([value, label, total]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHistoryResult(value)}
                  aria-pressed={historyResult === value}
                  className={`rounded-full border px-3.5 py-1.5 text-sm transition ${historyResult === value ? 'border-primary bg-primary/5 font-medium text-primary' : 'text-muted-foreground hover:border-primary/40'}`}
                >
                  {label} <span className="tabular-nums opacity-70">{total}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {!list.data ? (
          <Spinner />
        ) : !history.length ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum inventário encerrado ainda.</p>
        ) : !shownHistory.length ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum inventário com esses filtros.</p>
        ) : (
          <ul className="grid gap-2">
            {shownHistory.map((inventory) => (
              <li key={inventory.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40"
                  onClick={() => setOpenId(inventory.id)}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      Nº {inventory.number} · {inventory.technicianName ?? 'Estoque central'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(inventory.closedAt ?? inventory.startedAt)}
                      {inventory.status === 'closed' ? ` · ${inventory.counted} leitura(s)` : ''}
                    </p>
                  </div>
                  <div className="grid shrink-0 justify-items-end gap-1">
                    <StatusBadge tone={STATUS_TONES[inventory.status]}>{STATUS_LABELS[inventory.status]}</StatusBadge>
                    {inventory.status === 'closed' ? (
                      inventory.shortageValue ? (
                        <span className="text-xs font-medium text-rose-700">Faltas {formatCurrency(inventory.shortageValue)}</span>
                      ) : (
                        <span className="text-xs font-medium text-emerald-700">Sem faltas</span>
                      )
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- one inventory

type Filter = 'all' | 'missing' | 'surplus' | 'ok';

function InventoryScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload, setData } = useParts<{ inventory: InventoryDetail }>(`/api/parts/inventories/${id}`);
  const [scanning, setScanning] = useState(false);
  const [lastRead, setLastRead] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [actionError, setActionError] = useState('');
  const [closeError, setCloseError] = useState('');
  const [closing, setClosing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, 'charge' | 'absorb'>>({});
  const [installments, setInstallments] = useState('1');
  const [firstDueMonth, setFirstDueMonth] = useState(currentMonthKey());
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const inventory = data?.inventory;

  useEffect(() => {
    if (!inventory || inventory.status !== 'open') setScanning(false);
  }, [inventory]);

  async function count(body: Record<string, unknown>) {
    try {
      const { counted } = await partsApi<{ counted: { partId: string; name: string; counted: number; expected: number } }>(`/api/parts/inventories/${id}`, {
        method: 'POST',
        json: { action: 'count', ...body },
      });
      setLastRead({ text: `${counted.name}: ${counted.counted} de ${counted.expected}`, tone: 'success' });
      setData((current) => {
        if (!current) return current;
        const exists = current.inventory.items.some((item) => item.partId === counted.partId);
        if (!exists) {
          reload();
          return current;
        }
        const items = current.inventory.items.map((item) =>
          item.partId === counted.partId ? { ...item, counted: counted.counted, difference: counted.counted - item.expected } : item,
        );
        return { inventory: { ...current.inventory, items, totals: recomputeTotals(items) } };
      });
    } catch (reason) {
      navigator.vibrate?.([80, 60, 80]);
      setLastRead({ text: reason instanceof Error ? reason.message : String(reason), tone: 'danger' });
    }
  }

  async function close() {
    setBusy(true);
    setCloseError('');
    try {
      const result = await partsApi<{ inventory: InventoryDetail }>(`/api/parts/inventories/${id}`, {
        method: 'POST',
        json: { action: 'close', resolutions, installments: Number(installments), firstDueMonth },
      });
      setData(result);
      setClosing(false);
    } catch (reason) {
      setCloseError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await partsApi(`/api/parts/inventories/${id}`, { method: 'POST', json: { action: 'cancel' } });
      onBack();
    } catch (reason) {
      setCanceling(false);
      setActionError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  if (!inventory) return error ? <Alert>{error}</Alert> : <Spinner />;

  const open = inventory.status === 'open';
  const where = inventory.technicianName ? `Carro de ${inventory.technicianName}` : 'Estoque central';
  const shortages = inventory.items.filter((item) => item.difference < 0);
  const chargedValue = inventory.technicianId
    ? shortages.filter((item) => (resolutions[item.partId] ?? 'charge') === 'charge').reduce((sum, item) => sum + -item.difference * item.unitTechnicianPrice, 0)
    : 0;
  const progress = inventory.totals.expected > 0 ? Math.min(100, Math.round((inventory.totals.counted / inventory.totals.expected) * 100)) : 0;

  const counts = {
    all: inventory.items.length,
    missing: inventory.items.filter((item) => item.difference < 0).length,
    surplus: inventory.items.filter((item) => item.difference > 0).length,
    ok: inventory.items.filter((item) => item.difference === 0).length,
  };
  const term = normalizeText(search);
  const visibleItems = inventory.items.filter((item) => {
    if (term && !normalizeText(`${item.name} ${item.barcode ?? ''}`).includes(term)) return false;
    if (filter === 'missing') return item.difference < 0;
    if (filter === 'surplus') return item.difference > 0;
    if (filter === 'ok') return item.difference === 0;
    return true;
  });
  const filters: Array<[Filter, string]> = [
    ['all', 'Todas'],
    ['missing', 'Faltam'],
    ['surplus', 'Sobram'],
    ['ok', 'Ok'],
  ];

  return (
    <div className="grid gap-5">
      <div className="grid gap-3">
        <div>
          <Button variant="ghost" size="lg" className="-ml-3" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            Inventários
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-lg font-semibold">Inventário nº {inventory.number}</h2>
          <StatusBadge tone={STATUS_TONES[inventory.status]}>{STATUS_LABELS[inventory.status]}</StatusBadge>
        </div>
        <p className="-mt-2 text-sm text-muted-foreground">
          {where} · {open ? `começou em ${formatDateTime(inventory.startedAt)}` : `encerrado em ${formatDateTime(inventory.closedAt)}`}
        </p>
      </div>
      {actionError ? <Alert>{actionError}</Alert> : null}

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Deveria ter" value={inventory.totals.expected} />
          <Stat label="Contadas" value={inventory.totals.counted} />
          <Stat label="Faltam" value={inventory.totals.missingUnits} tone={inventory.totals.missingUnits ? 'danger' : undefined} hint={inventory.totals.missingUnits ? formatCurrency(inventory.totals.missingValue) : undefined} />
          <Stat label="Sobram" value={inventory.totals.surplusUnits} tone={inventory.totals.surplusUnits ? 'warning' : undefined} />
        </div>
        {open ? (
          <div className="grid gap-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Progresso da contagem">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {inventory.totals.counted} de {inventory.totals.expected} peças contadas ({progress}%)
            </p>
          </div>
        ) : null}
      </section>

      {open ? (
        <section className="grid gap-3 rounded-xl border bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">Contar as peças</h3>
            <p className="text-xs text-muted-foreground">Leia o código de barras (cada leitura soma 1) ou use os botões − e + de cada peça.</p>
          </div>
          {scanning ? (
            <BarcodeScanner continuous title="Leia cada unidade" onDetect={(code) => count({ barcode: code })} onClose={() => setScanning(false)} />
          ) : (
            <Button size="lg" className="h-12 w-full text-base sm:w-auto" onClick={() => setScanning(true)}>
              <ScanBarcode className="h-5 w-5" />
              Ler códigos de barras
            </Button>
          )}
          {lastRead ? <Alert tone={lastRead.tone}>{lastRead.text}</Alert> : null}
        </section>
      ) : null}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Peças</h3>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={inputClass('h-11 pl-9 text-base sm:text-sm')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça ou código" aria-label="Buscar peça" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar peças">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${filter === value ? 'border-primary bg-primary/5 font-medium text-primary' : 'text-muted-foreground hover:border-primary/40'}`}
            >
              {label} <span className="tabular-nums opacity-70">{counts[value]}</span>
            </button>
          ))}
        </div>

        {!visibleItems.length ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhuma peça nesse filtro.</p>
        ) : (
          <ul className="grid gap-2">
            {visibleItems.map((item) => (
              <li key={item.partId} className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <PartImage src={item.imageUrl} alt={item.name} className="h-12 w-12 shrink-0" />
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Deveria ter {item.expected}
                      {item.barcode ? ` · ${item.barcode}` : ''}
                      {!open && item.resolution ? ` · ${item.resolution === 'charge' ? 'cobrado do técnico' : 'perda da empresa'}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  {open ? (
                    <div className="flex items-center gap-1.5">
                      <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => count({ partId: item.partId, add: -1 })} disabled={item.counted === 0} aria-label="Menos um">
                        <Minus className="h-4 w-4" />
                      </Button>
                      <input
                        className={inputClass('h-10 w-16 text-center text-base tabular-nums sm:text-sm')}
                        defaultValue={item.counted}
                        key={item.counted}
                        inputMode="numeric"
                        onBlur={(event) => Number(event.target.value) !== item.counted && count({ partId: item.partId, set: Number(event.target.value) })}
                        aria-label={`Contado de ${item.name}`}
                      />
                      <Button size="icon" variant="outline" className="h-10 w-10" onClick={() => count({ partId: item.partId, add: 1 })} aria-label="Mais um">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm tabular-nums text-muted-foreground">Contadas {item.counted}</span>
                  )}
                  <DifferenceChip item={item} open={open} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open ? (
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            size="lg"
            className="h-12 flex-1 text-base sm:flex-none"
            onClick={() => {
              setCloseError('');
              setClosing(true);
            }}
          >
            Encerrar inventário
          </Button>
          <Button size="lg" variant="ghost" className="text-rose-700" onClick={() => setCanceling(true)}>
            Cancelar contagem
          </Button>
        </div>
      ) : inventory.debtNumber ? (
        <Alert tone="info">
          Gerou a cobrança nº {inventory.debtNumber} para {inventory.technicianName} (veja em Acerto). O técnico concorda pelo app.
        </Alert>
      ) : null}

      <Dialog open={closing} onOpenChange={(value) => !busy && setClosing(value)}>
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>Encerrar inventário nº {inventory.number}?</DialogTitle>
            <DialogDescription>O estoque de “{where}” passa a ser o que você contou. Isso não pode ser desfeito.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted/40 p-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Contadas</p>
              <p className="text-lg font-semibold tabular-nums">{inventory.totals.counted}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Faltam</p>
              <p className={`text-lg font-semibold tabular-nums ${inventory.totals.missingUnits ? 'text-rose-700' : ''}`}>{inventory.totals.missingUnits}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sobram</p>
              <p className={`text-lg font-semibold tabular-nums ${inventory.totals.surplusUnits ? 'text-amber-700' : ''}`}>{inventory.totals.surplusUnits}</p>
            </div>
          </div>

          {inventory.technicianId && shortages.length ? (
            <section className="grid gap-3">
              <div>
                <h3 className="text-sm font-semibold">O que fazer com as peças que faltam?</h3>
                <p className="text-xs text-muted-foreground">Cobrar do técnico, ou a empresa assume (por exemplo, roubo com boletim de ocorrência).</p>
              </div>
              <ul className="divide-y rounded-xl border">
                {shortages.map((item) => {
                  const resolution = resolutions[item.partId] ?? 'charge';
                  return (
                    <li key={item.partId} className="grid gap-2 p-3">
                      <div className="flex items-start justify-between gap-3 text-sm">
                        <span className="min-w-0 font-medium">
                          {-item.difference}× {item.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatCurrency(-item.difference * item.unitTechnicianPrice)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ['charge', 'Cobrar do técnico'],
                            ['absorb', 'Empresa assume'],
                          ] as const
                        ).map(([value, label]) => (
                          <label
                            key={value}
                            className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-center text-sm transition has-focus-visible:ring-2 has-focus-visible:ring-ring ${
                              resolution === value ? 'border-primary bg-primary/5 font-medium ring-1 ring-primary' : 'hover:border-primary/40'
                            }`}
                          >
                            <input type="radio" className="sr-only" name={`resolution-${item.partId}`} checked={resolution === value} onChange={() => setResolutions((current) => ({ ...current, [item.partId]: value }))} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {chargedValue > 0 ? (
                <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
                  <p className="text-sm sm:col-span-2">
                    Total cobrado do técnico: <strong className="tabular-nums">{formatCurrency(chargedValue)}</strong>
                  </p>
                  <Field label="Dividir em">
                    <select className={inputClass('h-11 text-base sm:text-sm')} value={installments} onChange={(event) => setInstallments(event.target.value)}>
                      {Array.from({ length: 24 }, (_, index) => index + 1).map((value) => (
                        <option key={value} value={value}>
                          {value}x de {formatCurrency(chargedValue / value)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Primeira parcela em">
                    <select className={inputClass('h-11 text-base sm:text-sm')} value={firstDueMonth} onChange={(event) => setFirstDueMonth(event.target.value)}>
                      {Array.from({ length: 4 }, (_, index) => addMonths(currentMonthKey(), index)).map((month) => (
                        <option key={month} value={month}>
                          {month.split('-').reverse().join('/')}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}
            </section>
          ) : shortages.length ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">As faltas do estoque central ficam como perda da empresa.</p>
          ) : (
            <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Nenhuma falta. Está tudo certo.
            </p>
          )}

          {closeError ? <Alert>{closeError}</Alert> : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="lg" onClick={() => setClosing(false)} disabled={busy}>
              Voltar à contagem
            </Button>
            <Button size="lg" onClick={close} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Encerrar inventário
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={canceling} onOpenChange={(value) => !busy && setCanceling(value)}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] p-4 sm:max-w-md sm:p-6">
          <DialogHeader>
            <DialogTitle>Cancelar esta contagem?</DialogTitle>
            <DialogDescription>O que foi contado até agora é descartado. O estoque não muda.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="lg" onClick={() => setCanceling(false)} disabled={busy}>
              Continuar contando
            </Button>
            <Button variant="destructive" size="lg" onClick={cancel} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Cancelar contagem
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DifferenceChip({ item, open }: { item: InventoryLine; open: boolean }) {
  if (open && item.counted === 0 && item.expected > 0) return <StatusBadge tone="neutral">Não contada</StatusBadge>;
  if (item.difference < 0) return <StatusBadge tone="danger">Faltam {-item.difference}</StatusBadge>;
  if (item.difference > 0) return <StatusBadge tone="warning">Sobram {item.difference}</StatusBadge>;
  return <StatusBadge tone="success">Ok</StatusBadge>;
}

function recomputeTotals(items: InventoryLine[]) {
  return {
    expected: items.reduce((sum, item) => sum + item.expected, 0),
    counted: items.reduce((sum, item) => sum + item.counted, 0),
    missingUnits: items.reduce((sum, item) => sum + Math.max(0, -item.difference), 0),
    surplusUnits: items.reduce((sum, item) => sum + Math.max(0, item.difference), 0),
    missingValue: items.reduce((sum, item) => sum + Math.max(0, -item.difference) * item.unitTechnicianPrice, 0),
  };
}

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'danger' | 'warning' }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone === 'danger' ? 'text-rose-700' : tone === 'warning' ? 'text-amber-700' : ''}`}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
