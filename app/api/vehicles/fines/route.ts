import { NextRequest, NextResponse } from 'next/server';
import { organizationHasFeature } from '@/lib/billing/entitlements';
import { readJson, vehiclesRoute } from '@/lib/vehicles/api';
import { providerToken } from '@/lib/vehicles/fines-provider';
import { FINES_LOOKUP_FEATURE } from '@/lib/vehicles/fines-sync';
import { parseFineInput } from '@/lib/vehicles/fines-rules';
import { createFine, loadFines } from '@/lib/vehicles/fines-store';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

/** Every fine of the company, with the numbers for the top of the screen. */
export async function GET(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => {
    const [loaded, enabled] = await Promise.all([loadFines(actor.organizationId), organizationHasFeature(actor.organizationId, FINES_LOOKUP_FEATURE)]);
    // `lookup`: whether the weekly automatic lookup is on for this company (the owner grants it) and the platform has its provider.
    return NextResponse.json({ ...loaded, lookup: { enabled, configured: Boolean(providerToken()) } });
  });
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
