import { NextRequest, NextResponse } from 'next/server';
import { isMonthKey } from '@/lib/parts/common';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';
import { createSale, listSales, sendPaymentLink } from '@/lib/parts/sales';

export const runtime = 'nodejs';

/** Admin: every sale (filters technicianId, month, status). Technician: their own. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const params = request.nextUrl.searchParams;
    const month = params.get('month');
    const sales = await listSales(context.organizationId, {
      technicianId: context.isAdmin ? params.get('technicianId') || null : context.technicianId,
      month: isMonthKey(month) ? month : null,
      status: params.get('status'),
      asTechnician: !context.isAdmin,
    });
    return NextResponse.json({ sales });
  } catch (error) {
    return partsError(error, 'list sales');
  }
}

/**
 * The technician sells: stock leaves, the charge is created in their Mercado Pago account and the
 * payment link goes to the customer's WhatsApp.
 */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'technician');
  if (context instanceof NextResponse) return context;
  try {
    const sale = await createSale(context.organizationId, context.technicianId!, await readJson(request), context.actor);
    let delivery = null;
    if ((sale.paymentMethod === 'pix' || sale.paymentMethod === 'card_link') && !sale.paymentError) {
      delivery = await sendPaymentLink(context.organizationId, sale.id, context.technicianId, context.actor.id).catch((error) => {
        console.error('[parts] send payment link:', error);
        return null;
      });
    }
    return NextResponse.json({ sale, delivery }, { status: 201 });
  } catch (error) {
    return partsError(error, 'create sale');
  }
}
