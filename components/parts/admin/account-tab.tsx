'use client';

import { useState } from 'react';
import { CheckCircle2, Clock, Loader2, Plus } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/formatters';
import type { AccountSummaryRow } from '@/lib/parts/account';
import { addMonths, formatMonthLabel, SETTLEMENT_METHOD_LABELS, SETTLEMENT_METHODS, type AccountEntryKind, type SettlementMethod } from '@/lib/parts/types';
import { Alert, currentMonthKey, Field, formatDateTime, inputClassName, partsApi, Spinner, useParts, inputClass } from '../shared';
import type { CatalogResponse } from './catalog-tab';

interface StatementEntry {
  id: string;
  kind: AccountEntryKind;
  kindLabel: string;
  amount: number;
  description: string;
  paymentMethod: SettlementMethod | null;
  createdAt: string;
  createdByName: string | null;
}

interface Debt {
  id: string;
  number: number;
  technicianId: string;
  technicianName: string;
  description: string;
  totalAmount: number;
  installments: number;
  firstDueMonth: string;
  status: 'active' | 'canceled';
  createdAt: string;
  acknowledgedAt: string | null;
  cancelReason: string | null;
}

type DialogState =
  | { kind: 'payment'; row: AccountSummaryRow }
  | { kind: 'adjustment'; row: AccountSummaryRow }
  | { kind: 'debt' }
  | { kind: 'cancel-debt'; debt: Debt }
  | null;

