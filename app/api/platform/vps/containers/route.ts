import { NextRequest, NextResponse } from 'next/server';
import { PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';
import { getContainerMetricsHistory, getVpsContainers, type MetricsRange } from '@/lib/platform/vps';

export const runtime = 'nodejs';

/** Every container on the VPS with its owner and live usage; `?name=&range=` gives one's history. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const name = request.nextUrl.searchParams.get('name');
    const range = (request.nextUrl.searchParams.get('range') ?? '24h') as MetricsRange;
    if (name) {
      if (!['24h', '7d', '30d'].includes(range)) throw new PlatformError('Período inválido.');
      return NextResponse.json({ name, range, history: await getContainerMetricsHistory(name, range) });
    }
    return NextResponse.json({ containers: await getVpsContainers() });
  });
}
