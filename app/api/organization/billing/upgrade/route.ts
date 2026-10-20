import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { listUpgradeOptions, upgradeSubscription } from '@/lib/billing/upgrade';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failure = (error: unknown) => {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[organization/billing/upgrade] error:', error);
  return NextResponse.json({ error: 'Não foi possível concluir agora. Tente de novo ou fale com o suporte.' }, { status: 500 });
};

/** Plans the admin can move up to, with what each one adds and when the new value starts. */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores.' }, { status: 403 });
  try {
    return NextResponse.json(await listUpgradeOptions(auth.organizationId));
  } catch (error) {
    return failure(error);
  }
}

/** { plan } — upgrades now: features unlock immediately, the new value is charged from next month on. */
export async function POST(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  try {
    const result = await upgradeSubscription(auth.organizationId, body?.plan, {
      userId: auth.userId,
      impersonating: Boolean(auth.impersonationId),
    });
    return NextResponse.json(result);
  } catch (error) {
    return failure(error);
  }
}