export function AccountTab() {
  const [month, setMonth] = useState(currentMonthKey());
  const [selected, setSelected] = useState<string | null>(null);
  const summary = useParts<{ summary: AccountSummaryRow[] }>(`/api/parts/account?month=${month}`);
  const statement = useParts<{ statement: StatementEntry[] | null }>(selected ? `/api/parts/account?month=${month}&technicianId=${selected}` : null);
  const debts = useParts<{ debts: Debt[] }>('/api/parts/debts');
  const catalog = useParts<CatalogResponse>('/api/parts');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState('');

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    summary.reload();
    statement.reload();
    debts.reload();
  }

  const selectedRow = summary.data?.summary.find((row) => row.technicianId === selected) ?? null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada venda soma o preço de técnico na conta do técnico; parcelas de débito entram no mês delas; pagamentos abatem.
        </p>
        <input type="month" className={inputClass('w-auto')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <DataPanel title={`Acerto de ${formatMonthLabel(month)}`} description="Clique em um técnico para ver o extrato e registrar o pagamento.">
        {summary.error ? <Alert>{summary.error}</Alert> : null}
        {!summary.data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Técnico</th>
                  <th className="py-2 pr-3 text-right font-medium">Anterior</th>
                  <th className="py-2 pr-3 text-right font-medium">Vendas</th>
                  <th className="py-2 pr-3 text-right font-medium">Parcelas</th>
                  <th className="py-2 pr-3 text-right font-medium">Ajustes</th>
                  <th className="py-2 pr-3 text-right font-medium">Pago</th>
                  <th className="py-2 pr-3 text-right font-medium">A pagar</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {summary.data.summary.map((row) => (
                  <tr
                    key={row.technicianId}
                    className={`cursor-pointer border-b last:border-0 hover:bg-muted/40 ${selected === row.technicianId ? 'bg-muted/50' : ''}`}
                    onClick={() => setSelected(row.technicianId)}
                  >
                    <td className="py-2 pr-3">{row.technicianName}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.previousBalance)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.salesInMonth)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.installmentsInMonth)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.adjustmentsInMonth)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(row.paidInMonth)}</td>
                    <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${row.balanceDue > 0 ? 'text-amber-700' : ''}`}>{formatCurrency(row.balanceDue)}</td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          setDialog({ kind: 'payment', row });
                        }}
                      >
                        Receber
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      {selectedRow ? (
        <DataPanel
          title={`Extrato de ${selectedRow.technicianName} — ${formatMonthLabel(month)}`}
          description={
            selectedRow.futureInstallments ? `Parcelas de meses seguintes: ${formatCurrency(selectedRow.futureInstallments)}.` : undefined
          }
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'adjustment', row: selectedRow })}>
                Ajuste
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: 'payment', row: selectedRow })}>
                Registrar pagamento
              </Button>
            </div>
          }
        >
          {!statement.data ? (
            <Spinner />
          ) : !statement.data.statement?.length ? (
            <p className="text-sm text-muted-foreground">Sem lançamentos no mês.</p>
          ) : (
            <ul className="divide-y text-sm">
              {statement.data.statement.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                  <div>
                    <p>{entry.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.kindLabel} · {formatDateTime(entry.createdAt)}
                      {entry.createdByName ? ` · ${entry.createdByName}` : ''}
                    </p>
                  </div>
                  <span className={`tabular-nums font-medium ${entry.amount < 0 ? 'text-emerald-700' : ''}`}>{formatCurrency(entry.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </DataPanel>
      ) : null}

      <DataPanel
        title="Débitos de peças"
        description="Peças que faltaram (no inventário ou registradas à mão), pagas em parcelas mensais. O técnico confirma no app."
        action={
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'debt' })}>
            <Plus className="h-4 w-4" />
            Novo débito
          </Button>
        }
      >
        {!debts.data ? (
          <Spinner />
        ) : !debts.data.debts.length ? (
          <p className="text-sm text-muted-foreground">Nenhum débito.</p>
        ) : (
          <ul className="divide-y text-sm">
            {debts.data.debts.map((debt) => (
              <li key={debt.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Nº {debt.number} · {debt.technicianName} · {formatCurrency(debt.totalAmount)} em {debt.installments}x (desde {debt.firstDueMonth.split('-').reverse().join('/')})
                  </p>
                  <p className="text-xs text-muted-foreground">{debt.description}</p>
                  <p className="mt-1 flex flex-wrap gap-2 text-xs">
                    {debt.status === 'canceled' ? (
                      <StatusBadge>Cancelado: {debt.cancelReason}</StatusBadge>
                    ) : debt.acknowledgedAt ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirmado pelo técnico em {formatDateTime(debt.acknowledgedAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Clock className="h-3.5 w-3.5" />
                        Aguardando o técnico confirmar
                      </span>
                    )}
                  </p>
                </div>
                {debt.status === 'active' ? (
                  <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setDialog({ kind: 'cancel-debt', debt })}>
                    Cancelar parcelas
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DataPanel>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          {dialog?.kind === 'payment' ? <PaymentForm row={dialog.row} month={month} onSaved={() => done('Pagamento registrado.')} /> : null}
          {dialog?.kind === 'adjustment' ? <AdjustmentForm row={dialog.row} month={month} onSaved={() => done('Ajuste registrado.')} /> : null}
          {dialog?.kind === 'debt' ? <DebtForm technicians={catalog.data?.technicians ?? []} onSaved={() => done('Débito criado. O técnico confirma no app.')} /> : null}
          {dialog?.kind === 'cancel-debt' ? <CancelDebtForm debt={dialog.debt} onSaved={() => done('Parcelas canceladas.')} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useSubmit(onSaved: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await task();
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function PaymentForm({ row, month, onSaved }: { row: AccountSummaryRow; month: string; onSaved: () => void }) {
  const [amount, setAmount] = useState(row.balanceDue > 0 ? row.balanceDue.toFixed(2).replace('.', ',') : '');
  const [method, setMethod] = useState<SettlementMethod>('pix');
  const [description, setDescription] = useState('');
  const { busy, error, run } = useSubmit(onSaved);

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => partsApi('/api/parts/account', { method: 'POST', json: { action: 'payment', technicianId: row.technicianId, amount, method, description, month } }));
      }}
    >
      <DialogHeader>
        <DialogTitle>Pagamento de {row.technicianName}</DialogTitle>
        <DialogDescription>Saldo a pagar até {formatMonthLabel(month)}: {formatCurrency(row.balanceDue)}.</DialogDescription>
      </DialogHeader>
      <Field label="Valor recebido (R$)">
        <input className={inputClassName} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      </Field>
      <Field label="Forma">
        <select className={inputClassName} value={method} onChange={(event) => setMethod(event.target.value as SettlementMethod)}>
          {SETTLEMENT_METHODS.map((value) => (
            <option key={value} value={value}>
              {SETTLEMENT_METHOD_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Observação (opcional)">
        <input className={inputClassName} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Registrar
        </Button>
      </DialogFooter>
    </form>
  );
}

function AdjustmentForm({ row, month, onSaved }: { row: AccountSummaryRow; month: string; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const { busy, error, run } = useSubmit(onSaved);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => partsApi('/api/parts/account', { method: 'POST', json: { action: 'adjustment', technicianId: row.technicianId, amount, description, month } }));
      }}
    >
      <DialogHeader>
        <DialogTitle>Ajuste na conta de {row.technicianName}</DialogTitle>
        <DialogDescription>Positivo: o técnico passa a dever mais. Negativo: crédito para o técnico.</DialogDescription>
      </DialogHeader>
      <Field label="Valor (R$)">
        <input className={inputClassName} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="-10,00" required />
      </Field>
      <Field label="Motivo">
        <input className={inputClassName} value={description} onChange={(event) => setDescription(event.target.value)} required />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Registrar ajuste
        </Button>
      </DialogFooter>
    </form>
  );
}

function DebtForm({ technicians, onSaved }: { technicians: CatalogResponse['technicians']; onSaved: () => void }) {
  const [technicianId, setTechnicianId] = useState(technicians[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [installments, setInstallments] = useState('1');
  const [firstDueMonth, setFirstDueMonth] = useState(currentMonthKey());
  const { busy, error, run } = useSubmit(onSaved);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => partsApi('/api/parts/debts', { method: 'POST', json: { technicianId, description, totalAmount, installments: Number(installments), firstDueMonth } }));
      }}
    >
      <DialogHeader>
        <DialogTitle>Novo débito</DialogTitle>
        <DialogDescription>Para peças perdidas fora de um inventário. Faltas encontradas no inventário geram o débito sozinhas.</DialogDescription>
      </DialogHeader>
      <Field label="Técnico">
        <select className={inputClassName} value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Descrição (o que aconteceu, quais peças)">
        <textarea className={inputClass('min-h-16 py-2')} value={description} onChange={(event) => setDescription(event.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor total (R$)">
          <input className={inputClassName} value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} inputMode="decimal" required />
        </Field>
        <Field label="Parcelas">
          <input className={inputClassName} value={installments} onChange={(event) => setInstallments(event.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Primeira parcela em">
        <select className={inputClassName} value={firstDueMonth} onChange={(event) => setFirstDueMonth(event.target.value)}>
          {Array.from({ length: 4 }, (_, index) => addMonths(currentMonthKey(), index)).map((month) => (
            <option key={month} value={month}>
              {formatMonthLabel(month)}
            </option>
          ))}
        </select>
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy || !technicianId}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Criar débito
        </Button>
      </DialogFooter>
    </form>
  );
}

function CancelDebtForm({ debt, onSaved }: { debt: Debt; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [fromMonth, setFromMonth] = useState(currentMonthKey());
  const { busy, error, run } = useSubmit(onSaved);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => partsApi(`/api/parts/debts/${debt.id}`, { method: 'POST', json: { action: 'cancel', reason, fromMonth } }));
      }}
    >
      <DialogHeader>
        <DialogTitle>Cancelar parcelas do débito nº {debt.number}</DialogTitle>
        <DialogDescription>As parcelas a partir do mês escolhido deixam de ser cobradas. As anteriores continuam devidas.</DialogDescription>
      </DialogHeader>
      <Field label="Cancelar a partir de">
        <input type="month" className={inputClassName} value={fromMonth} onChange={(event) => event.target.value && setFromMonth(event.target.value)} />
      </Field>
      <Field label="Motivo (ex.: boletim de ocorrência apresentado)">
        <input className={inputClassName} value={reason} onChange={(event) => setReason(event.target.value)} required />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Cancelar parcelas
        </Button>
      </DialogFooter>
    </form>
  );
}

