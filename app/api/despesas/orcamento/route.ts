import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute, readJson } from '@/lib/expenses-api';
import { ExpenseError, saveBudgets } from '@/lib/expenses-store';

export const runtime = 'nodejs';

/** The monthly limit of each category (0 = no limit). Saves what it is given and answers with every limit. */
export async function PUT(request: NextRequest) {
  return expensesRoute(request, async (actor) => {
    const body = await readJson(request);
    if (!Array.isArray(body.budgets)) throw new ExpenseError('Informe os limites por categoria.');

    const budgets = body.budgets.map((item: unknown) => {
      const record = (item ?? {}) as Record<string, unknown>;
      const amount = Number(record.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new ExpenseError('O limite não pode ser negativo.');
      return { category: String(record.category ?? ''), amount };
    });

    return NextResponse.json({ budgets: await saveBudgets(actor, budgets) });
  });
}
