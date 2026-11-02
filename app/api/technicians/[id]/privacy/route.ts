import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { PlatformError } from '@/lib/platform/errors';
import { anonymizeTechnician, exportTechnicianData } from '@/lib/privacy/technician-data';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[technicians/privacy] error:', error);
  return NextResponse.json({ error: 'Não foi possível concluir.' }, { status: 500 });
}

/** A copy of the personal data kept about the technician (LGPD, access and portability). Admin only. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const { id } = await context.params;
    const data = await exportTechnicianData(auth.organizationId, id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="dados-do-tecnico-${id}.json"` },
    });
  } catch (error) {
    return failure(error);
  }
}

/** Anonymizes the technician (name, contact, QRA and login); the retained history stays, tied to an anonymous record. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin' || auth.preview) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const { id } = await context.params;
    await anonymizeTechnician(auth.organizationId, id, { id: auth.userId, role: auth.impersonationId ? 'platform_owner' : 'admin' });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
