import { NextRequest, NextResponse } from 'next/server';
import { getCreditsOverview } from '@/lib/platform/ai-credits';
import { parsePeriod } from '@/lib/platform/overview';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?start&end — consumption, revenue, provider cost, packages, conversion and top consumers. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await getCreditsOverview(parsePeriod(params.get('start'), params.get('end'))));
  });
}
