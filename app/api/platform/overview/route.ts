import { NextRequest, NextResponse } from 'next/server';
import { getOverview, parsePeriod } from '@/lib/platform/overview';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?start=YYYY-MM-DD&end=YYYY-MM-DD (default: this month) — numbers for the panel's overview and finance screens. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const params = request.nextUrl.searchParams;
    return NextResponse.json(await getOverview(parsePeriod(params.get('start'), params.get('end'))));
  });
}
