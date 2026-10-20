import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { getCostAllocation } from '@/lib/platform/costs';

export const runtime = 'nodejs';

/** Estimated cost per organization in the month (`?month=AAAA-MM`, default the current one) against what it pays. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    return NextResponse.json(await getCostAllocation(request.nextUrl.searchParams.get('month') ?? currentMonth));
  });
}
