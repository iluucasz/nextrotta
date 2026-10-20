import { NextRequest, NextResponse } from 'next/server';
import { createDebt, listDebts } from '@/lib/parts/account';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const technicianId = context.isAdmin ? request.nextUrl.searchParams.get('technicianId') : context.technicianId;
    return NextResponse.json({ debts: await listDebts(context.organizationId, technicianId || null) });
  } catch (error) {
    return partsError(error, 'list debts');
  }
}

/** A debt set by hand (e.g. a part lost outside an inventory), in installments. */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    const debt = await createDebt(
      context.organizationId,
      {
        technicianId: body.technicianId,
        description: body.description,
        totalAmount: body.totalAmount,
        installments: body.installments,
        firstDueMonth: body.firstDueMonth,
      },
      context.actor,
    );
    return NextResponse.json({ debt }, { status: 201 });
  } catch (error) {
    return partsError(error, 'create debt');
  }
}
