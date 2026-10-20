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
        <Button variant="outline" size="sm" onClick={exportSheet} disabled={!sales.length} className="ml-auto">
          <Download className="h-4 w-4" />
          Exportar
        </Button>
      </div>

      <DataPanel
        title={`Vendas de ${formatMonthLabel(month)}`}
        description={`Vendido ${formatCurrency(totals.sold)} · técnicos devem ${formatCurrency(totals.owed)} · custo ${formatCurrency(totals.cost)} · margem da empresa ${formatCurrency(totals.owed - totals.cost)}`}
      >
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
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
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
    <div className="grid gap-4 text-sm">
      <DialogHeader>
        <DialogTitle>Venda nº {sale.number}</DialogTitle>
        <DialogDescription>
          {sale.technicianName} · {formatDateTime(sale.createdAt)}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={STATUS_TONES[sale.status]}>{sale.statusLabel}</StatusBadge>
        <StatusBadge tone="info">{sale.paymentMethodLabel}</StatusBadge>
        {sale.paymentConfirmedBy === 'technician' ? <StatusBadge tone="warning">Recebimento marcado pelo técnico</StatusBadge> : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">Cliente</dt>
        <dd>{sale.customerName || '—'}</dd>
        <dt className="text-muted-foreground">WhatsApp</dt>
        <dd>{sale.customerPhone || '—'}</dd>
        {sale.orderCode ? (
          <>
            <dt className="text-muted-foreground">OS</dt>
            <dd>{sale.orderCode}</dd>
          </>
        ) : null}
        {sale.paidAt ? (
          <>
            <dt className="text-muted-foreground">Pago em</dt>
            <dd>{formatDateTime(sale.paidAt)}</dd>
          </>
        ) : null}
        {sale.mpPaymentId ? (
          <>
            <dt className="text-muted-foreground">Pagamento MP</dt>
            <dd>{sale.mpPaymentId}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Recibo</dt>
        <dd>{sale.receiptSentAt ? `enviado em ${formatDateTime(sale.receiptSentAt)}` : 'não enviado'}</dd>
        {sale.canceledAt ? (
          <>
            <dt className="text-muted-foreground">Cancelada</dt>
            <dd>
              {formatDateTime(sale.canceledAt)} — {sale.cancelReason}
            </dd>
          </>
        ) : null}
      </dl>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 pr-2 font-medium">Peça</th>
            <th className="py-1.5 pr-2 text-right font-medium">Venda</th>
            <th className="py-1.5 text-right font-medium">Técnico</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((item) => (
            <tr key={item.partId} className="border-b last:border-0">
              <td className="py-1.5 pr-2">
                {item.quantity}× {item.name}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatCurrency(item.unitPrice * item.quantity)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatCurrency(item.unitTechnicianPrice * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="font-semibold">
          <tr>
            <td className="pt-2">Total</td>
            <td className="pt-2 text-right tabular-nums">{formatCurrency(sale.totalAmount)}</td>
            <td className="pt-2 text-right tabular-nums">{formatCurrency(sale.totalTechnicianPrice)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-muted-foreground">
        Custo das peças {formatCurrency(sale.totalCost ?? 0)} · margem da empresa {formatCurrency(margin)} · ganho do técnico {formatCurrency(sale.totalAmount - sale.totalTechnicianPrice)}
      </p>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {sale.status === 'awaiting_payment' && sale.paymentMethod !== 'cash' ? (
          <Button variant="outline" size="sm" onClick={() => act('check')} disabled={busy !== null}>
            {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Conferir pagamento
          </Button>
        ) : null}
        {sale.status === 'paid' ? (
          <Button variant="outline" size="sm" onClick={() => act('send-receipt')} disabled={busy !== null}>
            {busy === 'send-receipt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Reenviar recibo
          </Button>
        ) : null}
        {sale.status !== 'canceled' ? (
          <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => setCancelOpen(true)}>
            <XCircle className="h-4 w-4" />
            Cancelar venda
          </Button>
        ) : null}
      </div>
      {cancelOpen ? (
        <div className="grid gap-2 rounded-lg border border-rose-200 p-3">
          <p className="text-xs text-muted-foreground">
            As peças voltam para o estoque do técnico e o valor sai da conta dele.
            {sale.status === 'paid' ? ' O estorno ao cliente é feito pelo técnico no Mercado Pago.' : ''}
          </p>
          <input className={inputClassName} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" />
          <Button variant="destructive" size="sm" onClick={() => act('cancel', { reason })} disabled={busy !== null || !reason.trim()}>
            Confirmar cancelamento
          </Button>
        </div>
      ) : null}
    </div>
  );
}
