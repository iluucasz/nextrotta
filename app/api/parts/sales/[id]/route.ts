import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';
import { cancelSale, checkPayment, confirmReceived, getSale, retryPayment, sendPaymentLink, sendReceipt } from '@/lib/parts/sales';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    return NextResponse.json({ sale: await getSale(context.organizationId, id, context.technicianId) });
  } catch (error) {
    return partsError(error, 'get sale');
  }
}

/**
 * Actions on a sale:
 * - check: asks Mercado Pago whether the customer paid (screens poll it);
 * - retry: new charge, optionally with another paymentMethod (technician);
 * - confirm: the technician received in cash or outside the system;
 * - cancel: parts back to the technician's stock (technician: unpaid only; admin: any);
 * - send-link / send-receipt: WhatsApp to the customer again.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const body = await readJson(request);
    const { organizationId, technicianId, actor } = context;

    switch (body.action) {
      case 'check': {
        const result = await checkPayment(organizationId, id, technicianId);
        return NextResponse.json(result);
      }
      case 'retry': {
        if (!technicianId) break;
        const sale = await retryPayment(organizationId, id, technicianId, { paymentMethod: body.paymentMethod }, actor);
        const delivery =
          sale.status === 'awaiting_payment' && (sale.paymentMethod === 'pix' || sale.paymentMethod === 'card_link') && !sale.paymentError
            ? await sendPaymentLink(organizationId, sale.id, technicianId, actor.id).catch(() => null)
            : null;
        return NextResponse.json({ sale, delivery });
      }
      case 'confirm': {
        if (!technicianId) break;
        const sale = await confirmReceived(organizationId, id, technicianId, actor);
        return NextResponse.json({ sale });
      }
      case 'cancel': {
        const sale = await cancelSale(organizationId, id, { reason: body.reason, technicianId }, actor);
        return NextResponse.json({ sale });
      }
      case 'send-link': {
        const delivery = await sendPaymentLink(organizationId, id, technicianId, actor.id);
        return NextResponse.json({ delivery });
      }
      case 'send-receipt': {
        const delivery = await sendReceipt(organizationId, id, technicianId, { force: true, actorId: actor.id });
        if (delivery.whatsapp?.status === 'sent') {
          return NextResponse.json({ delivery, sale: await getSale(organizationId, id, technicianId) });
        }
        return NextResponse.json({ delivery });
      }
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    return partsError(error, 'sale action');
  }
}
