import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeDebt, cancelDebt, getDebt } from '@/lib/parts/account';
import { partsContext, partsError, readJson, requestIp } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    return NextResponse.json({ debt: await getDebt(context.organizationId, id, context.technicianId ?? undefined) });
  } catch (error) {
    return partsError(error, 'get debt');
  }
}

/** Admin: action "cancel". Technician: action "acknowledge" (agrees with the debt and its installments). */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const body = await readJson(request);
    if (body.action === 'cancel' && context.isAdmin) {
      return NextResponse.json({ debt: await cancelDebt(context.organizationId, id, { reason: body.reason, fromMonth: body.fromMonth }, context.actor) });
    }
    if (body.action === 'acknowledge' && context.technicianId) {
      return NextResponse.json({ debt: await acknowledgeDebt(context.organizationId, id, context.technicianId, context.actor, requestIp(request)) });
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return partsError(error, 'debt action');
  }
}
