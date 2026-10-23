import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError } from '@/lib/parts/route-helpers';
import { listMovements } from '@/lib/parts/stock';

export const runtime = 'nodejs';

/**
 * Stock movements, newest first. Filters: partId, technicianId, central=1, from/to (YYYY-MM-DD), group
 * (purchase|transfer|sale|adjustment|inventory), search (part name or note), limit/offset. Besides the
 * page it returns the total and the unit totals of everything the filters match.
 */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const params = request.nextUrl.searchParams;
    const result = await listMovements(context.organizationId, {
      partId: params.get('partId'),
      technicianId: params.get('technicianId'),
      central: params.get('central') === '1',
      from: params.get('from'),
      to: params.get('to'),
      group: params.get('group'),
      search: params.get('search'),
      limit: params.get('limit'),
      offset: params.get('offset'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return partsError(error, 'movements');
  }
}
