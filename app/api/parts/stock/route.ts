import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';
import { addPurchase, adjustStock } from '@/lib/parts/stock';

export const runtime = 'nodejs';

/** action "purchase": units bought into the central stock. action "adjust": manual correction with a reason. */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    if (body.action === 'purchase') {
      await addPurchase(context.organizationId, { items: body.items, note: body.note, updateCost: body.updateCost }, context.actor);
    } else if (body.action === 'adjust') {
      await adjustStock(
        context.organizationId,
        { partId: body.partId, technicianId: body.technicianId, quantity: body.quantity, note: body.note },
        context.actor,
      );
    } else {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return partsError(error, 'stock');
  }
}
