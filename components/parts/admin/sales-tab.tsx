'use client';

import { useState } from 'react';
import { Download, Loader2, MessageCircle, RefreshCw, XCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/formatters';
import type { Sale } from '@/lib/parts/sales';
import { formatMonthLabel } from '@/lib/parts/types';
import { Alert, currentMonthKey, formatDateTime, inputClassName, partsApi, Spinner, useParts, inputClass } from '../shared';
import type { CatalogResponse } from './catalog-tab';

const STATUS_TONES = { awaiting_payment: 'warning', paid: 'success', canceled: 'neutral' } as const;

export function SalesTab() {
  const [month, setMonth] = useState(currentMonthKey());
  const [technicianId, setTechnicianId] = useState('');
  const [status, setStatus] = useState('');
  const catalog = useParts<CatalogResponse>('/api/parts');
  const { data, error, loading, reload } = useParts<{ sales: Sale[] }>(
    `/api/parts/sales?month=${month}&technicianId=${technicianId}&status=${status}`,
  );
  const [open, setOpen] = useState<Sale | null>(null);

  const sales = data?.sales ?? [];
  const valid = sales.filter((sale) => sale.status !== 'canceled');
  const totals = {
    sold: valid.reduce((sum, sale) => sum + sale.totalAmount, 0),
    owed: valid.reduce((sum, sale) => sum + sale.totalTechnicianPrice, 0),
    cost: valid.reduce((sum, sale) => sum + (sale.totalCost ?? 0), 0),
  };

  function exportSheet() {
    const rows = sales.flatMap((sale) =>
      sale.items.map((item) => ({
        Venda: sale.number,
        Data: formatDateTime(sale.createdAt),
        Técnico: sale.technicianName,
        Cliente: sale.customerName ?? '',
        WhatsApp: sale.customerPhone ?? '',
        OS: sale.orderCode ?? '',
        Situação: sale.statusLabel,
        Pagamento: sale.paymentMethodLabel,
        Peça: item.name,
        Quantidade: item.quantity,
        'Preço de venda': item.unitPrice,
        'Preço de técnico': item.unitTechnicianPrice,
      })),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Vendas');
    XLSX.writeFile(book, `vendas-pecas-${month}.xlsx`);
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <input type="month" className={inputClass('w-auto')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
        <select className={inputClass('w-auto')} value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} aria-label="Técnico">
          <option value="">Todos os técnicos</option>
          {(catalog.data?.technicians ?? []).map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>
        <select className={inputClass('w-auto')} value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          <option value="awaiting_payment">Aguardando pagamento</option>
          <option value="paid">Pagas</option>
          <option value="canceled">Canceladas</option>
        </select>
        <Button variant="outline" size="lg" onClick={exportSheet} disabled={!sales.length} className="ml-auto">
          <Download className="h-4 w-4" />
          Exportar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Vendido', value: totals.sold, hint: 'ao cliente' },
          { label: 'Técnicos devem', value: totals.owed, hint: 'preço de técnico' },
          { label: 'Custo', value: totals.cost, hint: 'das peças vendidas' },
          { label: 'Margem', value: totals.owed - totals.cost, hint: 'da empresa' },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border bg-card p-3.5">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{formatCurrency(item.value)}</p>
            <p className="text-xs text-muted-foreground">{item.hint}</p>
          </div>
        ))}
      </div>

      <DataPanel title={`Vendas de ${formatMonthLabel(month)}`}>
        {error ? <Alert>{error}</Alert> : null}
        {loading && !data ? (
          <Spinner />
        ) : !sales.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma venda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Nº</th>
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 pr-3 font-medium">Técnico</th>
                  <th className="py-2 pr-3 font-medium">Peças</th>
                  <th className="py-2 pr-3 font-medium">Pagamento</th>
                  <th className="py-2 pr-3 text-right font-medium">Vendido</th>
                  <th className="py-2 pr-3 text-right font-medium">Técnico deve</th>
                  <th className="py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className="cursor-pointer border-b last:border-0 hover:bg-muted/40" onClick={() => setOpen(sale)}>
                    <td className="py-2 pr-3">{sale.number}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(sale.createdAt)}</td>
                    <td className="py-2 pr-3">{sale.technicianName}</td>
                    <td className="max-w-64 truncate py-2 pr-3">{sale.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}</td>
                    <td className="py-2 pr-3">{sale.paymentMethodLabel}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(sale.totalAmount)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(sale.totalTechnicianPrice)}</td>
                    <td className="py-2">
                      <StatusBadge tone={STATUS_TONES[sale.status]}>{sale.statusLabel}</StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      <Dialog open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:p-6 sm:max-w-lg">
          {open ? (
            <SaleDetail
              sale={open}
              onChanged={(sale) => {
                setOpen(sale);
                reload();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaleDetail({ sale, onChanged }: { sale: Sale; onChanged: (sale: Sale) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const result = await partsApi<{ sale?: Sale; found?: boolean; delivery?: { whatsapp?: { status: string; error: string | null } | null } }>(
        `/api/parts/sales/${sale.id}`,
        { method: 'POST', json: { action, ...extra } },
      );
      if (result.sale) onChanged(result.sale);
      if (action === 'check') setNotice(result.found ? 'Pagamento confirmado.' : 'O Mercado Pago ainda não confirmou o pagamento.');
      if (action === 'send-receipt' || action === 'send-link') {
        const status = result.delivery?.whatsapp?.status;
        setNotice(status === 'sent' ? 'Enviado ao cliente pelo WhatsApp.' : `Não enviado: ${result.delivery?.whatsapp?.error ?? 'WhatsApp indisponível.'}`);
      }
      if (action === 'cancel') setCancelOpen(false);
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : String(reasonError));
    } finally {
      setBusy(null);
    }
  }

  const margin = sale.totalTechnicianPrice - (sale.totalCost ?? 0);

  return (
    <div className="grid gap-5 text-sm">
      <DialogHeader>
        <DialogTitle>Venda nº {sale.number}</DialogTitle>
        <DialogDescription>
          {sale.technicianName} · {formatDateTime(sale.createdAt)}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 p-4">
        <div>
          <p className="text-xs text-muted-foreground">Total da venda</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCurrency(sale.totalAmount)}</p>
        </div>
        <div className="grid justify-items-end gap-1.5">
          <StatusBadge tone={STATUS_TONES[sale.status]}>{sale.statusLabel}</StatusBadge>
          <StatusBadge tone="info">{sale.paymentMethodLabel}</StatusBadge>
        </div>
      </div>
      {sale.paymentConfirmedBy === 'technician' ? <Alert tone="warning">O técnico marcou este recebimento à mão. Não foi confirmado pelo Mercado Pago.</Alert> : null}

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Peças</h3>
        <ul className="divide-y rounded-xl border">
          {sale.items.map((item) => (
            <li key={item.partId} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  {item.quantity}× {item.name}
                </p>
                <p className="text-xs text-muted-foreground">Técnico deve {formatCurrency(item.unitTechnicianPrice * item.quantity)}</p>
              </div>
              <span className="shrink-0 font-medium tabular-nums">{formatCurrency(item.unitPrice * item.quantity)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cliente</h3>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border p-3">
          <dt className="text-muted-foreground">Nome</dt>
          <dd className="font-medium">{sale.customerName || '—'}</dd>
          <dt className="text-muted-foreground">WhatsApp</dt>
          <dd className="font-medium">{formatPhone(sale.customerPhone)}</dd>
          {sale.orderCode ? (
            <>
              <dt className="text-muted-foreground">Nº da OS</dt>
              <dd className="font-medium">{sale.orderCode}</dd>
            </>
          ) : null}
          {sale.paidAt ? (
            <>
              <dt className="text-muted-foreground">Pago em</dt>
              <dd className="font-medium">{formatDateTime(sale.paidAt)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Recibo</dt>
          <dd className="font-medium">{sale.receiptSentAt ? `Enviado em ${formatDateTime(sale.receiptSentAt)}` : 'Ainda não enviado'}</dd>
          {sale.canceledAt ? (
            <>
              <dt className="text-muted-foreground">Cancelada</dt>
              <dd className="font-medium wrap-anywhere">
                {formatDateTime(sale.canceledAt)} — {sale.cancelReason}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como o dinheiro se divide</h3>
        <dl className="grid gap-1.5 rounded-xl border p-3">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">A empresa recebe do técnico</dt>
            <dd className="font-medium tabular-nums">{formatCurrency(sale.totalTechnicianPrice)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Custo das peças</dt>
            <dd className="font-medium tabular-nums">− {formatCurrency(sale.totalCost ?? 0)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
            <dt>Lucro da empresa</dt>
            <dd className={`tabular-nums ${margin < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatCurrency(margin)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <dt>Fica com o técnico</dt>
            <dd className="tabular-nums">{formatCurrency(sale.totalAmount - sale.totalTechnicianPrice)}</dd>
          </div>
        </dl>
      </section>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {sale.status === 'awaiting_payment' && sale.paymentMethod !== 'cash' ? (
        <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-amber-950">Esperando o cliente pagar. Se ele já pagou, confira no Mercado Pago.</p>
          <Button variant="outline" onClick={() => act('check')} disabled={busy !== null}>
            {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Conferir pagamento
          </Button>
        </div>
      ) : null}
      {sale.status === 'paid' ? (
        <Button variant="outline" onClick={() => act('send-receipt')} disabled={busy !== null}>
          {busy === 'send-receipt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
          Reenviar recibo ao cliente
        </Button>
      ) : null}
      {sale.status !== 'canceled' && !cancelOpen ? (
        <Button variant="ghost" size="lg" className="justify-self-start text-rose-700" onClick={() => setCancelOpen(true)}>
          <XCircle className="h-4 w-4" />
          Cancelar venda
        </Button>
      ) : null}
      {cancelOpen ? (
        <div className="grid gap-2 rounded-xl border border-rose-200 p-3">
          <p className="text-xs text-muted-foreground">
            As peças voltam para o estoque do técnico e o valor sai da conta dele.
            {sale.status === 'paid' ? ' O estorno ao cliente é feito pelo técnico no Mercado Pago.' : ''}
          </p>
          <input className={inputClassName} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo do cancelamento" />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy !== null}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={() => act('cancel', { reason })} disabled={busy !== null || !reason.trim()}>
              Cancelar venda
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatPhone(value: string | null) {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return value;
}
