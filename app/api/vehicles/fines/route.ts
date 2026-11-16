import { NextRequest, NextResponse } from 'next/server';
import { readJson, vehiclesRoute } from '@/lib/vehicles/api';
import { parseFineInput } from '@/lib/vehicles/fines-rules';
import { createFine, loadFines } from '@/lib/vehicles/fines-store';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

/** Every fine of the company, with the numbers for the top of the screen. */
export async function GET(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => NextResponse.json(await loadFines(actor.organizationId)));
}

/** Registers a fine. */
export async function POST(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => {
    const body = await readJson(request);
    const parsed = parseFineInput(body);
    if ('error' in parsed) throw new VehicleError(parsed.error);
    const id = await createFine(actor, parsed.value);
    return NextResponse.json({ id }, { status: 201 });
  });
}
