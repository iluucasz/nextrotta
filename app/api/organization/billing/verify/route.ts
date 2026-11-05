import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { refreshCharges } from '@/lib/billing/billing';
import { getAccessById } from '@/lib/organization-access';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** One check at a time per company, and not more often than every few seconds (the gateway is asked on each one). */
const MIN_GAP_MS = 8_000;
const lastCheck = new Map<string, number>();

/**
 * "Já paguei": asks the payment gateway about the company's charges right now, so a payment is noticed without waiting for the
 * gateway's notification, and releases the access on the spot when nothing is left overdue. Works while the access is locked
 * (the only write besides tickets) and only for the administrator.
 */
export async function POST(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem verificar o pagamento.' }, { status: 403 });

  const now = Date.now();
  const previous = lastCheck.get(auth.organizationId) ?? 0;
  if (now - previous < MIN_GAP_MS) {
    const access = await getAccessById(auth.organizationId);
    return NextResponse.json({ released: access?.level === 'full', checked: false });
  }
  lastCheck.set(auth.organizationId, now);

  try {
    await refreshCharges(auth.organizationId);
  } catch (error) {
    console.error('[organization/billing/verify] error:', error);
    return NextResponse.json({ error: 'Não foi possível consultar o pagamento agora. Tente de novo em instantes.' }, { status: 502 });
  }
  const access = await getAccessById(auth.organizationId);
  return NextResponse.json({ released: access?.level === 'full', checked: true });
}
