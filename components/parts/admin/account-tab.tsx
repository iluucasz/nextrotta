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

// Plain-language names for what the account entries are (the server's labels are bookkeeping terms).
const ENTRY_LABELS: Record<AccountEntryKind, string> = {
  sale: 'Peça vendida',
  sale_canceled: 'Venda cancelada',
  debt_installment: 'Parcela de peça faltante',
  debt_canceled: 'Cobrança cancelada',
  payment: 'Pagamento recebido',
  adjustment: 'Desconto ou cobrança extra',
};

function hasMovement(row: AccountSummaryRow) {
  return [row.previousBalance, row.salesInMonth, row.installmentsInMonth, row.adjustmentsInMonth, row.paidInMonth, row.balanceDue].some((value) => value !== 0);
}

export function AccountTab() {
  const [month, setMonth] = useState(currentMonthKey());
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
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

  const rows = [...(summary.data?.summary ?? [])].sort((a, b) => b.balanceDue - a.balanceDue);
  const withMovement = rows.filter(hasMovement);
  const shown = showAll ? rows : withMovement;
  const hidden = rows.length - withMovement.length;
  const totalDue = rows.reduce((sum, row) => sum + Math.max(0, row.balanceDue), 0);
  const owing = rows.filter((row) => row.balanceDue > 0).length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Quanto cada técnico deve à empresa pelas peças que vendeu.</p>
        <input type="month" className={inputClass('w-auto')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {summary.error ? <Alert>{summary.error}</Alert> : null}

      {!summary.data ? (
        <Spinner />
      ) : (
        <>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-xs text-muted-foreground">Falta receber dos técnicos até {formatMonthLabel(month)}</p>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${totalDue > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(totalDue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{owing ? `${owing} técnico(s) com valor a receber` : 'Todos os técnicos estão em dia'}</p>
          </div>

          {!shown.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum técnico com peças ou movimento neste mês.</p>
          ) : (
            <ul className="grid gap-3">
              {shown.map((row) => {
                const owes = row.balanceDue > 0;
                const open = selected === row.technicianId;
                return (
                  <li key={row.technicianId} className="rounded-xl border bg-card">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="truncate font-medium">{row.technicianName}</p>
                        <p className="text-xs text-muted-foreground">{row.salesInMonth ? `Vendas do mês: ${formatCurrency(row.salesInMonth)}` : 'Sem vendas no mês'}</p>
                      </div>
                      <div className="text-right">
                        {owes ? (
                          <>
                            <p className="text-xs text-muted-foreground">Deve</p>
                            <p className="text-xl font-semibold tabular-nums text-amber-700">{formatCurrency(row.balanceDue)}</p>
                          </>
                        ) : row.balanceDue < 0 ? (
                          <>
                            <p className="text-xs text-muted-foreground">Crédito do técnico</p>
                            <p className="text-xl font-semibold tabular-nums text-emerald-700">{formatCurrency(-row.balanceDue)}</p>
                          </>
                        ) : (
                          <StatusBadge tone="success">Em dia</StatusBadge>
                        )}
                      </div>
                      <div className="flex w-full gap-2 sm:w-auto">
                        {owes ? (
                          <Button className="flex-1 sm:flex-none" onClick={() => setDialog({ kind: 'payment', row })}>
                            Receber pagamento
                          </Button>
                        ) : null}
                        <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setSelected(open ? null : row.technicianId)}>
                          {open ? 'Fechar' : 'Ver detalhes'}
                        </Button>
                      </div>
                    </div>

                    {open ? (
                      <div className="grid gap-4 border-t bg-muted/30 p-4 text-sm">
                        <div className="grid gap-1.5">
                          <SummaryLine label="Devido de meses anteriores" value={row.previousBalance} />
                          <SummaryLine label="Peças vendidas no mês" value={row.salesInMonth} />
                          {row.installmentsInMonth ? <SummaryLine label="Parcelas de peças faltantes" value={row.installmentsInMonth} /> : null}
                          {row.adjustmentsInMonth ? <SummaryLine label="Descontos e cobranças extras" value={row.adjustmentsInMonth} /> : null}
                          <SummaryLine label="Já pago" value={-row.paidInMonth} />
                          <div className="flex justify-between gap-3 border-t pt-2 font-semibold">
                            <span>Total que deve</span>
                            <span className="tabular-nums">{formatCurrency(row.balanceDue)}</span>
                          </div>
                          {row.futureInstallments ? <p className="text-xs text-muted-foreground">Ainda virão {formatCurrency(row.futureInstallments)} de parcelas nos próximos meses.</p> : null}
                        </div>

                        <div className="grid gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">O que aconteceu em {formatMonthLabel(month)}</p>
                          {!statement.data ? (
                            <Spinner />
                          ) : !statement.data.statement?.length ? (
                            <p className="text-muted-foreground">Nada lançado neste mês.</p>
                          ) : (
                            <ul className="divide-y rounded-lg border bg-card">
                              {statement.data.statement.map((entry) => (
                                <li key={entry.id} className="flex items-start justify-between gap-3 px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="font-medium">{ENTRY_LABELS[entry.kind] ?? entry.kindLabel}</p>
                                    <p className="text-xs text-muted-foreground wrap-anywhere">
                                      {entry.description} · {formatDateTime(entry.createdAt)}
                                    </p>
                                  </div>
                                  <span className={`shrink-0 font-medium tabular-nums ${entry.amount < 0 ? 'text-emerald-700' : ''}`}>{formatCurrency(entry.amount)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <Button size="lg" variant="outline" onClick={() => setDialog({ kind: 'adjustment', row })}>
                            Dar desconto ou cobrar a mais
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {hidden > 0 || showAll ? (
            <button type="button" className="justify-self-start text-xs font-medium text-primary hover:underline" onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Mostrar só quem tem movimento' : `Mostrar também ${hidden} técnico(s) sem movimento`}
            </button>
          ) : null}
        </>
      )}

      <DataPanel
        title="Peças que faltaram"
        description="Se faltar peça no carro de um técnico (perda ou roubo), o valor vira uma cobrança, dividida em parcelas. Faltas achadas no inventário entram aqui sozinhas."
        action={
          <Button size="lg" variant="outline" onClick={() => setDialog({ kind: 'debt' })}>
            <Plus className="h-4 w-4" />
            Cobrar peça faltante
          </Button>
        }
      >
        {!debts.data ? (
          <Spinner />
        ) : !debts.data.debts.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma cobrança por peça faltante.</p>
        ) : (
          <ul className="divide-y text-sm">
            {debts.data.debts.map((debt) => (
              <li key={debt.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {debt.technicianName} · {formatCurrency(debt.totalAmount)} em {debt.installments}x
                  </p>
                  <p className="text-xs text-muted-foreground wrap-anywhere">
                    {debt.description} · a partir de {formatMonthLabel(debt.firstDueMonth)}
                  </p>
                  <p className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {debt.status === 'canceled' ? (
                      <StatusBadge>Cancelada: {debt.cancelReason}</StatusBadge>
                    ) : debt.acknowledgedAt ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        O técnico concordou em {formatDateTime(debt.acknowledgedAt)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Clock className="h-3.5 w-3.5" />
                        Esperando o técnico concordar no app
                      </span>
                    )}
                  </p>
                </div>
                {debt.status === 'active' ? (
                  <Button size="lg" variant="ghost" className="text-rose-700" onClick={() => setDialog({ kind: 'cancel-debt', debt })}>
                    Cancelar cobrança
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DataPanel>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-md sm:p-6">
          {dialog?.kind === 'payment' ? <PaymentForm row={dialog.row} month={month} onSaved={() => done('Pagamento registrado.')} /> : null}
          {dialog?.kind === 'adjustment' ? <AdjustmentForm row={dialog.row} month={month} onSaved={() => done('Lançamento registrado.')} /> : null}
          {dialog?.kind === 'debt' ? <DebtForm technicians={catalog.data?.technicians ?? []} onSaved={() => done('Cobrança criada. O técnico concorda pelo app.')} /> : null}
          {dialog?.kind === 'cancel-debt' ? <CancelDebtForm debt={dialog.debt} onSaved={() => done('Cobrança cancelada.')} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{formatCurrency(value)}</span>
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

/** Radio buttons drawn as tappable pills. */
function Choice<T extends string>({ value, current, onSelect, children }: { value: T; current: T; onSelect: (value: T) => void; children: React.ReactNode }) {
  const selected = value === current;
  return (
    <label
      className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-center text-sm transition has-focus-visible:ring-2 has-focus-visible:ring-ring ${
        selected ? 'border-primary bg-primary/5 font-medium ring-1 ring-primary' : 'hover:border-primary/40'
      }`}
    >
      <input type="radio" className="sr-only" checked={selected} onChange={() => onSelect(value)} />
      {children}
    </label>
  );
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
        <DialogTitle>Receber de {row.technicianName}</DialogTitle>
        <DialogDescription>
          Ele deve {formatCurrency(row.balanceDue)}. Isso só registra no sistema que ele pagou. O dinheiro você combina direto com ele.
        </DialogDescription>
      </DialogHeader>
      <Field label="Quanto ele pagou? (R$)">
        <input className={inputClass('h-12 text-lg font-semibold tabular-nums')} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" required />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Como ele pagou?</legend>
        <div className="grid grid-cols-2 gap-2">
          {SETTLEMENT_METHODS.map((value) => (
            <Choice key={value} value={value} current={method} onSelect={setMethod}>
              {SETTLEMENT_METHOD_LABELS[value]}
            </Choice>
          ))}
        </div>
      </fieldset>
      <Field label="Observação (opcional)">
        <input className={inputClassName} value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Confirmar recebimento
        </Button>
      </DialogFooter>
    </form>
  );
}

function AdjustmentForm({ row, month, onSaved }: { row: AccountSummaryRow; month: string; onSaved: () => void }) {
  const [kind, setKind] = useState<'discount' | 'extra'>('discount');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const { busy, error, run } = useSubmit(onSaved);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // The server takes one signed amount: negative lowers what the technician owes.
        const unsigned = amount.trim().replace(/^[-+]/, '');
        run(() => partsApi('/api/parts/account', { method: 'POST', json: { action: 'adjustment', technicianId: row.technicianId, amount: kind === 'discount' ? `-${unsigned}` : unsigned, description, month } }));
      }}
    >
      <DialogHeader>
        <DialogTitle>Desconto ou cobrança extra</DialogTitle>
        <DialogDescription>Muda quanto {row.technicianName} deve, sem ligação com uma venda.</DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">O que você quer fazer?</legend>
        <div className="grid grid-cols-2 gap-2">
          <Choice value="discount" current={kind} onSelect={setKind}>
            Dar desconto
            <br />
            (ele deve menos)
          </Choice>
          <Choice value="extra" current={kind} onSelect={setKind}>
            Cobrar a mais
            <br />
            (ele deve mais)
          </Choice>
        </div>
      </fieldset>
      <Field label="Valor (R$)">
        <input className={inputClass('h-12 text-lg font-semibold tabular-nums')} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="10,00" required />
      </Field>
      <Field label="Motivo">
        <input className={inputClassName} value={description} onChange={(event) => setDescription(event.target.value)} required />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Registrar
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
        <DialogTitle>Cobrar peça faltante</DialogTitle>
        <DialogDescription>Use quando o técnico perdeu peças ou não devolveu. O valor é dividido em parcelas e ele precisa concordar pelo app.</DialogDescription>
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
      <Field label="O que faltou? (quais peças e o que aconteceu)">
        <textarea className={inputClass('min-h-16 py-2')} value={description} onChange={(event) => setDescription(event.target.value)} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor total (R$)">
          <input className={inputClassName} value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} inputMode="decimal" required />
        </Field>
        <Field label="Dividir em quantas vezes?">
          <input className={inputClassName} value={installments} onChange={(event) => setInstallments(event.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <Field label="Começar a cobrar em">
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
        <Button type="submit" size="lg" disabled={busy || !technicianId}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Criar cobrança
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
        <DialogTitle>Cancelar cobrança de {debt.technicianName}</DialogTitle>
        <DialogDescription>As parcelas a partir do mês escolhido deixam de ser cobradas. As anteriores continuam valendo.</DialogDescription>
      </DialogHeader>
      <Field label="Parar de cobrar a partir de">
        <input type="month" className={inputClassName} value={fromMonth} onChange={(event) => event.target.value && setFromMonth(event.target.value)} />
      </Field>
      <Field label="Motivo (ex.: boletim de ocorrência apresentado)">
        <input className={inputClassName} value={reason} onChange={(event) => setReason(event.target.value)} required />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" size="lg" variant="destructive" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Cancelar cobrança
        </Button>
      </DialogFooter>
    </form>
  );
}
