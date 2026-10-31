'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { cents, PAYMENT_METHODS, remainingOf, type ExpenseEntry } from '@/lib/expenses';
import { normalizeAmount } from '@/lib/expenses-import';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { amountText, Field, Figures, inputClass, MoneyField } from './ui';
import type { ExpensesApi } from './use-expenses';

/**
 * "Dar baixa": the whole bill by default, or part of it. With a selection it pays what is left of each bill on one
 * date. Nothing here can take more than what is open: the server checks it too.
 */
export function PayDialog({ entries, today, api, onClose, onDone }: { entries: ExpenseEntry[]; today: string; api: ExpensesApi; onClose: () => void; onDone: (message: string) => void }) {
  const many = entries.length > 1;
  const single = entries[0];
  const receiving = entries.every((entry) => entry.type === 'receivable');
  const open = cents(entries.reduce((total, entry) => total + remainingOf(entry), 0));

  const [amount, setAmount] = useState(() => amountText(single ? remainingOf(single) : 0));
  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState(() => (single?.payment_method ?? '') as string);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const typed = normalizeAmount(amount);
  const verb = receiving ? 'recebimento' : 'pagamento';

  async function confirm() {
    setError('');
    if (!many && !(typed > 0)) return setError('Informe um valor maior que zero.');
    if (!many && typed > remainingOf(single) + 0.001) return setError(`O valor passa do que falta (${formatCurrency(remainingOf(single))}).`);
    if (!paidAt) return setError('Informe a data.');

    setSaving(true);
    try {
      if (many) {
        const done = await api.payMany(entries.map((entry) => entry.id), paidAt, method || null);
        onDone(`${done.length} conta(s) baixada(s).`);
      } else {
        const result = await api.pay(single.id, { amount: typed, paid_at: paidAt, method: method || null, note: note.trim() || null });
        onDone(result.status === 'paid' ? (receiving ? 'Recebimento registrado.' : 'Conta paga.') : `${receiving ? 'Recebimento' : 'Pagamento'} parcial registrado.`);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{many ? `Dar baixa em ${entries.length} contas` : receiving ? 'Registrar recebimento' : 'Dar baixa na conta'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {many ? 'Cada conta é baixada pelo que ainda falta nela.' : `${single.description}${single.supplier ? ` · ${single.supplier}` : ''}`}
          </DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-5')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

          <Figures
            items={
              many
                ? [{ label: 'Contas', value: entries.length }, { label: 'Total a baixar', value: formatCurrency(open) }]
                : single.paid_amount > 0
                  ? [
                      { label: 'Valor da conta', value: formatCurrency(single.amount) },
                      { label: receiving ? 'Já recebido' : 'Já pago', value: formatCurrency(single.paid_amount) },
                      { label: 'Falta', value: formatCurrency(open) },
                    ]
                  : [
                      { label: 'Valor da conta', value: formatCurrency(single.amount) },
                      { label: 'Vencimento', value: single.due_date.split('-').reverse().join('/') },
                    ]
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {!many ? (
              <MoneyField
                label={receiving ? 'Valor recebido' : 'Valor pago'}
                value={amount}
                onChange={setAmount}
                autoFocus
                hint={typed > 0 && typed < remainingOf(single) ? `Fica faltando ${formatCurrency(cents(remainingOf(single) - typed))}.` : undefined}
              />
            ) : null}
            <Field label="Data">
              <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} className={inputClass} />
            </Field>
            <Field label="Forma de pagamento" className={many ? '' : 'sm:col-span-2'}>
              <select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass}>
                <option value="">Não informar</option>
                {PAYMENT_METHODS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
            {!many ? (
              <Field label="Observação (opcional)" className="sm:col-span-2">
                <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} className={inputClass} placeholder="Ex.: comprovante enviado por e-mail" />
              </Field>
            ) : null}
          </div>
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirm} disabled={saving}>
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'Registrando...' : `Confirmar ${verb}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
