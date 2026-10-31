'use client';

import { useEffect, useMemo, useState } from 'react';
import { CopyPlus, Eye, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChartEmpty, Panel } from '@/components/management-ui';
import { cents, dueLabel, filterEntries, remainingOf, type AccountFilters, type ExpenseEntry } from '@/lib/expenses';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { fullDate, monthLabel, payVerb, StateBadge } from './ui';

const PAGE_SIZE = 25;

export type AccountsPreset = { state?: AccountFilters['state']; type?: AccountFilters['type']; stamp: number };

/** Every bill, with the filters people actually use: open, late, paid, by type, category and month, and a search. */
export function Accounts({
  entries,
  today,
  month,
  categories,
  preset,
  onOpen,
  onPay,
  onEdit,
  onDuplicate,
  onDelete,
  onDeleteMany,
}: {
  entries: ExpenseEntry[];
  today: string;
  month: string;
  categories: string[];
  preset: AccountsPreset;
  onOpen: (entry: ExpenseEntry) => void;
  onPay: (entries: ExpenseEntry[]) => void;
  onEdit: (entry: ExpenseEntry) => void;
  onDuplicate: (entry: ExpenseEntry) => void;
  onDelete: (entry: ExpenseEntry) => void;
  onDeleteMany: (entries: ExpenseEntry[]) => void;
}) {
  const [filters, setFilters] = useState<AccountFilters>({ query: '', type: 'all', state: 'open', category: 'all', month: null });
  const [monthOnly, setMonthOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  // A shortcut from another tab ("ver as atrasadas") sets the filters once.
  useEffect(() => {
    if (!preset.stamp) return;
    setFilters((current) => ({ ...current, state: preset.state ?? current.state, type: preset.type ?? current.type, query: '', category: 'all' }));
    setMonthOnly(false);
    setPage(1);
  }, [preset.stamp, preset.state, preset.type]);

  const effective = useMemo(() => ({ ...filters, month: monthOnly ? month : null }), [filters, month, monthOnly]);
  const rows = useMemo(() => filterEntries(entries, effective, today), [entries, effective, today]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const categoryOptions = useMemo(() => [...new Set([...categories, ...entries.map((entry) => entry.category)])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [categories, entries]);
  const picked = rows.filter((entry) => selected.has(entry.id));
  const pickedOpen = picked.filter((entry) => remainingOf(entry) > 0);
  const update = (patch: Partial<AccountFilters>) => {
    setFilters((value) => ({ ...value, ...patch }));
    setPage(1);
  };

  const openPayable = cents(rows.filter((entry) => entry.type === 'payable').reduce((total, entry) => total + remainingOf(entry), 0));
  const openReceivable = cents(rows.filter((entry) => entry.type === 'receivable').reduce((total, entry) => total + remainingOf(entry), 0));

  function toggle(id: string) {
    setSelected((value) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allVisibleSelected = visible.length > 0 && visible.every((entry) => selected.has(entry.id));

  return (
    <section className="mg-section">
      <Panel title="Todas as contas" description="Procure, filtre e dê baixa em várias de uma vez." badge={<span className="mg-badge">{rows.length} CONTAS</span>}>
        <div className="ex-toolbar">
          <label className="mg-search">
            <Search size={15} />
            <input placeholder="Buscar descrição, fornecedor ou categoria" aria-label="Buscar contas" value={filters.query} onChange={(event) => update({ query: event.target.value })} />
          </label>
          <div className="ex-chips" role="group" aria-label="Situação">
            {(
              [
                ['open', 'Em aberto'],
                ['overdue', 'Vencidas'],
                ['paid', 'Pagas'],
                ['all', 'Todas'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" className={filters.state === key ? 'selected' : ''} aria-pressed={filters.state === key} onClick={() => update({ state: key })}>
                {label}
              </button>
            ))}
          </div>
          <select className="ex-select" aria-label="Tipo" value={filters.type} onChange={(event) => update({ type: event.target.value as AccountFilters['type'] })}>
            <option value="all">A pagar e a receber</option>
            <option value="payable">Só a pagar</option>
            <option value="receivable">Só a receber</option>
          </select>
          <select className="ex-select" aria-label="Categoria" value={filters.category} onChange={(event) => update({ category: event.target.value })}>
            <option value="all">Todas as categorias</option>
            {categoryOptions.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[15px]">
            <input type="checkbox" checked={monthOnly} onChange={(event) => { setMonthOnly(event.target.checked); setPage(1); }} />
            Só {monthLabel(month)}
          </label>
        </div>

        {picked.length ? (
          <div className="ex-bulk" role="status">
            <strong>
              {picked.length} selecionada(s) · {formatCurrency(cents(pickedOpen.reduce((total, entry) => total + remainingOf(entry), 0)))} em aberto
            </strong>
            <Button type="button" size="sm" disabled={!pickedOpen.length} onClick={() => onPay(pickedOpen)}>
              Dar baixa
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onDeleteMany(picked)}>
              Excluir
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
          </div>
        ) : null}

        <div className="mg-table-scroll">
          <table className="mg-table ex-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas desta página"
                    checked={allVisibleSelected}
                    onChange={(event) =>
                      setSelected((value) => {
                        const next = new Set(value);
                        visible.forEach((entry) => (event.target.checked ? next.add(entry.id) : next.delete(entry.id)));
                        return next;
                      })
                    }
                  />
                </th>
                <th>Conta</th>
                <th>Vencimento</th>
                <th>Valor</th>
                <th>Situação</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => {
                const open = remainingOf(entry);
                return (
                  <tr key={entry.id}>
                    <td>
                      <input type="checkbox" aria-label={`Selecionar ${entry.description}`} checked={selected.has(entry.id)} onChange={() => toggle(entry.id)} />
                    </td>
                    <td>
                      <button type="button" className="text-left" onClick={() => onOpen(entry)}>
                        <strong className="block">{entry.description}</strong>
                        <small className="text-muted-foreground">
                          {entry.type === 'receivable' ? 'A receber' : entry.category}
                          {entry.supplier ? ` · ${entry.supplier}` : entry.type === 'receivable' ? ` · ${entry.category}` : ''}
                          {entry.installment_total > 1 ? ` · ${entry.installment_number}/${entry.installment_total}` : ''}
                        </small>
                      </button>
                    </td>
                    <td>
                      {fullDate(entry.due_date)}
                      {open > 0 ? <small className={cn('block', entry.due_date < today ? 'font-semibold text-rose-700' : 'text-muted-foreground')}>{dueLabel(entry.due_date, today)}</small> : entry.paid_at ? <small className="block text-muted-foreground">paga em {fullDate(entry.paid_at)}</small> : null}
                    </td>
                    <td className={cn('whitespace-nowrap font-semibold', entry.type === 'receivable' ? 'mg-positive' : '')}>
                      {entry.type === 'receivable' ? '+ ' : ''}
                      {formatCurrency(entry.amount)}
                      {entry.paid_amount > 0 && open > 0 ? <small className="block font-normal text-muted-foreground">falta {formatCurrency(open)}</small> : null}
                    </td>
                    <td>
                      <StateBadge entry={entry} today={today} />
                    </td>
                    <td>
                      <div className="ex-actions">
                        {open > 0 ? (
                          <Button type="button" size="sm" onClick={() => onPay([entry])}>
                            {payVerb(entry.type)}
                          </Button>
                        ) : null}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Mais ações de ${entry.description}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onOpen(entry)}>
                              <Eye className="h-4 w-4" /> Ver detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onEdit(entry)}>
                              <Pencil className="h-4 w-4" /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onDuplicate(entry)}>
                              <CopyPlus className="h-4 w-4" /> Duplicar
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onDelete(entry)} className="text-rose-700">
                              <Trash2 className="h-4 w-4" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length ? (
                <tr className="ex-total-row">
                  <td />
                  <td colSpan={2}>Em aberto neste filtro</td>
                  <td colSpan={3}>
                    {openPayable ? `A pagar ${formatCurrency(openPayable)}` : ''}
                    {openPayable && openReceivable ? ' · ' : ''}
                    {openReceivable ? `A receber ${formatCurrency(openReceivable)}` : ''}
                    {!openPayable && !openReceivable ? '—' : ''}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {!rows.length ? <ChartEmpty message="Nenhuma conta encontrada." /> : null}
        </div>

        <footer className="mg-table-footer">
          <span>{rows.length ? `${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, rows.length)} de ${rows.length}` : '0'} contas</span>
          <div>
            <button className="mg-button" disabled={current === 1} onClick={() => setPage(current - 1)}>
              Anterior
            </button>
            <span>
              {current} / {pageCount}
            </span>
            <button className="mg-button" disabled={current === pageCount} onClick={() => setPage(current + 1)}>
              Próxima
            </button>
          </div>
        </footer>
      </Panel>
    </section>
  );
}
