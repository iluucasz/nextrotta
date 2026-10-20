import { NextRequest, NextResponse } from 'next/server';
import { chooseTerminal, getAccountStatus, getTerminals } from '@/lib/mercadopago/accounts';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/** The Point devices of the technician's Mercado Pago account and which one charges go to. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'technician');
  if (context instanceof NextResponse) return context;
  try {
    const [terminals, status] = await Promise.all([
      getTerminals(context.organizationId, context.technicianId!),
      getAccountStatus(context.organizationId, context.technicianId!),
    ]);
    return NextResponse.json({
      terminals: terminals.map((terminal) => ({ id: terminal.id, operatingMode: terminal.operating_mode ?? null })),
      selected: status.terminalId,
    });
  } catch (error) {
    return partsError(error, 'terminals');
  }
}

/** Chooses the device (switched to PDV mode), or { terminalId: null } to charge with Point Tap in the app. */
export async function PUT(request: NextRequest) {
  const context = await partsContext(request, 'technician');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    const terminalId = typeof body.terminalId === 'string' && body.terminalId.trim() ? body.terminalId.trim() : null;
    await chooseTerminal(context.organizationId, context.technicianId!, terminalId);
    return NextResponse.json({ selected: terminalId });
  } catch (error) {
    return partsError(error, 'choose terminal');
  }
}
