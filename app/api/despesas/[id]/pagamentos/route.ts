import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute, readJson } from '@/lib/expenses-api';
import { addPayment } from '@/lib/expenses-store';
import { brasiliaDateKey } from '@/lib/formatters';

export const runtime = 'nodejs';

/** Pays (or receives) all or part of a bill. Never more than what is left. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return expensesRoute(request, async (actor) => {
    const { id } = await context.params;
    const body = await readJson(request);

    const entry = await addPayment(actor, id, {
      amount: Number(body.amount),
      paid_at: String(body.paid_at ?? '').trim() || brasiliaDateKey(),
      method: body.method ? String(body.method) : null,
      note: body.note ? String(body.note) : null,
    });
    return NextResponse.json({ entry }, { status: 201 });
  });
}
