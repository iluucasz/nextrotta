import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { getOrganizationSystemStatus } from '@/lib/system-status';

export const runtime = 'nodejs';

/** Whether the VPS modules (Porto worker, WhatsApp) answer — feeds the admin's maintenance notice. */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getOrganizationSystemStatus(auth.organizationId));
  } catch (error) {
    console.error('[system-status] error:', error);
    return NextResponse.json({ error: 'Não foi possível verificar os módulos.' }, { status: 500 });
  }
}
