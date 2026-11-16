import { NextRequest, NextResponse } from 'next/server';
import { readJson, technicianFrom, vehiclesRoute } from '@/lib/vehicles/api';
import { parseVehicleInput } from '@/lib/vehicles/rules';
import { removeVehicle, updateVehicle, vehicleHistory, VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

/** The car's history: who had it and when. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    return NextResponse.json({ history: await vehicleHistory(actor.organizationId, id) });
  });
}

/** Edits the car's data and/or hands it to a technician (technicianId) or takes it back (technicianId: null). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    const body = await readJson(request);
    const parsed = parseVehicleInput(body, true);
    if ('error' in parsed) throw new VehicleError(parsed.error);
    await updateVehicle(actor, id, parsed.value, technicianFrom(body));
    return NextResponse.json({ ok: true });
  });
}

/** Removes the car from the lists (soft delete; the history stays). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    await removeVehicle(actor, id);
    return NextResponse.json({ ok: true });
  });
}
