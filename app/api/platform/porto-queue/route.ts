import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { callPortoWorkerPlatform } from '@/lib/porto-worker-client';

export const runtime = 'nodejs';

/** The Porto queue across organizations, live from the worker: browser slots, running and waiting runs. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const result = await callPortoWorkerPlatform('/status');
    return NextResponse.json(result.body, { status: result.status });
  });
}
