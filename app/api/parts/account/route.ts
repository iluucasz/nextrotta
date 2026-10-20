import { NextRequest, NextResponse } from 'next/server';
import { accountStatement, accountSummary, registerAdjustment, registerPayment } from '@/lib/parts/account';
import { currentMonth, isMonthKey, isUuid } from '@/lib/parts/common';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/**
 * The technicians' accounts in a month (admin: all, or one with ?technicianId=; technician: their
 * own). With a technician, also that month's statement.
 */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const params = request.nextUrl.searchParams;
    const requested = params.get('month');
    const month = isMonthKey(requested) ? requested : currentMonth();
    const technicianId = context.isAdmin ? params.get('technicianId') : context.technicianId;
    const scoped = isUuid(technicianId) ? technicianId : null;
    const summary = await accountSummary(context.organizationId, month, scoped);
    const statement = scoped ? await accountStatement(context.organizationId, scoped, month) : null;
    return NextResponse.json({ month, summary, statement });
  } catch (error) {
    return partsError(error, 'account');
  }
}

/** Admin: action "payment" (the technician paid) or "adjustment". */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    if (body.action === 'payment') {
      await registerPayment(
        context.organizationId,
        { technicianId: body.technicianId, amount: body.amount, method: body.method, description: body.description, month: body.month },
        context.actor,
      );
    } else if (body.action === 'adjustment') {
      await registerAdjustment(
        context.organizationId,
        { technicianId: body.technicianId, amount: body.amount, description: body.description, month: body.month },
        context.actor,
      );
    } else {
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return partsError(error, 'account entry');
  }
}
