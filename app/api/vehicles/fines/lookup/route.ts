import { after, NextRequest, NextResponse } from 'next/server';
import { organizationHasFeature } from '@/lib/billing/entitlements';
import { brasiliaDateKey } from '@/lib/formatters';
import { vehiclesRoute } from '@/lib/vehicles/api';
import { createProviderFetcher, providerToken } from '@/lib/vehicles/fines-provider';
import { beginRun, FINES_LOOKUP_FEATURE, lookupOrganization } from '@/lib/vehicles/fines-sync';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';
// The answer of a Detran can take a while: the lookup finishes after the response, still inside this limit.
export const maxDuration = 300;

/**
 * "Verificar agora": once a day per company. It opens its line in the history (that is what locks the rest of the day),
 * answers right away, and looks the cars up in the background; the screen follows the history.
 */
export async function POST(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => {
    if (!(await organizationHasFeature(actor.organizationId, FINES_LOOKUP_FEATURE))) {
      throw new VehicleError('A consulta automática de multas não está ligada para a sua empresa. Fale com o suporte do NextRotta.', 403);
    }
    const token = providerToken();
    if (!token) throw new VehicleError('A consulta automática ainda não foi configurada pelo NextRotta. Tente mais tarde.', 503);

    const today = brasiliaDateKey();
    const runId = await beginRun(actor.organizationId, 'manual', actor.userId, today);
    if (!runId) throw new VehicleError('Você já verificou hoje. A verificação manual volta amanhã; a automática roda todo domingo.', 429);

    after(async () => {
      try {
        await lookupOrganization(actor.organizationId, createProviderFetcher(token), { today, mode: 'manual', runId });
      } catch (error) {
        console.error('[carros] manual lookup failed:', error);
      }
    });
    return NextResponse.json({ runId }, { status: 202 });
  });
}
