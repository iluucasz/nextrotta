import { NextRequest, NextResponse } from 'next/server';
import { readJson, technicianFrom, vehiclesRoute } from '@/lib/vehicles/api';
import { parseVehicleInput } from '@/lib/vehicles/rules';
import { createVehicle, loadFleet, VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

/** The company's cars and the technicians they can be given to. */
export async function GET(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => NextResponse.json(await loadFleet(actor.organizationId)));
}

/** Adds a car, optionally already with a technician. */
export async function POST(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => {
    const body = await readJson(request);
    const parsed = parseVehicleInput(body);
    if ('error' in parsed) throw new VehicleError(parsed.error);
    const id = await createVehicle(actor, parsed.value, technicianFrom(body) ?? null);
    return NextResponse.json({ id }, { status: 201 });
  });
}
