import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';
import { cancelInventory, closeInventory, countInventoryItem, getInventory } from '@/lib/parts/stock';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    return NextResponse.json({ inventory: await getInventory(context.organizationId, id) });
  } catch (error) {
    return partsError(error, 'get inventory');
  }
}

/** action "count" (a barcode read or a typed number), "close" or "cancel". */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const body = await readJson(request);
    if (body.action === 'count') {
      const counted = await countInventoryItem(
        context.organizationId,
        id,
        { barcode: body.barcode, partId: body.partId, add: body.add, set: body.set },
        context.actor,
      );
      return NextResponse.json({ counted });
    }
    if (body.action === 'close') {
      const inventory = await closeInventory(
        context.organizationId,
        id,
        { resolutions: body.resolutions, installments: body.installments, firstDueMonth: body.firstDueMonth, debtDescription: body.debtDescription },
        context.actor,
      );
      return NextResponse.json({ inventory });
    }
    if (body.action === 'cancel') {
      await cancelInventory(context.organizationId, id, context.actor);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return partsError(error, 'inventory action');
  }
}
