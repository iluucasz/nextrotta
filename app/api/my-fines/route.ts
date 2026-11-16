import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { listMyFines, technicianHasFleet } from '@/lib/vehicles/fines-store';

export const runtime = 'nodejs';

/** A technician's own fines (only the ones he was told about). `?has=1` only says whether the menu entry should show. */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'technician' || !auth.technicianId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  if (new URL(request.url).searchParams.get('has') === '1') {
    return NextResponse.json({ has: await technicianHasFleet(auth.organizationId, auth.technicianId) });
  }
  return NextResponse.json({ fines: await listMyFines(auth.organizationId, auth.technicianId) });
}
