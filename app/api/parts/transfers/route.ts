import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';
import { createTransfer, listTransfers } from '@/lib/parts/stock';

export const runtime = 'nodejs';

/** Admin: every remittance/return (optionally of one technician). Technician: their own, without the cost. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const technicianId = context.isAdmin ? request.nextUrl.searchParams.get('technicianId') : context.technicianId;
    const transfers = await listTransfers(context.organizationId, technicianId || null);
    return NextResponse.json({
      transfers: context.isAdmin ? transfers : transfers.map(({ totalCost: _cost, ...transfer }) => transfer),
    });
  } catch (error) {
    return partsError(error, 'list transfers');
  }
}

export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    const transfer = await createTransfer(
      context.organizationId,
      { technicianId: body.technicianId, direction: body.direction, items: body.items, note: body.note },
      context.actor,
    );
    return NextResponse.json({ transfer }, { status: 201 });
  } catch (error) {
    return partsError(error, 'create transfer');
  }
}
