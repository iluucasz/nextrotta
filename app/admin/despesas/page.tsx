'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChartNoAxesCombined, CircleHelp, Download, FileSpreadsheet, ListChecks, LoaderCircle, Plus, Target } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Accounts, type AccountsPreset } from '@/components/expenses/accounts';
import { BudgetTab } from '@/components/expenses/budget';
import { Calendar } from '@/components/expenses/calendar';
import { DeleteDialog, DetailDialog } from '@/components/expenses/detail-dialog';
import { EntryDialog } from '@/components/expenses/entry-dialog';
import { ImportDialog } from '@/components/expenses/import-dialog';
import { Overview } from '@/components/expenses/overview';
import { PayDialog } from '@/components/expenses/pay-dialog';
import { monthLabel } from '@/components/expenses/ui';
import { useExpenses } from '@/components/expenses/use-expenses';
import '@/components/expenses/expenses.css';
import '../dashboard-gerencial/management-dashboard.css';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { entryState, methodLabel, remainingOf, shiftMonth, type EntryType, type ExpenseEntry } from '@/lib/expenses';
import { cn } from '@/lib/utils';

type Tab = 'visao-geral' | 'contas' | 'calendario' | 'orcamento';
const TABS: Array<{ key: Tab; label: string; icon: typeof ListChecks }> = [
  { key: 'visao-geral', label: 'Visão geral', icon: ChartNoAxesCombined },
  { key: 'contas', label: 'Contas', icon: ListChecks },
  { key: 'calendario', label: 'Calendário', icon: CalendarDays },
  { key: 'orcamento', label: 'Orçamento', icon: Target },
];

type Dialog =
  | { kind: 'entry'; mode: 'new' | 'edit' | 'duplicate'; entry?: ExpenseEntry; type?: EntryType; dueDate?: string }
  | { kind: 'pay'; entries: ExpenseEntry[] }
  | { kind: 'delete'; entry: ExpenseEntry }
  | { kind: 'import' }
  | null;

const tabFromHash = (): Tab => {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
  return TABS.some((tab) => tab.key === hash) ? (hash as Tab) : 'visao-geral';
};

