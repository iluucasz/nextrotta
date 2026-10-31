'use client';

import { useState } from 'react';
import { Copy, CopyPlus, Pencil, Trash2, Undo2 } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice, ModalSection } from '@/components/modal-kit';
import { dueLabel, entryState, methodLabel, remainingOf, type ExpenseEntry } from '@/lib/expenses';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { fullDate, monthLabel, payVerb, StateBadge } from './ui';
import type { ExpensesApi, SeriesScope } from './use-expenses';

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

/** Everything about one bill: where it stands, what was paid and when (each payment can be undone), its series. */
export function DetailDialog({
  entry,
  all,
  today,
  api,
  onClose,
  onEdit,
  onPay,
  onDuplicate,
  onDelete,
  onOpen,
  onNotice,
}: {
  entry: ExpenseEntry;
  all: ExpenseEntry[];
  today: string;
  api: ExpensesApi;
  onClose: () => void;
  onEdit: () => void;
  onPay: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpen: (entry: ExpenseEntry) => void;
  onNotice: (message: string) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = remainingOf(entry);
  const state = entryState(entry, today);
  const series = entry.series_id ? all.filter((item) => item.series_id === entry.series_id).sort((a, b) => a.installment_number - b.installment_number) : [];

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      onNotice(message);
    } catch {
      setError('Não foi possível copiar. Selecione o código e copie à mão.');
    }
  }

  async function undo(paymentId: string) {
    if (!window.confirm('Desfazer este pagamento? A conta volta a ficar em aberto pelo valor dele.')) return;
    setBusy(true);
    setError('');
    try {
      await api.undoPayment(paymentId);
      onNotice('Pagamento desfeito.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível desfazer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle className={MODAL_TITLE_CLASS}>{entry.description}</DialogTitle>
            <StateBadge entry={entry} today={today} />
          </div>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {entry.type === 'payable' ? 'A pagar' : 'A receber'}
            {entry.supplier ? ` · ${entry.supplier}` : ''} · {entry.category}
            {entry.installment_total > 1 ? ` · ${entry.installment_number}/${entry.installment_total}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-6')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

          <dl className="divide-y divide-border">
            <Line label="Valor">{formatCurrency(entry.amount)}</Line>
            {entry.paid_amount > 0 ? <Line label={entry.type === 'payable' ? 'Já pago' : 'Já recebido'}>{formatCurrency(entry.paid_amount)}</Line> : null}
            {open > 0 && entry.paid_amount > 0 ? <Line label="Falta">{formatCurrency(open)}</Line> : null}
            <Line label="Vencimento">
              {fullDate(entry.due_date)}
              {open > 0 ? <span className={cn('ml-2 text-xs font-normal', state === 'overdue' ? 'text-rose-700' : 'text-muted-foreground')}>{dueLabel(entry.due_date, today)}</span> : null}
            </Line>
            <Line label="Competência">{monthLabel(entry.competence_month)}</Line>
            <Line label="Tipo de custo">{entry.nature === 'fixed' ? 'Fixo' : 'Variável'}</Line>
            {entry.payment_method ? <Line label="Forma de pagamento">{methodLabel(entry.payment_method)}</Line> : null}
          </dl>

          {entry.payment_code ? (
            <ModalSection title="Código para pagar">
              <div className="flex items-start gap-2 rounded-xl bg-secondary/40 p-3">
                <code className="min-w-0 flex-1 break-all text-xs">{entry.payment_code}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => copy(entry.payment_code!, 'Código copiado.')}>
                  <Copy className="h-4 w-4" />
                  Copiar
                </Button>
              </div>
            </ModalSection>
          ) : null}

          {entry.notes ? (
            <ModalSection title="Observações">
              <p className="whitespace-pre-line text-sm text-muted-foreground">{entry.notes}</p>
            </ModalSection>
          ) : null}

          <ModalSection title={entry.type === 'payable' ? 'Pagamentos' : 'Recebimentos'}>
            {entry.payments.length ? (
              <ul className="divide-y divide-border">
                {entry.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{formatCurrency(payment.amount)}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        em {fullDate(payment.paid_at)}
                        {payment.method ? ` · ${methodLabel(payment.method)}` : ''}
                      </span>
                      {payment.note ? <span className="block truncate text-xs text-muted-foreground">{payment.note}</span> : null}
                    </span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => undo(payment.id)} disabled={busy} aria-label="Desfazer pagamento">
                      <Undo2 className="h-4 w-4" />
                      Desfazer
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{entry.type === 'payable' ? 'Nada foi pago ainda.' : 'Nada foi recebido ainda.'}</p>
            )}
          </ModalSection>

          {series.length > 1 ? (
            <ModalSection title="Outras contas desta série">
              <ul className="divide-y divide-border">
                {series.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => item.id !== entry.id && onOpen(item)} className={cn('flex w-full items-center justify-between gap-3 py-2 text-left text-sm', item.id === entry.id ? 'font-semibold' : 'hover:text-primary')}>
                      <span>
                        {item.installment_number}/{item.installment_total} · {fullDate(item.due_date)}
                      </span>
                      <span className="flex items-center gap-2">
                        {formatCurrency(item.amount)}
                        <StateBadge entry={item} today={today} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </ModalSection>
          ) : null}
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col gap-2 sm:flex-row sm:justify-between')}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDuplicate}>
              <CopyPlus className="h-4 w-4" />
              Duplicar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onDelete} className="text-rose-700 hover:text-rose-800">
              <Trash2 className="h-4 w-4" />
              Excluir
            </Button>
          </div>
          {open > 0 ? <Button type="button" onClick={onPay}>{payVerb(entry.type)}</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks before removing a bill; for a series it asks how far: this one, this and the next ones, or all of them. */
export function DeleteDialog({ entry, api, onClose, onDeleted }: { entry: ExpenseEntry; api: ExpensesApi; onClose: () => void; onDeleted: (ids: string[], message: string) => void }) {
  const inSeries = Boolean(entry.series_id && entry.installment_total > 1);
  const [scope, setScope] = useState<SeriesScope>('this');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setSaving(true);
    setError('');
    try {
      const ids = await api.remove(entry.id, scope);
      onDeleted(ids, ids.length > 1 ? `${ids.length} contas excluídas.` : 'Conta excluída.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Excluir esta conta?</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {entry.description} · {formatCurrency(entry.amount)} · {fullDate(entry.due_date)}
          </DialogDescription>
        </DialogHeader>
        <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
          {entry.paid_amount > 0 ? <ModalNotice tone="warning">Esta conta tem pagamento registrado. Ao excluir, ele sai dos totais.</ModalNotice> : null}
          {inSeries ? (
            <fieldset className="space-y-2">
              {(
                [
                  ['this', 'Só esta conta'],
                  ['following', 'Esta e as próximas'],
                  ['all', 'Toda a série'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="delete-scope" checked={scope === key} onChange={() => setScope(key)} />
                  {label}
                </label>
              ))}
            </fieldset>
          ) : null}
          <p className="text-sm text-muted-foreground">Você pode desfazer logo depois de excluir.</p>
        </div>
        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button type="button" onClick={confirm} disabled={saving} className="bg-rose-600 text-white hover:bg-rose-700">
            {saving ? 'Excluindo...' : 'Sim, excluir'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
