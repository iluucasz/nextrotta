import { NextRequest, NextResponse } from 'next/server';
import { partsFinance } from '@/lib/parts/finance';
import { partsContext, partsError } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/** Financial view for the admin: ?mode=month&month=YYYY-MM or ?mode=year&year=YYYY, optionally &technicianIds=a,b. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const params = request.nextUrl.searchParams;
    const report = await partsFinance(context.organizationId, {
      mode: params.get('mode'),
      month: params.get('month'),
      year: params.get('year'),
      technicianIds: params.get('technicianIds'),
    });
    return NextResponse.json({ report });
  } catch (error) {
    return partsError(error, 'finance');
  }
}
