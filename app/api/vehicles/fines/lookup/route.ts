import { NextRequest, NextResponse } from 'next/server';
import { organizationHasFeature } from '@/lib/billing/entitlements';
import { brasiliaDateKey } from '@/lib/formatters';
import { vehiclesRoute } from '@/lib/vehicles/api';
import { createProviderFetcher, providerToken } from '@/lib/vehicles/fines-provider';
import { FINES_LOOKUP_FEATURE, lookupOrganization, MANUAL_INTERVAL_MINUTES } from '@/lib/vehicles/fines-sync';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';
// A lookup waits for the Detran through the provider: a few cars per click.
export const maxDuration = 300;

const CARS_PER_CLICK = 5;

/** "Consultar agora": looks the cars' fines up right away (the weekly round does it on its own). */
export async function POST(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => {
    if (!(await organizationHasFeature(actor.organizationId, FINES_LOOKUP_FEATURE))) {
      throw new VehicleError('A consulta automática de multas não está ligada para a sua empresa. Fale com o suporte do NextRotta.', 403);
    }
    const token = providerToken();
    if (!token) throw new VehicleError('A consulta automática ainda não foi configurada pelo NextRotta. Tente mais tarde.', 503);
    const summary = await lookupOrganization(actor.organizationId, createProviderFetcher(token), {
      today: brasiliaDateKey(),
      minIntervalMinutes: MANUAL_INTERVAL_MINUTES,
      maxCars: CARS_PER_CLICK,
    });
    return NextResponse.json(summary);
  });
}
