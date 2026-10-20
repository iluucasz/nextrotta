import { NextRequest, NextResponse } from 'next/server';
import { disconnect, getAccountStatus, startConnection } from '@/lib/mercadopago/accounts';
import { isUuid } from '@/lib/parts/common';
import { partsContext, partsError } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/** Technician: their connection. Admin: a technician's (?technicianId=). */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const technicianId = context.isAdmin ? request.nextUrl.searchParams.get('technicianId') : context.technicianId;
    if (!isUuid(technicianId)) return NextResponse.json({ error: 'Técnico inválido.' }, { status: 400 });
    return NextResponse.json({ account: await getAccountStatus(context.organizationId, technicianId) });
  } catch (error) {
    return partsError(error, 'mercadopago status');
  }
}

/** The technician starts connecting their own account: returns the Mercado Pago authorization URL. */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'technician');
  if (context instanceof NextResponse) return context;
  try {
    const url = await startConnection(context.organizationId, context.technicianId!, context.auth.userId);
    return NextResponse.json({ url });
  } catch (error) {
    return partsError(error, 'mercadopago connect');
  }
}

/** Disconnects: the technician their own account, the admin any technician's (?technicianId=). */
export async function DELETE(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const technicianId = context.isAdmin ? request.nextUrl.searchParams.get('technicianId') : context.technicianId;
    if (!isUuid(technicianId)) return NextResponse.json({ error: 'Técnico inválido.' }, { status: 400 });
    await disconnect(context.organizationId, technicianId, context.actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return partsError(error, 'mercadopago disconnect');
  }
}
