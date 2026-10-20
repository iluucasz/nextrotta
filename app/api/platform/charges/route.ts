import { NextRequest, NextResponse } from 'next/server';
import { listAllCharges, parsePeriod } from '@/lib/platform/overview';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?start=YYYY-MM-DD&end=YYYY-MM-DD — charges of every organization due in the period, plus all overdue ones. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const params = request.nextUrl.searchParams;
    return NextResponse.json({ charges: await listAllCharges(parsePeriod(params.get('start'), params.get('end'))) });
  });
}
