import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { addModule, listAddableModules } from '@/lib/billing/modules';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failure = (error: unknown) => {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[organization/billing/modules] error:', error);
  return NextResponse.json({ error: 'Não foi possível concluir agora. Tente de novo ou fale com o suporte.' }, { status: 500 });
};

/** The modules the admin can still add to "Monte o seu", at the price of the subscription's cycle. */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores.' }, { status: 403 });
  try {
    return NextResponse.json(await listAddableModules(auth.organizationId));
  } catch (error) {
    return failure(error);
  }
}

/** { module } — adds it now: it unlocks at once, the monthly price starts next month, the module's setup fee is charged now. */
export async function POST(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json(await addModule(auth.organizationId, body?.module, { userId: auth.userId, impersonating: Boolean(auth.impersonationId) }));
  } catch (error) {
    return failure(error);
  }
}
