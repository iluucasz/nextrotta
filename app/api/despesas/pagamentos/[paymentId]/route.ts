import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute } from '@/lib/expenses-api';
import { undoPayment } from '@/lib/expenses-store';

export const runtime = 'nodejs';

/** Undoes a payment: it is marked deleted and the bill is recalculated from the payments that remain. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ paymentId: string }> }) {
  return expensesRoute(request, async (actor) => {
    const { paymentId } = await context.params;
    const entry = await undoPayment(actor, paymentId);
    return NextResponse.json({ entry });
  });
}
