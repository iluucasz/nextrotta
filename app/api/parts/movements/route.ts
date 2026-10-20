import { NextRequest, NextResponse } from 'next/server';
import { partsContext, partsError } from '@/lib/parts/route-helpers';
import { listMovements } from '@/lib/parts/stock';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const params = request.nextUrl.searchParams;
    const movements = await listMovements(context.organizationId, {
      partId: params.get('partId'),
      technicianId: params.get('technicianId'),
      central: params.get('central') === '1',
    });
    return NextResponse.json({ movements });
  } catch (error) {
    return partsError(error, 'movements');
  }
}
