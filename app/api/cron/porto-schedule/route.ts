import { NextRequest, NextResponse } from 'next/server';
import { resolveCronCaller } from '@/lib/cron-auth';
import { callPortoWorker } from '@/lib/porto-worker-client';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';
export const maxDuration = 60;

// The real unattended daily run lives entirely on the VPS worker's own node-cron schedule
// (worker/index.ts) — this route only serves the admin UI's manual "Testar escala" button,
// proxied to the worker (see lib/porto-worker-client.ts) for the admin's organization.
export async function GET(request: NextRequest) {
  const caller = await resolveCronCaller(request);
  if (!caller.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const featureBlocked = await blockUnlessFeature(caller.organizationId, 'porto');
  if (featureBlocked) return featureBlocked;

  // "Rodar agora" real-run escape hatch (writes actual data).
  const query = request.nextUrl.searchParams.get('write') === '1' ? '?write=1' : '';

  try {
    const { status, body } = await callPortoWorker(caller.organizationId, `/run/schedule${query}`);
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error('[cron/porto-schedule] proxy error:', error);
    return NextResponse.json({ status: 'error', error: error instanceof Error ? error.message : 'Falha ao contatar o worker da VPS.' }, { status: 502 });
  }
}
