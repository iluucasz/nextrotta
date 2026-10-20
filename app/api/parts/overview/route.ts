import { NextRequest, NextResponse } from 'next/server';
import { currentMonth, isMonthKey } from '@/lib/parts/common';
import { partsOverview } from '@/lib/parts/overview';
import { partsContext, partsError } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const month = request.nextUrl.searchParams.get('month');
    return NextResponse.json({ overview: await partsOverview(context.organizationId, isMonthKey(month) ? month : currentMonth()) });
  } catch (error) {
    return partsError(error, 'overview');
  }
}
