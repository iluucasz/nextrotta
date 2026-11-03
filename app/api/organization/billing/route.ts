import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { listCharges } from '@/lib/billing/billing';
import { sql } from '@/lib/db';
import { getSubscription } from '@/lib/platform/plans';

export const runtime = 'nodejs';

/**
 * The admin's own view of the subscription: plan, value, setup fee and charges with their payment
 * links. Read-only, so it stays available while the organization is suspended (to pay).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Apenas administradores podem ver a assinatura.' }, { status: 403 });
    }

    const [subscription, charges, [organization]] = await Promise.all([
      getSubscription(auth.organizationId),
      listCharges(auth.organizationId),
      sql`SELECT lifetime FROM organizations WHERE id = ${auth.organizationId}`,
    ]);
    // Lifetime: the company uses the platform without paying, so there is no value or charge to show.
    const lifetime = Boolean(organization?.lifetime);
    if (!subscription) return NextResponse.json({ subscription: null, charges: [], lifetime });

    // Gateway identifiers stay internal.
    const { asaas: _asaas, limitOverrides: _limits, ...visible } = subscription;
    return NextResponse.json({ subscription: visible, charges: lifetime ? [] : charges, lifetime });
  } catch (error) {
    console.error('[organization/billing] error:', error);
    return NextResponse.json({ error: 'Erro ao carregar a assinatura.' }, { status: 500 });
  }
}
