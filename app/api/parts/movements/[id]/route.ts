import { NextRequest, NextResponse } from 'next/server';
import { correctPurchase, reverseMovement } from '@/lib/parts/corrections';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * Fixes an entry of stock that was launched wrong. action "reverse" undoes an entry or an adjustment;
 * "correct" re-enters a purchase with the right quantity and cost. Both keep the trail (a new row, never an edit).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const body = await readJson(request);
    if (body.action === 'reverse') {
      await reverseMovement(context.organizationId, id, { reason: body.reason }, context.actor);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'correct') {
      await correctPurchase(context.organizationId, id, { quantity: body.quantity, unitCost: body.unitCost, reason: body.reason }, context.actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return partsError(error, 'movement correction');
  }
}
