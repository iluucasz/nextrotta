'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExpenseEntry } from '@/lib/expenses';

export type Budget = { category: string; amount: number };
export type SeriesScope = 'this' | 'following' | 'all';
export type PaymentForm = { amount: number; paid_at: string; method: string | null; note: string | null };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Não foi possível concluir. Tente de novo.');
  return data as T;
}

const post = (url: string, body: unknown) => call<Record<string, unknown>>(url, { method: 'POST', body: JSON.stringify(body) });

/** Puts the answered entries into the list (replacing the ones it already has), keeping the due-date order. */
function merge(current: ExpenseEntry[], incoming: ExpenseEntry[]) {
  const byId = new Map(current.map((entry) => [entry.id, entry]));
  incoming.forEach((entry) => byId.set(entry.id, entry));
  return [...byId.values()].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description, 'pt-BR'));
}

/**
 * The company's bills and budgets, and what the screen can do with them. Every action talks to the API and then
 * updates the list from the answer, so the screen never has to reload everything after a payment.
 */
export function useExpenses() {
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await call<{ entries: ExpenseEntry[]; budgets: Budget[]; today: string }>('/api/despesas');
      if (!mounted.current) return;
      setEntries(data.entries);
      setBudgets(data.budgets);
      setToday(data.today);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as contas.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const apply = useCallback((incoming: ExpenseEntry[]) => setEntries((current) => merge(current, incoming)), []);
  const drop = useCallback((ids: string[]) => setEntries((current) => current.filter((entry) => !ids.includes(entry.id))), []);

  return {
    entries,
    budgets,
    today,
    loading,
    error,
    reload,

    async create(payload: Record<string, unknown>) {
      const data = (await post('/api/despesas', payload)) as { entries: ExpenseEntry[] };
      apply(data.entries);
      return data.entries;
    },
    async update(id: string, patch: Record<string, unknown>, scope: SeriesScope = 'this') {
      const data = await call<{ entries: ExpenseEntry[] }>(`/api/despesas/${id}`, { method: 'PATCH', body: JSON.stringify({ ...patch, scope }) });
      apply(data.entries);
      return data.entries;
    },
    async remove(id: string, scope: SeriesScope = 'this') {
      const data = await call<{ ids: string[] }>(`/api/despesas/${id}?scope=${scope}`, { method: 'DELETE' });
      drop(data.ids);
      return data.ids;
    },
    async removeMany(ids: string[]) {
      const data = (await post('/api/despesas/lote', { action: 'delete', ids })) as { ids: string[] };
      drop(data.ids);
      return data.ids;
    },
    async restore(ids: string[]) {
      const data = (await post('/api/despesas/lote', { action: 'restore', ids })) as { entries: ExpenseEntry[] };
      apply(data.entries);
    },
    async pay(id: string, form: PaymentForm) {
      const data = (await post(`/api/despesas/${id}/pagamentos`, form)) as { entry: ExpenseEntry };
      apply([data.entry]);
      return data.entry;
    },
    async payMany(ids: string[], paidAt: string, method: string | null) {
      const data = (await post('/api/despesas/lote', { action: 'pay', ids, paid_at: paidAt, method })) as { entries: ExpenseEntry[] };
      apply(data.entries);
      return data.entries;
    },
    async undoPayment(paymentId: string) {
      const data = await call<{ entry: ExpenseEntry }>(`/api/despesas/pagamentos/${paymentId}`, { method: 'DELETE' });
      apply([data.entry]);
      return data.entry;
    },
    async saveBudgets(list: Budget[]) {
      const data = await call<{ budgets: Budget[] }>('/api/despesas/orcamento', { method: 'PUT', body: JSON.stringify({ budgets: list }) });
      setBudgets(data.budgets);
    },
    async importRows(rows: Record<string, unknown>[]) {
      const data = (await post('/api/despesas/importar', { entries: rows })) as { imported: number; rejected: Array<{ line: number; reason: string }> };
      await reload();
      return data;
    },
  };
}

export type ExpensesApi = ReturnType<typeof useExpenses>;
