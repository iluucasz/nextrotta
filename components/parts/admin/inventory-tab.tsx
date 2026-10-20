'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Loader2, Minus, Plus, ScanBarcode } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
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

export function InventoryTab() {
  const list = useParts<{ inventories: InventorySummary[] }>('/api/parts/inventories');
  const catalog = useParts<CatalogResponse>('/api/parts');
  const [openId, setOpenId] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  return (
    <div className="grid gap-4">
      <DataPanel title="Novo inventário" description="Conte as peças do carro de um técnico (ou do estoque central) lendo os códigos de barras. O que faltar pode virar débito do técnico, em parcelas.">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Estoque a contar" className="min-w-56">
            <select className={inputClassName} value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
              <option value="">Estoque central</option>
              {(catalog.data?.technicians ?? []).map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={start} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
            Começar contagem
          </Button>
        </div>
        {error ? <Alert className="mt-3">{error}</Alert> : null}
      </DataPanel>

      <DataPanel title="Inventários">
        {!list.data ? (
          <Spinner />
        ) : !list.data.inventories.length ? (
          <p className="text-sm text-muted-foreground">Nenhum inventário ainda.</p>
        ) : (
          <ul className="divide-y">
            {list.data.inventories.map((inventory) => (
              <li key={inventory.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm" onClick={() => setOpenId(inventory.id)}>
                  <div>
                    <p className="font-medium">
                      Nº {inventory.number} · {inventory.technicianName ?? 'Estoque central'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Início {formatDateTime(inventory.startedAt)}
                      {inventory.closedAt ? ` · fim ${formatDateTime(inventory.closedAt)}` : ` · ${inventory.counted} lida(s)`}
                      {inventory.shortageValue ? ` · faltas ${formatCurrency(inventory.shortageValue)}` : ''}
                    </p>
                  </div>
                  <StatusBadge tone={STATUS_TONES[inventory.status]}>{STATUS_LABELS[inventory.status]}</StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DataPanel>
    </div>
  );
}

function InventoryScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload, setData } = useParts<{ inventory: InventoryDetail }>(`/api/parts/inventories/${id}`);
  const [scanning, setScanning] = useState(false);
  const [lastRead, setLastRead] = useState<{ text: string; tone: 'success' | 'danger' } | null>(null);
  const [actionError, setActionError] = useState('');
  const [closing, setClosing] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, 'charge' | 'absorb'>>({});
  const [installments, setInstallments] = useState('1');
  const [firstDueMonth, setFirstDueMonth] = useState(currentMonthKey());
  const [busy, setBusy] = useState(false);
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
    setActionError('');
    try {
      const result = await partsApi<{ inventory: InventoryDetail }>(`/api/parts/inventories/${id}`, {
        method: 'POST',
        json: { action: 'close', resolutions, installments: Number(installments), firstDueMonth },
      });
      setData(result);
      setClosing(false);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm('Cancelar esta contagem? Nada no estoque muda.')) return;
    try {
      await partsApi(`/api/parts/inventories/${id}`, { method: 'POST', json: { action: 'cancel' } });
      onBack();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!inventory) return error ? <Alert>{error}</Alert> : <Spinner />;
  const open = inventory.status === 'open';
  const shortages = inventory.items.filter((item) => item.difference < 0);
  const chargedValue = inventory.technicianId
    ? shortages.filter((item) => (resolutions[item.partId] ?? 'charge') === 'charge').reduce((sum, item) => sum + -item.difference * item.unitTechnicianPrice, 0)
    : 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Inventários
        </Button>
        <h2 className="text-base font-semibold">
          Inventário nº {inventory.number} · {inventory.technicianName ?? 'Estoque central'}
        </h2>
        <StatusBadge tone={STATUS_TONES[inventory.status]}>{STATUS_LABELS[inventory.status]}</StatusBadge>
      </div>
      {actionError ? <Alert>{actionError}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Esperado" value={inventory.totals.expected} />
        <Stat label="Contado" value={inventory.totals.counted} />
        <Stat label="Faltam" value={inventory.totals.missingUnits} tone={inventory.totals.missingUnits ? 'danger' : undefined} hint={formatCurrency(inventory.totals.missingValue)} />
        <Stat label="Sobram" value={inventory.totals.surplusUnits} />
      </div>

      {open ? (
        <DataPanel title="Contagem" description="Cada leitura soma 1 unidade. Também dá para digitar a quantidade de cada peça na lista.">
          {scanning ? (
            <BarcodeScanner continuous title="Leia cada unidade" onDetect={(code) => count({ barcode: code })} onClose={() => setScanning(false)} />
          ) : (
            <Button onClick={() => setScanning(true)}>
              <ScanBarcode className="h-4 w-4" />
              Ler códigos de barras
            </Button>
          )}
          {lastRead ? <Alert tone={lastRead.tone} className="mt-3">{lastRead.text}</Alert> : null}
        </DataPanel>
      ) : null}

      <DataPanel title="Peças" description={open ? 'Esperado = estoque no sistema agora (vendas registradas já saíram).' : `Encerrado em ${formatDateTime(inventory.closedAt)}.`}>
        <ul className="divide-y">
          {inventory.items.map((item) => (
            <li key={item.partId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <PartImage src={item.imageUrl} alt={item.name} className="h-10 w-10" />
              <div className="min-w-40 flex-1">
                <p className="font-medium">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  Esperado {item.expected}
                  {item.barcode ? ` · ${item.barcode}` : ''}
                  {!open && item.resolution ? ` · ${item.resolution === 'charge' ? 'cobrado do técnico' : 'perda da empresa'}` : ''}
                </p>
              </div>
              {open ? (
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => count({ partId: item.partId, add: -1 })} disabled={item.counted === 0} aria-label="Menos um">
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <input
                    className={inputClass('min-h-8 w-16 text-center')}
                    defaultValue={item.counted}
                    key={item.counted}
                    inputMode="numeric"
                    onBlur={(event) => Number(event.target.value) !== item.counted && count({ partId: item.partId, set: Number(event.target.value) })}
                    aria-label={`Contado de ${item.name}`}
                  />
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => count({ partId: item.partId, add: 1 })} aria-label="Mais um">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <span className="tabular-nums">contado {item.counted}</span>
              )}
              <span
                className={`w-14 text-right font-semibold tabular-nums ${item.difference < 0 ? 'text-rose-700' : item.difference > 0 ? 'text-amber-700' : 'text-emerald-700'}`}
              >
                {item.difference > 0 ? '+' : ''}
                {item.difference}
              </span>
            </li>
          ))}
        </ul>
      </DataPanel>

      {open ? (
        closing ? (
          <DataPanel title="Encerrar inventário" description="O estoque passa a ser o que foi contado. As diferenças ficam registradas.">
            <div className="grid gap-4">
              {inventory.technicianId && shortages.length ? (
                <>
                  <p className="text-sm">Peças em falta — cobrar do técnico ou a empresa assume (ex.: roubo com boletim de ocorrência)?</p>
                  <ul className="divide-y text-sm">
                    {shortages.map((item) => (
                      <li key={item.partId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          {-item.difference}× {item.name} ({formatCurrency(-item.difference * item.unitTechnicianPrice)})
                        </span>
                        <select
                          className={inputClass('w-auto')}
                          value={resolutions[item.partId] ?? 'charge'}
                          onChange={(event) => setResolutions((current) => ({ ...current, [item.partId]: event.target.value as 'charge' | 'absorb' }))}
                        >
                          <option value="charge">Cobrar do técnico</option>
                          <option value="absorb">Empresa assume</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                  {chargedValue > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Parcelas" hint={`${formatCurrency(chargedValue)} no total`}>
                        <select className={inputClassName} value={installments} onChange={(event) => setInstallments(event.target.value)}>
                          {Array.from({ length: 24 }, (_, index) => index + 1).map((value) => (
                            <option key={value} value={value}>
                              {value}x de {formatCurrency(chargedValue / value)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Primeira parcela em">
                        <select className={inputClassName} value={firstDueMonth} onChange={(event) => setFirstDueMonth(event.target.value)}>
                          {Array.from({ length: 4 }, (_, index) => addMonths(currentMonthKey(), index)).map((month) => (
                            <option key={month} value={month}>
                              {month.split('-').reverse().join('/')}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>
                  ) : null}
                </>
              ) : shortages.length ? (
                <p className="text-sm">As faltas do estoque central ficam como perda da empresa.</p>
              ) : (
                <p className="text-sm">Nenhuma falta. </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={close} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Encerrar inventário
                </Button>
                <Button variant="ghost" onClick={() => setClosing(false)}>
                  Voltar à contagem
                </Button>
              </div>
            </div>
          </DataPanel>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setClosing(true)}>Encerrar inventário</Button>
            <Button variant="ghost" className="text-rose-700" onClick={cancel}>
              Cancelar contagem
            </Button>
          </div>
        )
      ) : inventory.debtNumber ? (
        <Alert tone="info">
          Gerou o débito nº {inventory.debtNumber} para {inventory.technicianName} (veja em Acerto). O técnico confirma o débito no app.
        </Alert>
      ) : null}
    </div>
  );
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

function Stat({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'danger' }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-rose-700' : ''}`}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
