import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { listCompanyFiles } from '@/lib/organization-files';

export const runtime = 'nodejs';

/** The documents and photos the company keeps in the system (the administrator; open even while the access is locked). */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  return NextResponse.json(await listCompanyFiles(auth.organizationId), { headers: { 'Cache-Control': 'private, no-store' } });
}
