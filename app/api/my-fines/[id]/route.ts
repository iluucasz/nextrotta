import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { parseDriverResponse } from '@/lib/vehicles/fines-rules';
import { respondToFine } from '@/lib/vehicles/fines-store';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

/** The technician says he is aware of the fine and whether he agrees. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'technician' || !auth.technicianId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => null);
    const parsed = parseDriverResponse(body && typeof body === 'object' ? (body as Record<string, unknown>) : {});
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { id } = await context.params;
    await respondToFine(auth.organizationId, auth.userId, auth.technicianId, id, parsed.value);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof VehicleError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[multas] error:', error);
    return NextResponse.json({ error: 'Não foi possível concluir. Tente de novo.' }, { status: 500 });
  }
}
