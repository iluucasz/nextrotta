import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { setSimulatedPayment } from '@/lib/billing/simulation';
import { isUuid, PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

/** Test companies only: marks a simulated instalment as paid, or undoes it. Nothing reaches the payment gateway. */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Apenas administradores podem usar o pagamento simulado.' }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (!isUuid(String(body?.chargeId ?? '')) || typeof body?.paid !== 'boolean') {
      return NextResponse.json({ error: 'Informe a cobrança e se foi paga.' }, { status: 400 });
    }
    await setSimulatedPayment(auth.organizationId, String(body.chargeId), body.paid, auth.userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/billing/simulate] error:', error);
    return NextResponse.json({ error: 'Não foi possível registrar o pagamento simulado.' }, { status: 500 });
  }
}
