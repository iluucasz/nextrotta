'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice, SegmentedControl } from '@/components/modal-kit';
import { addMonths, cents, PAYMENT_METHODS, splitInstallmentAmounts, type EntryNature, type EntryType, type ExpenseEntry } from '@/lib/expenses';
import { normalizeAmount } from '@/lib/expenses-import';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { Field, fullDate, inputClass, MoneyField } from './ui';
import type { ExpensesApi, SeriesScope } from './use-expenses';

type Mode = 'new' | 'edit' | 'duplicate';

const NEW_CATEGORY = '__new__';

/**
 * One form for a new bill, an edit and a copy. The essentials are on top (what, who, how much, when, how often); the
 * rest (how it is paid, the boleto code, fixed or variable, the competence, notes) is one click away.
 */
export function EntryDialog({
  mode,
  entry,
  type: initialType = 'payable',
  categories,
  today,
  api,
  onClose,
  onSaved,
}: {
  mode: Mode;
  entry?: ExpenseEntry;
  type?: EntryType;
  categories: string[];
  today: string;
  api: ExpensesApi;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = mode === 'edit' && entry;
  const inSeries = Boolean(editing && entry.series_id && entry.installment_total > 1);

  const [type, setType] = useState<EntryType>(entry?.type ?? initialType);
  const [description, setDescription] = useState(entry?.description ?? '');
  const [supplier, setSupplier] = useState(entry?.supplier ?? '');
  const [category, setCategory] = useState(entry?.category ?? 'Geral');
  const [newCategory, setNewCategory] = useState('');
  const [amount, setAmount] = useState(entry?.amount ? String(entry.amount).replace('.', ',') : '');
  const [dueDate, setDueDate] = useState(mode === 'duplicate' ? addMonths(entry!.due_date, 1) : (entry?.due_date ?? today));
  const [competence, setCompetence] = useState(mode === 'edit' ? (entry?.competence_month ?? '') : '');
  const [repeat, setRepeat] = useState<'single' | 'installments' | 'recurring'>('single');
  const [repeatCount, setRepeatCount] = useState('12');
  const [nature, setNature] = useState<EntryNature>(entry?.nature ?? 'variable');
  const [natureTouched, setNatureTouched] = useState(false);
  const [method, setMethod] = useState(entry?.payment_method ?? '');
  const [code, setCode] = useState(entry?.payment_code ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [paidAt, setPaidAt] = useState(today);
  const [scope, setScope] = useState<SeriesScope>('this');
  const [moreOpen, setMoreOpen] = useState(Boolean(entry && (entry.payment_code || entry.notes || entry.payment_method)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() => {
    const list = new Set(categories);
    if (category && category !== NEW_CATEGORY) list.add(category);
    return [...list].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [categories, category]);

  const value = normalizeAmount(amount);
  const count = Math.min(120, Math.max(2, Math.round(Number(repeatCount)) || 2));
  const summary =
    repeat === 'single' || !(value > 0)
      ? ''
      : repeat === 'installments'
        ? (() => {
            const parts = splitInstallmentAmounts(value, count);
            const same = parts.every((part) => part === parts[0]);
            return same ? `${count} parcelas de ${formatCurrency(parts[0])}, a última em ${fullDate(addMonths(dueDate, count - 1))}.` : `${count} parcelas de ${formatCurrency(parts[count - 1])} a ${formatCurrency(parts[0])}, a última em ${fullDate(addMonths(dueDate, count - 1))}.`;
          })()
        : `${count} lançamentos de ${formatCurrency(value)}, o último em ${fullDate(addMonths(dueDate, count - 1))}.`;

  const noun = type === 'payable' ? 'Fornecedor' : 'Cliente';

  async function save() {
    setError('');
    const finalCategory = category === NEW_CATEGORY ? newCategory.trim() : category;
    if (!description.trim()) return setError('Informe a descrição da conta.');
    if (!(value > 0)) return setError('Informe um valor maior que zero.');
    if (!dueDate) return setError('Informe a data de vencimento.');
    if (category === NEW_CATEGORY && !finalCategory) return setError('Escreva o nome da nova categoria.');

    const payload = {
      type,
      description,
      supplier,
      category: finalCategory || 'Geral',
      amount: cents(value),
      due_date: dueDate,
      competence_month: competence || undefined,
      payment_method: method || null,
      payment_code: code,
      nature: natureTouched || editing ? nature : repeat === 'recurring' ? 'fixed' : nature,
      notes,
    };

    setSaving(true);
    try {
      if (editing) {
        await api.update(entry.id, payload, scope);
        onSaved('Conta atualizada.');
      } else {
        const created = await api.create({ ...payload, repeat, repeat_count: count, paid_at: repeat === 'single' && alreadyPaid ? paidAt : null });
        onSaved(created.length > 1 ? `${created.length} contas criadas.` : 'Conta criada.');
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{editing ? 'Editar conta' : mode === 'duplicate' ? 'Duplicar conta' : type === 'payable' ? 'Nova conta a pagar' : 'Nova conta a receber'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {editing ? 'Mude o que for preciso. O que já foi pago continua registrado.' : 'O essencial primeiro: o resto é opcional.'}
          </DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-5')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

          {!editing ? (
            <SegmentedControl
              label="Tipo de conta"
              value={type}
              onChange={setType}
              options={[
                { value: 'payable', label: 'A pagar' },
                { value: 'receivable', label: 'A receber' },
              ]}
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Descrição" className="sm:col-span-2">
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={160} className={inputClass} placeholder={type === 'payable' ? 'Ex.: Aluguel da base, Combustível' : 'Ex.: Contrato mensal'} autoFocus={!editing} />
            </Field>
            <Field label={noun} hint="Opcional. Ajuda a achar a conta depois.">
              <input value={supplier} onChange={(event) => setSupplier(event.target.value)} maxLength={120} className={inputClass} />
            </Field>
            <Field label="Categoria">
              <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
                {options.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>Outra categoria…</option>
              </select>
              {category === NEW_CATEGORY ? <input value={newCategory} onChange={(event) => setNewCategory(event.target.value)} maxLength={60} className={cn(inputClass, 'mt-2')} placeholder="Nome da categoria" autoFocus /> : null}
            </Field>
            <MoneyField label={repeat === 'installments' ? 'Valor total' : 'Valor'} value={amount} onChange={setAmount} />
            <Field label="Vencimento">
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className={inputClass} />
            </Field>
          </div>

          {!editing ? (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-foreground">Quantas vezes?</span>
              <div className="flex flex-wrap items-center gap-3">
                <SegmentedControl
                  label="Repetição"
                  value={repeat}
                  onChange={setRepeat}
                  options={[
                    { value: 'single', label: 'Uma vez' },
                    { value: 'installments', label: 'Parcelada' },
                    { value: 'recurring', label: 'Todo mês' },
                  ]}
                />
                {repeat !== 'single' ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input value={repeatCount} onChange={(event) => setRepeatCount(event.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className={cn(inputClass, 'w-20 text-center')} aria-label="Quantidade" />
                    {repeat === 'installments' ? 'parcelas' : 'meses'}
                  </label>
                ) : null}
              </div>
              {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
            </div>
          ) : null}

          {inSeries ? (
            <fieldset className="space-y-2 rounded-xl bg-secondary/40 p-4">
              <legend className="px-1 text-sm font-medium">
                Esta conta é a {entry?.installment_number}ª de {entry?.installment_total}. Aplicar a:
              </legend>
              {(
                [
                  ['this', 'Só esta conta'],
                  ['following', 'Esta e as próximas'],
                  ['all', 'Toda a série'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="radio" name="scope" checked={scope === key} onChange={() => setScope(key)} />
                  {label}
                </label>
              ))}
              <p className="text-xs text-muted-foreground">Descrição, categoria, {noun.toLowerCase()}, valor e forma de pagamento vão para as escolhidas. O valor só muda onde ainda não foi pago acima dele.</p>
            </fieldset>
          ) : null}

          {!editing && repeat === 'single' ? (
            <div className="rounded-xl bg-secondary/40 p-4">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={alreadyPaid} onChange={(event) => setAlreadyPaid(event.target.checked)} />
                {type === 'payable' ? 'Esta conta já foi paga' : 'Este valor já foi recebido'}
              </label>
              {alreadyPaid ? (
                <Field label="Data" className="mt-3 max-w-[220px]">
                  <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} className={inputClass} />
                </Field>
              ) : null}
            </div>
          ) : null}

          <div>
            <button type="button" onClick={() => setMoreOpen((value) => !value)} aria-expanded={moreOpen} className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Mais detalhes
              <ChevronDown className={cn('h-4 w-4 transition-transform', moreOpen && 'rotate-180')} />
            </button>
            {moreOpen ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Forma de pagamento">
                  <select value={method} onChange={(event) => setMethod(event.target.value)} className={inputClass}>
                    <option value="">Não informar</option>
                    {PAYMENT_METHODS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tipo de custo" hint="Fixo se repete todo mês; variável muda com a operação.">
                  <select
                    value={nature}
                    onChange={(event) => {
                      setNature(event.target.value as EntryNature);
                      setNatureTouched(true);
                    }}
                    className={inputClass}
                  >
                    <option value="variable">Variável</option>
                    <option value="fixed">Fixo</option>
                  </select>
                </Field>
                {type === 'payable' ? (
                  <Field label="Código de barras ou Pix copia e cola" className="sm:col-span-2" hint="Fica guardado na conta para copiar na hora de pagar.">
                    <input value={code} onChange={(event) => setCode(event.target.value)} maxLength={200} className={cn(inputClass, 'font-mono text-xs')} />
                  </Field>
                ) : null}
                <Field label="Competência" hint="O mês a que a conta pertence. Normalmente é o do vencimento.">
                  <input type="month" value={competence} onChange={(event) => setCompetence(event.target.value)} className={inputClass} />
                </Field>
                <Field label="Observações" className="sm:col-span-2">
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={3} className={cn(inputClass, 'h-auto py-2')} />
                </Field>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? 'Salvando...' : editing ? 'Salvar alterações' : repeat === 'single' ? 'Criar conta' : `Criar ${count} contas`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
