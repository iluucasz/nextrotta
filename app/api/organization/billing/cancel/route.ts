import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { cancelSubscriptionByCustomer } from '@/lib/billing/billing';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

/**
 * The company's admin cancels the subscription. Needs the exact confirmation word so a stray click can't
 * do it. Nothing more is charged afterwards (see cancelSubscriptionByCustomer).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Apenas administradores podem cancelar a assinatura.' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (body?.confirm !== 'CANCELAR') {
      return NextResponse.json({ error: 'Digite CANCELAR para confirmar.' }, { status: 400 });
    }
    const result = await cancelSubscriptionByCustomer(auth.organizationId, auth.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/billing/cancel] error:', error);
    return NextResponse.json({ error: 'Não foi possível cancelar agora. Tente de novo ou fale com o suporte.' }, { status: 500 });
  }
}
