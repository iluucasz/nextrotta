import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute, readJson } from '@/lib/expenses-api';
import { isDateKey, isMonthKey } from '@/lib/expenses';
import { deleteEntries, ExpenseError, updateEntry, type EntryPatch, type SeriesScope } from '@/lib/expenses-store';

export const runtime = 'nodejs';

const scopeOf = (value: unknown): SeriesScope => (value === 'following' || value === 'all' ? value : 'this');

const text = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Edit a bill; `scope` ("this" | "following" | "all") carries the shared fields over to the rest of its series. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return expensesRoute(request, async (actor) => {
    const { id } = await context.params;
    const body = await readJson(request);
    const patch: EntryPatch = {};

    if ('description' in body) {
      patch.description = text(body.description, 160);
      if (!patch.description) throw new ExpenseError('Informe a descrição da conta.');
    }
    if ('category' in body) patch.category = text(body.category, 60) || 'Geral';
    if ('supplier' in body) patch.supplier = text(body.supplier, 120) || null;
    if ('amount' in body) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e10) throw new ExpenseError('Informe um valor maior que zero.');
      patch.amount = amount;
    }
    if ('due_date' in body) {
      if (!isDateKey(body.due_date)) throw new ExpenseError('Informe uma data de vencimento válida.');
      patch.due_date = body.due_date;
    }
    if ('competence_month' in body && body.competence_month) {
      if (!isMonthKey(body.competence_month)) throw new ExpenseError('A competência precisa ser um mês válido (AAAA-MM).');
      patch.competence_month = body.competence_month;
    }
    if ('payment_method' in body) patch.payment_method = text(body.payment_method, 20) || null;
    if ('payment_code' in body) patch.payment_code = text(body.payment_code, 200) || null;
    if ('nature' in body) patch.nature = body.nature === 'fixed' ? 'fixed' : 'variable';
    if ('notes' in body) patch.notes = text(body.notes, 1000) || null;

    const entries = await updateEntry(actor, id, patch, scopeOf(body.scope));
    return NextResponse.json({ entries });
  });
}

/** Removes a bill (or its series) from the lists. It is only marked deleted: "restaurar" in /lote brings it back. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return expensesRoute(request, async (actor) => {
    const { id } = await context.params;
    const ids = await deleteEntries(actor, id, scopeOf(request.nextUrl.searchParams.get('scope')));
    return NextResponse.json({ ids });
  });
}
