'use client';

import { useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Clock, Loader2, Plus, Printer, ScanBarcode, Trash2, Unplug } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/formatters';
import type { TransferSummary } from '@/lib/parts/stock';
import { normalizeBarcode, type Part } from '@/lib/parts/types';
import { Alert, BarcodeScanner, Field, formatDateTime, inputClassName, PartImage, partsApi, Spinner, useParts } from '../shared';
import type { CatalogResponse } from './catalog-tab';

type TransferDetail = TransferSummary & {
  items: Array<{ partId: string; name: string; barcode: string | null; unit: string; quantity: number; unitTechnicianPrice: number; unitCost: number }>;
};

export function TechniciansTab() {
  const catalog = useParts<CatalogResponse>('/api/parts');
  const transfers = useParts<{ transfers: TransferSummary[] }>('/api/parts/transfers');
  const [dialog, setDialog] = useState<{ kind: 'out' | 'return'; technicianId: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

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

  return (
    <div className="grid gap-4">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {technicians
          .filter((technician) => technician.status === 'active' || stock.some((item) => item.technicianId === technician.id))
          .map((technician) => {
            const items = stock.filter((item) => item.technicianId === technician.id && item.quantity !== 0);
            const value = items.reduce((sum, item) => sum + item.quantity * (partsById.get(item.partId)?.technicianPrice ?? 0), 0);
            const units = items.reduce((sum, item) => sum + item.quantity, 0);
            return (
              <DataPanel
                key={technician.id}
                title={technician.name}
                description={`${units} peça(s) no carro · ${formatCurrency(value)} a preço de técnico`}
                action={
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setDialog({ kind: 'out', technicianId: technician.id })} disabled={technician.status !== 'active'}>
                      <ArrowUpFromLine className="h-4 w-4" />
                      Enviar peças
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'return', technicianId: technician.id })} disabled={!items.length}>
                      <ArrowDownToLine className="h-4 w-4" />
                      Devolução
                    </Button>
                  </div>
                }
              >
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {technician.mercadoPago ? (
                      <>
                        <StatusBadge tone="success">Mercado Pago conectado{technician.mercadoPago.nickname ? `: ${technician.mercadoPago.nickname}` : ''}</StatusBadge>
                        {technician.mercadoPago.liveMode === false ? <StatusBadge tone="warning">conta de teste</StatusBadge> : null}
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => disconnect(technician.id, technician.name)}>
                          <Unplug className="h-3.5 w-3.5" />
                          Desconectar
                        </Button>
                      </>
                    ) : (
                      <StatusBadge tone="neutral">Mercado Pago não conectado (só vende em dinheiro)</StatusBadge>
                    )}
                    {technician.status !== 'active' ? <StatusBadge tone="danger">Inativo</StatusBadge> : null}
                  </div>
                  {items.length ? (
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
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma peça com este técnico.</p>
                  )}
                </div>
              </DataPanel>
            );
          })}
      </div>

      <DataPanel title="Remessas e devoluções" description="Cada envio vira um termo de consignação que o técnico confirma no app.">
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
                      {transfer.acknowledgedAt ? (
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
                      <Button variant="ghost" size="sm" onClick={() => printTerm(transfer.id)}>
                        <Printer className="h-4 w-4" />
                        Termo
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
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

interface Line {
  partId: string;
  quantity: string;
}

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
  const [lines, setLines] = useState<Line[]>([{ partId: options[0]?.id ?? '', quantity: '' }]);
  const [note, setNote] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (parts.find((part) => part.id === line.partId)?.technicianPrice ?? 0), 0);

  function onScan(code: string) {
    const part = options.find((item) => item.barcode === normalizeBarcode(code));
    if (!part) {
      setError(`Código ${code}: peça não encontrada ${direction === 'out' ? 'no estoque central' : 'com o técnico'}.`);
      return;
    }
    setError('');
    setLines((current) => {
      const index = current.findIndex((line) => line.partId === part.id && line.quantity);
      if (index >= 0) return current.map((line, position) => (position === index ? { ...line, quantity: String(Number(line.quantity) + 1) } : line));
      const empty = current.findIndex((line) => !line.quantity);
      return empty >= 0 ? current.map((line, position) => (position === empty ? { partId: part.id, quantity: '1' } : line)) : [...current, { partId: part.id, quantity: '1' }];
    });
  }

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
          items: lines.filter((line) => line.partId && Number(line.quantity) > 0).map((line) => ({ partId: line.partId, quantity: Number(line.quantity) })),
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
          {scanning ? <BarcodeScanner continuous title="Leia cada peça (cada leitura soma 1)" onDetect={onScan} onClose={() => setScanning(false)} /> : null}
          <div className="grid gap-2">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[1fr_90px_auto] items-end gap-2">
                <Field label={index === 0 ? 'Peça' : ''}>
                  <select className={inputClassName} value={line.partId} onChange={(event) => setLines((current) => current.map((item, position) => (position === index ? { ...item, partId: event.target.value } : item)))}>
                    {options.map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.name} (disp. {available.get(part.id) ?? 0})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={index === 0 ? 'Qtd.' : ''}>
                  <input className={inputClassName} value={line.quantity} inputMode="numeric" onChange={(event) => setLines((current) => current.map((item, position) => (position === index ? { ...item, quantity: event.target.value } : item)))} />
                </Field>
                <Button type="button" variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, position) => position !== index))} aria-label="Remover linha">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, { partId: options[0]?.id ?? '', quantity: '' }])}>
                <Plus className="h-4 w-4" />
                Outra peça
              </Button>
              {!scanning ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setScanning(true)}>
                  <ScanBarcode className="h-4 w-4" />
                  Ler códigos
                </Button>
              ) : null}
            </div>
          </div>
          <Field label="Observação (opcional)">
            <input className={inputClassName} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <p className="flex justify-between text-sm font-semibold">
            <span>Total a preço de técnico</span>
            <span>{formatCurrency(total)}</span>
          </p>
        </>
      )}
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy || !lines.some((line) => line.partId && Number(line.quantity) > 0)}>
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
