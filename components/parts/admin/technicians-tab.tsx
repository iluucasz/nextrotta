'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Clock, Loader2, Printer, ScanBarcode, Search, Undo2, Unplug } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { TransferSummary } from '@/lib/parts/stock';
import { normalizeBarcode, type Part } from '@/lib/parts/types';
import { Alert, BarcodeScanner, Field, formatDateTime, inputClassName, PartImage, partsApi, Spinner, useParts } from '../shared';
import type { CatalogResponse } from './catalog-tab';
import { ReasonDialog } from './corrections';

type TransferDetail = TransferSummary & {
  items: Array<{ partId: string; name: string; barcode: string | null; unit: string; quantity: number; unitTechnicianPrice: number; unitCost: number }>;
};

export function TechniciansTab() {
  const catalog = useParts<CatalogResponse>('/api/parts');
  const transfers = useParts<{ transfers: TransferSummary[] }>('/api/parts/transfers');
  const [dialog, setDialog] = useState<{ kind: 'out' | 'return'; technicianId: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [undoing, setUndoing] = useState<TransferSummary | null>(null);

  const partsById = useMemo(() => new Map((catalog.data?.parts ?? []).map((part) => [part.id, part])), [catalog.data]);

  async function disconnect(technicianId: string, name: string) {
    if (!window.confirm(`Desconectar a conta do Mercado Pago de ${name}? Ele(a) terá de conectar de novo para receber.`)) return;
    try {
      await partsApi(`/api/mercadopago/account?technicianId=${technicianId}`, { method: 'DELETE' });
      catalog.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  if (!catalog.data) return catalog.error ? <Alert>{catalog.error}</Alert> : <Spinner />;
  const { technicians, stock } = catalog.data;
  const rows = technicians
    .filter((technician) => technician.status === 'active' || stock.some((item) => item.technicianId === technician.id))
    .map((technician) => {
      const items = stock.filter((item) => item.technicianId === technician.id && item.quantity !== 0);
      const value = items.reduce((sum, item) => sum + item.quantity * (partsById.get(item.partId)?.technicianPrice ?? 0), 0);
      const units = items.reduce((sum, item) => sum + item.quantity, 0);
      return { technician, items, value, units };
    });
  const withParts = rows.filter((row) => row.items.length);
  const idle = rows.filter((row) => !row.items.length);

  function mercadoPagoStatus(technician: (typeof technicians)[number], allowDisconnect: boolean) {
    if (!technician.mercadoPago) return <StatusBadge tone="warning">Mercado Pago não conectado</StatusBadge>;
    return (
      <>
        <StatusBadge tone="success">Mercado Pago{technician.mercadoPago.nickname ? ` · ${technician.mercadoPago.nickname}` : ''}</StatusBadge>
        {technician.mercadoPago.liveMode === false ? <StatusBadge tone="warning">conta de teste</StatusBadge> : null}
        {allowDisconnect ? (
          <Button variant="ghost" size="lg" className="px-3" onClick={() => disconnect(technician.id, technician.name)}>
            <Unplug className="h-3.5 w-3.5" />
            Desconectar
          </Button>
        ) : null}
      </>
    );
  }

  return (
    <div className="grid gap-4">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}

      {withParts.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {withParts.map(({ technician, items, value, units }) => (
            <DataPanel
              key={technician.id}
              title={technician.name}
              description={`${units} peça(s) no carro · ${formatCurrency(value)}`}
              action={
                <div className="flex gap-2">
                  <Button size="lg" onClick={() => setDialog({ kind: 'out', technicianId: technician.id })} disabled={technician.status !== 'active'}>
                    <ArrowUpFromLine className="h-4 w-4" />
                    Enviar peças
                  </Button>
                  <Button size="lg" variant="outline" onClick={() => setDialog({ kind: 'return', technicianId: technician.id })}>
                    <ArrowDownToLine className="h-4 w-4" />
                    Devolução
                  </Button>
                </div>
              }
            >
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {mercadoPagoStatus(technician, true)}
                  {technician.status !== 'active' ? <StatusBadge tone="danger">Inativo</StatusBadge> : null}
                </div>
                <ul className="divide-y text-sm">
                  {items.map((item) => {
                    const part = partsById.get(item.partId);
                    return (
                      <li key={item.partId} className="flex items-center gap-3 py-1.5">
                        <PartImage src={part?.imageUrl ?? null} alt={part?.name ?? ''} className="h-8 w-8" />
                        <span className="flex-1 truncate">{part?.name ?? 'Peça arquivada'}</span>
                        <span className="tabular-nums">{item.quantity}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </DataPanel>
          ))}
        </div>
      ) : null}

      {idle.length ? (
        <DataPanel title="Sem peças no carro">
          <ul className="divide-y">
            {idle.map(({ technician }) => (
              <li key={technician.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{technician.name}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs">{mercadoPagoStatus(technician, false)}</span>
                <Button size="lg" variant="outline" onClick={() => setDialog({ kind: 'out', technicianId: technician.id })} disabled={technician.status !== 'active'}>
                  <ArrowUpFromLine className="h-4 w-4" />
                  Enviar peças
                </Button>
              </li>
            ))}
          </ul>
        </DataPanel>
      ) : null}

      <DataPanel title="Remessas e devoluções" description="O técnico confirma cada envio no app.">
        {!transfers.data ? (
          <Spinner />
        ) : !transfers.data.transfers.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma remessa ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Nº</th>
                  <th className="py-2 pr-3 font-medium">Técnico</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 text-right font-medium">Peças</th>
                  <th className="py-2 pr-3 text-right font-medium">Preço de técnico</th>
                  <th className="py-2 pr-3 font-medium">Confirmação</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {transfers.data.transfers.map((transfer) => (
                  <tr key={transfer.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{transfer.number}</td>
                    <td className="py-2 pr-3">
                      {transfer.technicianName}
                      <span className="block text-xs text-muted-foreground">{formatDateTime(transfer.createdAt)}</span>
                    </td>
                    <td className="py-2 pr-3">{transfer.direction === 'out' ? 'Remessa' : 'Devolução'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{transfer.units}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(transfer.totalTechnicianPrice)}</td>
                    <td className="py-2 pr-3">
                      {transfer.canceledAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title={transfer.cancelReason ?? undefined}>
                          <Undo2 className="h-3.5 w-3.5" />
                          Desfeita em {formatDateTime(transfer.canceledAt)}
                        </span>
                      ) : transfer.acknowledgedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          {formatDateTime(transfer.acknowledgedAt)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Aguardando o técnico
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" size="lg" onClick={() => printTerm(transfer.id)}>
                        <Printer className="h-4 w-4" />
                        Termo
                      </Button>
                      {!transfer.canceledAt ? (
                        <Button variant="ghost" size="lg" className="text-rose-700" onClick={() => setUndoing(transfer)}>
                          <Undo2 className="h-4 w-4" />
                          Desfazer
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      <ReasonDialog
        open={undoing !== null}
        title={undoing ? `Desfazer ${undoing.direction === 'out' ? 'a remessa' : 'a devolução'} nº ${undoing.number}?` : ''}
        description={
          undoing?.direction === 'out'
            ? `As ${undoing.units} peça(s) saem do carro de ${undoing.technicianName} e voltam para o estoque central. Só dá se ele ainda tiver todas.`
            : `As ${undoing?.units ?? 0} peça(s) saem do estoque central e voltam para o carro de ${undoing?.technicianName ?? ''}. Só dá se o central ainda tiver todas.`
        }
        confirmLabel="Desfazer"
        onClose={() => setUndoing(null)}
        onConfirm={async (reason) => {
          await partsApi(`/api/parts/transfers/${undoing!.id}`, { method: 'POST', json: { action: 'undo', reason } });
          setNotice(`${undoing!.direction === 'out' ? 'Remessa' : 'Devolução'} nº ${undoing!.number} desfeita.`);
          setUndoing(null);
          transfers.reload();
          catalog.reload();
        }}
      />

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:p-6 sm:max-w-2xl">
          {dialog ? (
            <TransferForm
              direction={dialog.kind}
              technician={technicians.find((item) => item.id === dialog.technicianId)!}
              parts={catalog.data.parts}
              available={
                dialog.kind === 'out'
                  ? new Map(catalog.data.parts.map((part) => [part.id, part.centralStock]))
                  : new Map(stock.filter((item) => item.technicianId === dialog.technicianId).map((item) => [item.partId, item.quantity]))
              }
              onSaved={(transfer) => {
                setDialog(null);
                setNotice(
                  `${transfer.direction === 'out' ? 'Remessa' : 'Devolução'} nº ${transfer.number} registrada. O técnico confirma o recebimento em "Minhas peças".`,
                );
                catalog.reload();
                transfers.reload();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const searchKey = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function TransferForm({
  direction,
  technician,
  parts,
  available,
  onSaved,
}: {
  direction: 'out' | 'return';
  technician: CatalogResponse['technicians'][number];
  parts: Part[];
  available: Map<string, number>;
  onSaved: (transfer: TransferSummary) => void;
}) {
  const options = parts.filter((part) => (available.get(part.id) ?? 0) > 0 && (direction === 'return' || part.active));
  // Quantity typed for each part (only parts with a quantity count).
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [note, setNote] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const quantityOf = (partId: string) => Number(quantities[partId]) || 0;
  const selected = options.filter((part) => quantityOf(part.id) > 0);
  const units = selected.reduce((sum, part) => sum + quantityOf(part.id), 0);
  const total = selected.reduce((sum, part) => sum + quantityOf(part.id) * part.technicianPrice, 0);

  const words = searchKey(search).split(/\s+/).filter(Boolean);
  const visible = options.filter((part) => {
    if (onlySelected && quantityOf(part.id) <= 0) return false;
    if (!words.length) return true;
    const haystack = searchKey([part.name, part.barcode, part.sku, part.brand, part.category].filter(Boolean).join(' '));
    return words.every((word) => haystack.includes(word));
  });

  function setQuantity(partId: string, raw: string) {
    const max = available.get(partId) ?? 0;
    const digits = raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const value = digits ? String(Math.min(Number(digits), max)) : '';
    setQuantities((current) => ({ ...current, [partId]: value }));
  }

  /** A typed or scanned barcode adds one unit of that part. Returns false when no part has the code. */
  function addByCode(code: string) {
    const part = options.find((item) => item.barcode === normalizeBarcode(code));
    if (!part) {
      setLastScan('');
      setError(`Código ${code}: peça não encontrada ${direction === 'out' ? 'no estoque central' : 'com o técnico'}.`);
      return false;
    }
    setError('');
    const max = available.get(part.id) ?? 0;
    const current = quantityOf(part.id);
    const next = Math.min(current + 1, max);
    setQuantities((state) => ({ ...state, [part.id]: String(next) }));
    setLastScan(next === current ? `${part.name}: já está no máximo (${max}).` : `${part.name}: ${next}`);
    document.getElementById(`transfer-row-${part.id}`)?.scrollIntoView({ block: 'nearest' });
    return true;
  }

  // Enter inside a field must never send the whole remittance.
  const blockEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') event.preventDefault();
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { transfer } = await partsApi<{ transfer: TransferSummary }>('/api/parts/transfers', {
        method: 'POST',
        json: {
          technicianId: technician.id,
          direction,
          note,
          items: selected.map((part) => ({ partId: part.id, quantity: quantityOf(part.id) })),
        },
      });
      onSaved(transfer);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>
          {direction === 'out' ? 'Enviar peças para' : 'Devolução de'} {technician.name}
        </DialogTitle>
        <DialogDescription>
          {direction === 'out'
            ? 'As peças saem do estoque central e ficam com o técnico em consignação.'
            : 'As peças voltam do técnico para o estoque central.'}
        </DialogDescription>
      </DialogHeader>
      {!options.length ? (
        <Alert tone="warning">{direction === 'out' ? 'O estoque central está vazio. Registre uma entrada antes.' : 'O técnico não tem peças.'}</Alert>
      ) : (
        <>
          {scanning ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <BarcodeScanner continuous title="Leia ou digite cada peça (cada código soma 1)" onDetect={(code) => void addByCode(code)} onClose={() => setScanning(false)} />
              {lastScan ? <Alert tone="success">{lastScan}</Alert> : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                className={`${inputClassName} pl-9`}
                value={search}
                placeholder="Buscar por nome ou código"
                aria-label="Buscar peça"
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  // A reader that "types" the code and presses Enter adds the part.
                  if (search.trim() && addByCode(search.trim())) setSearch('');
                }}
              />
            </div>
            {!scanning ? (
              <Button type="button" variant="outline" onClick={() => setScanning(true)}>
                <ScanBarcode className="h-4 w-4" />
                Ler ou digitar código
              </Button>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {selected.length ? `${selected.length} ${selected.length === 1 ? 'peça' : 'peças'} · ${units} un.` : 'Digite a quantidade das peças que quer enviar'}
            </span>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant={onlySelected ? 'secondary' : 'ghost'} disabled={!selected.length} onClick={() => setOnlySelected((current) => !current)}>
                Só as escolhidas
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!selected.length}
                onClick={() => {
                  setQuantities({});
                  setOnlySelected(false);
                }}
              >
                Limpar
              </Button>
            </div>
          </div>

          <ul className="grid max-h-[42vh] gap-1.5 overflow-y-auto pr-1">
            {visible.map((part) => {
              const max = available.get(part.id) ?? 0;
              const chosen = quantityOf(part.id) > 0;
              return (
                <li key={part.id} id={`transfer-row-${part.id}`}>
                  <label className={cn('grid cursor-text grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border p-2', chosen ? 'border-primary/60 bg-primary/5' : 'border-border')}>
                    <PartImage src={part.imageUrl} alt={part.name} className="h-12 w-12" />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm font-medium leading-snug wrap-anywhere">{part.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {part.barcode ? `${part.barcode} · ` : ''}disp. {max} · {formatCurrency(part.technicianPrice)}
                      </span>
                    </span>
                    <input
                      className={`${inputClassName} w-20 text-center`}
                      value={quantities[part.id] ?? ''}
                      placeholder="0"
                      inputMode="numeric"
                      aria-label={`Quantidade de ${part.name}`}
                      onChange={(event) => setQuantity(part.id, event.target.value)}
                      onKeyDown={blockEnter}
                    />
                  </label>
                </li>
              );
            })}
            {!visible.length ? <li className="py-6 text-center text-sm text-muted-foreground">{search ? 'Nenhuma peça com essa busca.' : 'Nenhuma peça escolhida.'}</li> : null}
          </ul>

          <Field label="Observação (opcional)">
            <input className={inputClassName} value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={blockEnter} />
          </Field>
          <p className="flex justify-between text-sm font-semibold">
            <span>Total a preço de técnico</span>
            <span>{formatCurrency(total)}</span>
          </p>
        </>
      )}
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy || !selected.length}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {direction === 'out' ? 'Registrar remessa' : 'Registrar devolução'}
        </Button>
      </DialogFooter>
    </form>
  );
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);

/** Opens the remittance term in a new window, ready to print or save as PDF. */
async function printTerm(transferId: string) {
  const popup = window.open('', '_blank');
  if (!popup) return;
  popup.document.write('<p style="font-family:sans-serif">Carregando…</p>');
  try {
    const { transfer, organizationName } = await partsApi<{ transfer: TransferDetail; organizationName: string }>(`/api/parts/transfers/${transferId}`);
    const brl = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const date = new Date(transfer.createdAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const rows = transfer.items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.barcode ?? '')}</td><td class="n">${item.quantity}</td><td class="n">${brl(item.unitTechnicianPrice)}</td><td class="n">${brl(item.quantity * item.unitTechnicianPrice)}</td></tr>`,
      )
      .join('');
    const outText = `Pelo presente, <strong>${escapeHtml(organizationName)}</strong> entrega a <strong>${escapeHtml(transfer.technicianName)}</strong>, em consignação, as peças abaixo. O recebedor fica responsável pela guarda das peças e, a cada peça vendida, deve à empresa o valor unitário indicado, a ser pago no acerto mensal. Peças não vendidas podem ser devolvidas. Peças que faltarem no inventário serão tratadas conforme o acordo entre as partes.`;
    const returnText = `Registro da devolução, por <strong>${escapeHtml(transfer.technicianName)}</strong> a <strong>${escapeHtml(organizationName)}</strong>, das peças abaixo, que deixam de estar sob sua responsabilidade.`;
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${transfer.direction === 'out' ? 'Remessa' : 'Devolução'} nº ${transfer.number}</title>
<style>body{font-family:system-ui,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 16px;font-size:14px;line-height:1.5}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left}.n{text-align:right}tfoot td{font-weight:700}.sign{display:flex;gap:48px;margin-top:64px}.sign div{flex:1;border-top:1px solid #111;padding-top:4px;text-align:center}.muted{color:#555;font-size:12px}@media print{button{display:none}}</style></head><body>
<h1>Termo de ${transfer.direction === 'out' ? 'remessa em consignação' : 'devolução de consignação'} nº ${transfer.number}</h1>
<p class="muted">${escapeHtml(organizationName)} · ${date}</p>
<p>${transfer.direction === 'out' ? outText : returnText}</p>
<table><thead><tr><th>Peça</th><th>Código</th><th class="n">Qtd.</th><th class="n">Valor unit.</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="4">Total</td><td class="n">${brl(transfer.totalTechnicianPrice)}</td></tr></tfoot></table>
${transfer.note ? `<p>Observação: ${escapeHtml(transfer.note)}</p>` : ''}
${transfer.acknowledgedAt ? `<p class="muted">Recebimento confirmado pelo técnico no aplicativo em ${new Date(transfer.acknowledgedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.</p>` : ''}
<div class="sign"><div>${escapeHtml(organizationName)}</div><div>${escapeHtml(transfer.technicianName)}</div></div>
<p><button onclick="window.print()">Imprimir</button></p>
</body></html>`);
    popup.document.close();
  } catch (reason) {
    popup.document.body.innerHTML = `<p style="font-family:sans-serif">${escapeHtml(reason instanceof Error ? reason.message : String(reason))}</p>`;
  }
}
