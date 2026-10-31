'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/management-ui';
import { budgetProgress, cents, spendingByCategory, type ExpenseEntry } from '@/lib/expenses';
import { normalizeAmount } from '@/lib/expenses-import';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { monthLabel } from './ui';
import type { Budget, ExpensesApi } from './use-expenses';

const STATUS_TEXT = { none: '', ok: 'Dentro do limite', warning: 'Perto do limite', over: 'Passou do limite' } as const;

/** A monthly limit per category against what was booked in the month. Saved all at once; 0 clears a limit. */
export function BudgetTab({ entries, budgets, categories, month, api, onNotice }: { entries: ExpenseEntry[]; budgets: Budget[]; categories: string[]; month: string; api: ExpensesApi; onNotice: (message: string) => void }) {
  const saved = useMemo(() => new Map(budgets.map((item) => [item.category, item.amount])), [budgets]);
  const spending = useMemo(() => spendingByCategory(entries, month), [entries, month]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Every category the company uses (settings + what was already booked + what has a limit).
  const names = useMemo(() => [...new Set([...categories, ...budgets.map((item) => item.category), ...entries.filter((entry) => entry.type === 'payable').map((entry) => entry.category)])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [budgets, categories, entries]);

  useEffect(() => {
    setDraft(Object.fromEntries(names.map((name) => [name, saved.get(name) ? String(saved.get(name)).replace('.', ',') : ''])));
  }, [names, saved]);

  const typed = (name: string) => (draft[name]?.trim() ? normalizeAmount(draft[name]) : 0);
  const dirty = names.some((name) => cents(typed(name)) !== cents(saved.get(name) ?? 0));
  const rows = useMemo(() => budgetProgress(names.map((name) => ({ category: name, amount: typed(name) })), spending), [draft, names, spending]); // eslint-disable-line react-hooks/exhaustive-deps
  const totalBudget = cents(rows.reduce((total, row) => total + row.budget, 0));
  const totalSpent = cents(rows.filter((row) => row.budget > 0).reduce((total, row) => total + row.spent, 0));

  async function save() {
    setError('');
    if (names.some((name) => draft[name]?.trim() && !(typed(name) >= 0))) return setError('Confira os valores: use só números.');
    setSaving(true);
    try {
      await api.saveBudgets(names.filter((name) => cents(typed(name)) !== cents(saved.get(name) ?? 0)).map((name) => ({ category: name, amount: typed(name) })));
      onNotice('Orçamento salvo.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mg-section">
      <Panel
        title="Orçamento por categoria"
        description={`Quanto você pode gastar em cada categoria por mês. Comparado com o lançado em ${monthLabel(month)}. Avisamos no sino quando passar do limite.`}
        badge={
          <Button type="button" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Salvando...' : 'Salvar limites'}
          </Button>
        }
      >
        {error ? (
          <div className="mg-notice" role="alert">
            {error}
          </div>
        ) : null}

        {totalBudget > 0 ? (
          <div className="ex-stats three" style={{ marginBottom: 14 }}>
            <article className="ex-stat">
              <span>Limite total</span>
              <strong>{formatCurrency(totalBudget)}</strong>
              <small>nas categorias com limite</small>
            </article>
            <article className="ex-stat">
              <span>Lançado no mês</span>
              <strong>{formatCurrency(totalSpent)}</strong>
              <small>{Math.round((totalSpent / totalBudget) * 100)}% do limite</small>
            </article>
            <article className={cn('ex-stat', totalBudget - totalSpent < 0 ? 'bad' : 'good')}>
              <span>{totalBudget - totalSpent < 0 ? 'Acima do limite' : 'Ainda pode gastar'}</span>
              <strong>{formatCurrency(Math.abs(cents(totalBudget - totalSpent)))}</strong>
              <small>no total</small>
            </article>
          </div>
        ) : (
          <div className="mg-notice">
            <Wallet size={16} />
            <span>Preencha o limite das categorias que quiser acompanhar. Deixe em branco as que não precisam.</span>
          </div>
        )}

        <div>
          {rows.map((row) => (
            <div className="ex-budget-row" key={row.category}>
              <div>
                <strong>{row.category}</strong>
                <small className="block text-muted-foreground">{row.spent > 0 ? `${formatCurrency(row.spent)} lançados` : 'Nada lançado'}</small>
              </div>
              <label className="ex-budget-input">
                <span className="text-sm text-muted-foreground">R$</span>
                <input
                  inputMode="decimal"
                  aria-label={`Limite mensal de ${row.category}`}
                  placeholder="Sem limite"
                  value={draft[row.category] ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, [row.category]: event.target.value.replace(/[^\d.,]/g, '') }))}
                />
              </label>
              <div>
                {row.budget > 0 ? (
                  <>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className={cn(row.status === 'over' && 'font-semibold text-rose-700', row.status === 'warning' && 'font-semibold text-amber-700')}>{STATUS_TEXT[row.status]}</span>
                      <span className="text-muted-foreground">{row.remaining >= 0 ? `sobram ${formatCurrency(row.remaining)}` : `${formatCurrency(-row.remaining)} acima`}</span>
                    </div>
                    <div className={cn('ex-track', row.status)}>
                      <i style={{ width: `${Math.min(100, row.share * 100)}%` }} />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </section>
  );
}
