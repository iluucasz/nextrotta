import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';
import { listInventories, startInventory } from '@/lib/parts/stock';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    return NextResponse.json({ inventories: await listInventories(context.organizationId) });
  } catch (error) {
    return partsError(error, 'list inventories');
  }
}

/** Starts a count of a technician's stock (technicianId) or of the central stock (none). */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    const inventory = await startInventory(context.organizationId, { technicianId: body.technicianId, note: body.note }, context.actor);
    return NextResponse.json({ inventory }, { status: 201 });
  } catch (error) {
    return partsError(error, 'start inventory');
  }
}
