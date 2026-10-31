import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute, readJson } from '@/lib/expenses-api';
import { addDays, isDateKey, lastDayOfMonth, parseEntryInput, shiftMonth } from '@/lib/expenses';
import { createEntries, ExpenseError, listBudgets, listEntries } from '@/lib/expenses-store';
import { brasiliaDateKey } from '@/lib/formatters';

export const runtime = 'nodejs';

/**
 * The bills of a window (default: a year back to a year ahead) plus everything still open from before it, each with
 * its payments, and the category budgets. The screen computes every view (today's urgencies, the forecast, the
 * calendar, the month's spending) from this one answer.
 */
export async function GET(request: NextRequest) {
  return expensesRoute(request, async (actor) => {
    const today = brasiliaDateKey();
    const params = request.nextUrl.searchParams;
    const from = params.get('from') ?? `${shiftMonth(today.slice(0, 7), -12)}-01`;
    const to = params.get('to') ?? lastDayOfMonth(shiftMonth(today.slice(0, 7), 12));
    if (!isDateKey(from) || !isDateKey(to) || from > to || to > addDays(from, 366 * 4)) throw new ExpenseError('Período inválido.');

    const [entries, budgets] = await Promise.all([listEntries(actor.organizationId, from, to), listBudgets(actor.organizationId)]);
    return NextResponse.json({ entries, budgets, today, from, to });
  });
}

export async function POST(request: NextRequest) {
  return expensesRoute(request, async (actor) => {
    const parsed = parseEntryInput(await readJson(request));
    if ('error' in parsed) throw new ExpenseError(parsed.error);

    const entries = await createEntries(actor, parsed.entry);
    return NextResponse.json({ entries }, { status: 201 });
  });
}