export default function ExpensesPage() {
  const { user, loading: sessionLoading } = useAppSession();
  const { settings } = useOrganizationSettings();
  const api = useExpenses();
  const { entries, budgets, today, loading, error, reload } = api;

  const [tab, setTab] = useState<Tab>('visao-geral');
  const [month, setMonth] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [preset, setPreset] = useState<AccountsPreset>({ stamp: 0 });
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTab(tabFromHash());
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The month starts on today's, which the API tells (Brasília), not on the browser's clock.
  useEffect(() => {
    if (today && !month) setMonth(today.slice(0, 7));
  }, [today, month]);

  const notify = useCallback((message: string, undo?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 8000 : 4000);
  }, []);

  const go = useCallback((next: Tab) => {
    setTab(next);
    window.history.replaceState(null, '', `#${next}`);
  }, []);

  const categories = useMemo(() => settings.financeCategories, [settings.financeCategories]);
  const detail = detailId ? entries.find((entry) => entry.id === detailId) ?? null : null;
  const overdueCount = useMemo(() => (today ? entries.filter((entry) => entry.type === 'payable' && entryState(entry, today) === 'overdue').length : 0), [entries, today]);

  async function exportWorkbook() {
    const XLSX = await import('xlsx');
    const rows = entries.map((entry) => ({
      Tipo: entry.type === 'payable' ? 'A pagar' : 'A receber',
      Descrição: entry.description,
      'Fornecedor/Cliente': entry.supplier ?? '',
      Categoria: entry.category,
      Valor: entry.amount,
      Pago: entry.paid_amount,
      Falta: remainingOf(entry),
      Vencimento: entry.due_date,
      Competência: entry.competence_month,
      Situação: entryState(entry, today),
      'Data da baixa': entry.paid_at ?? '',
      'Forma de pagamento': methodLabel(entry.payment_method),
      'Tipo de custo': entry.nature === 'fixed' ? 'Fixo' : 'Variável',
      Observações: entry.notes ?? '',
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = Array.from({ length: 14 }, () => ({ wch: 20 }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Contas');
    XLSX.writeFile(workbook, `despesas-${today}.xlsx`);
  }

  function pay(list: ExpenseEntry[]) {
    const open = list.filter((entry) => remainingOf(entry) > 0);
    if (open.length) setDialog({ kind: 'pay', entries: open });
  }

  async function deleteMany(list: ExpenseEntry[]) {
    if (!window.confirm(`Excluir ${list.length} conta(s)? Você poderá desfazer logo depois.`)) return;
    try {
      const ids = await api.removeMany(list.map((entry) => entry.id));
      notify(`${ids.length} conta(s) excluída(s).`, () => void api.restore(ids).then(() => notify('Contas restauradas.')));
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Não foi possível excluir.');
    }
  }

  if (sessionLoading || !user) {
    return (
      <AppShell role="admin" userName={user?.name || user?.email}>
        <div className="mg-dashboard">
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={25} />
            <strong>Carregando as contas</strong>
          </div>
        </div>
      </AppShell>
    );
  }

  const ready = Boolean(today && month);
  const empty = ready && !entries.length;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <div className="mg-dashboard">
        <header className="mg-page-heading">
          <div>
            <div className="mg-eyebrow">
              <span /> FINANCEIRO <span className="mg-eyebrow-divider">/</span> NEXTROTTA
            </div>
            <h1>
              Despesas<span>.</span>
            </h1>
            <p>Contas a pagar e a receber, o que vence e para onde o dinheiro está indo.</p>
          </div>
          <div className="mg-header-actions ex-header-actions">
            <button className="mg-button" onClick={() => setDialog({ kind: 'import' })}>
              <FileSpreadsheet size={15} /> Importar
            </button>
            <button className="mg-button" onClick={() => void exportWorkbook()} disabled={!entries.length}>
              <Download size={15} /> Exportar
            </button>
            <button className="mg-button mg-button-dark" onClick={() => setDialog({ kind: 'entry', mode: 'new' })}>
              <Plus size={15} /> Nova conta
            </button>
          </div>
        </header>

        <nav className="mg-section-nav ex-tabs" aria-label="Seções de despesas">
          {TABS.map((item) => (
            <button key={item.key} type="button" className={tab === item.key ? 'active' : ''} aria-current={tab === item.key ? 'page' : undefined} onClick={() => go(item.key)}>
              <item.icon size={15} />
              {item.label}
              {item.key === 'contas' && overdueCount > 0 ? <span className="ex-tab-count">{overdueCount}</span> : null}
            </button>
          ))}
        </nav>

        {ready && !empty ? (
          <div className="ex-month-bar" role="group" aria-label="Mês">
            <button className="mg-button mg-button-icon" aria-label="Mês anterior" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeft size={16} />
            </button>
            <strong>{monthLabel(month)}</strong>
            <button className="mg-button mg-button-icon" aria-label="Próximo mês" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRight size={16} />
            </button>
            {month !== today.slice(0, 7) ? (
              <button className="mg-button" onClick={() => setMonth(today.slice(0, 7))}>
                Voltar a hoje
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="mg-error" role="alert">
            <CircleHelp size={23} />
            <div>
              <strong>Não foi possível carregar as contas</strong>
              <p>{error}</p>
            </div>
            <button className="mg-button" onClick={() => void reload()}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        {!ready && !error ? (
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={25} />
            <strong>Carregando as contas</strong>
            <span>Vencimentos, pagamentos e orçamento.</span>
          </div>
        ) : null}

        {empty ? (
          <div className="mg-panel" style={{ marginTop: 24, textAlign: 'center', padding: '48px 24px' }}>
            <h3 style={{ fontSize: 22 }}>Comece pela primeira conta</h3>
            <p style={{ margin: '8px auto 20px', maxWidth: 520, color: 'var(--muted-foreground)' }}>
              Lance o que você precisa pagar ou receber. O sistema avisa dos vencimentos, mostra o saldo das próximas semanas e acompanha o orçamento de cada categoria.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="mg-button mg-button-dark" onClick={() => setDialog({ kind: 'entry', mode: 'new' })}>
                <Plus size={15} /> Lançar uma conta
              </button>
              <button className="mg-button" onClick={() => setDialog({ kind: 'import' })}>
                <FileSpreadsheet size={15} /> Importar de uma planilha
              </button>
            </div>
          </div>
        ) : null}

        {ready && !empty ? (
          <div aria-busy={loading} className={cn(loading && 'opacity-70')}>
            {tab === 'visao-geral' ? (
              <Overview
                entries={entries}
                budgets={budgets}
                today={today}
                month={month}
                onOpen={(entry) => setDetailId(entry.id)}
                onPay={(entry) => pay([entry])}
                onPayAll={pay}
                onGo={(next, filter) => {
                  if (next === 'contas') setPreset({ state: filter ?? 'open', stamp: Date.now() });
                  go(next);
                }}
              />
            ) : null}
            {tab === 'contas' ? (
              <Accounts
                entries={entries}
                today={today}
                month={month}
                categories={categories}
                preset={preset}
                onOpen={(entry) => setDetailId(entry.id)}
                onPay={pay}
                onEdit={(entry) => setDialog({ kind: 'entry', mode: 'edit', entry })}
                onDuplicate={(entry) => setDialog({ kind: 'entry', mode: 'duplicate', entry })}
                onDelete={(entry) => setDialog({ kind: 'delete', entry })}
                onDeleteMany={(list) => void deleteMany(list)}
              />
            ) : null}
            {tab === 'calendario' ? (
              <Calendar
                entries={entries}
                today={today}
                month={month}
                onOpen={(entry) => setDetailId(entry.id)}
                onPay={(entry) => pay([entry])}
                onNew={(dueDate) => setDialog({ kind: 'entry', mode: 'new', dueDate })}
              />
            ) : null}
            {tab === 'orcamento' ? <BudgetTab entries={entries} budgets={budgets} categories={categories} month={month} api={api} onNotice={notify} /> : null}
          </div>
        ) : null}

        {toast ? (
          <div className="ex-toast" role="status">
            <span>{toast.message}</span>
            {toast.undo ? (
              <button
                type="button"
                onClick={() => {
                  toast.undo?.();
                  setToast(null);
                }}
              >
                Desfazer
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {detail && !dialog ? (
        <DetailDialog
          entry={detail}
          all={entries}
          today={today}
          api={api}
          onClose={() => setDetailId(null)}
          onEdit={() => setDialog({ kind: 'entry', mode: 'edit', entry: detail })}
          onPay={() => pay([detail])}
          onDuplicate={() => setDialog({ kind: 'entry', mode: 'duplicate', entry: detail })}
          onDelete={() => setDialog({ kind: 'delete', entry: detail })}
          onOpen={(entry) => setDetailId(entry.id)}
          onNotice={notify}
        />
      ) : null}

      {dialog?.kind === 'entry' ? (
        <EntryDialog
          key={`${dialog.mode}-${dialog.entry?.id ?? 'new'}-${dialog.dueDate ?? ''}`}
          mode={dialog.mode}
          entry={dialog.entry ?? (dialog.dueDate ? ({ due_date: dialog.dueDate } as ExpenseEntry) : undefined)}
          type={dialog.type}
          categories={categories}
          today={today}
          api={api}
          onClose={() => setDialog(null)}
          onSaved={notify}
        />
      ) : null}
      {dialog?.kind === 'pay' ? <PayDialog entries={dialog.entries} today={today} api={api} onClose={() => setDialog(null)} onDone={notify} /> : null}
      {dialog?.kind === 'delete' ? (
        <DeleteDialog
          entry={dialog.entry}
          api={api}
          onClose={() => setDialog(null)}
          onDeleted={(ids, message) => {
            setDetailId(null);
            notify(message, () => void api.restore(ids).then(() => notify('Conta restaurada.')));
          }}
        />
      ) : null}
      {dialog?.kind === 'import' ? <ImportDialog api={api} onClose={() => setDialog(null)} onDone={notify} /> : null}
    </AppShell>
  );
}
