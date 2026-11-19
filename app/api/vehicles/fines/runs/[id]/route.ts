import { NextRequest, NextResponse } from 'next/server';
import { vehiclesRoute } from '@/lib/vehicles/api';
import { getLookupRun } from '@/lib/vehicles/fines-sync';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One lookup of the company with what each agency said about each car (opened from the History tab). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    const run = UUID.test(id) ? await getLookupRun(actor.organizationId, id) : null;
    if (!run) throw new VehicleError('Verificação não encontrada.', 404);
    return NextResponse.json({ run });
  });
}
