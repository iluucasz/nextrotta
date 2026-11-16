import { NextRequest, NextResponse } from 'next/server';
import { resolveNotifications } from '@/lib/notifications';
import { vehiclesRoute } from '@/lib/vehicles/api';

export const runtime = 'nodejs';

/** "Já consultei": takes this week's reminder to look up the cars' fines off the bell. */
export async function POST(request: NextRequest) {
  return vehiclesRoute(request, async (actor) => {
    await resolveNotifications(actor.organizationId, 'fleet:fines-check:');
    return NextResponse.json({ ok: true });
  });
}
