import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { exportOrganizationData } from '@/lib/platform/data';

export const runtime = 'nodejs';

/** The admin downloads every record of the organization as JSON — allowed even when suspended. */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const data = await exportOrganizationData(auth.organizationId, {
      id: auth.userId,
      role: auth.impersonationId ? 'platform_owner' : 'admin',
      impersonationId: auth.impersonationId ?? null,
    });
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="nextrotta-${auth.organizationSlug}-${data.exportedAt.slice(0, 10)}.json"`,
      },
    });
  } catch (error) {
    console.error('[organization/export] error:', error);
    return NextResponse.json({ error: 'Não foi possível exportar os dados.' }, { status: 500 });
  }
}
