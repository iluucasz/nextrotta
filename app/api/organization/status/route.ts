import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { enabledFeatures, getEntitlements } from '@/lib/billing/entitlements';
import { getMaintenanceNotice } from '@/lib/platform/settings';
import { getAccessById } from '@/lib/organization-access';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

/**
 * What the organization's own screens need to adapt: whether it's read-only or past due (banner),
 * which plan features are on (menu; `features: null` means no plan yet — nothing restricted) and the
 * platform's maintenance notice, if any.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const [rows, entitlements, maintenance, access] = await Promise.all([
      sql`SELECT status FROM organizations WHERE id = ${auth.organizationId}`,
      getEntitlements(auth.organizationId),
      getMaintenanceNotice(),
      getAccessById(auth.organizationId),
    ]);
    const status = String(rows[0]?.status ?? 'active');

    return NextResponse.json({
      status,
      readOnly: status === 'suspended' || status === 'canceled',
      pastDue: status === 'past_due',
      plan: entitlements.planKey ? { key: entitlements.planKey, name: entitlements.planName } : null,
      features: enabledFeatures(entitlements),
      maintenance,
      readOnlyUntil: access?.readOnlyUntil ?? null,
      // Subscribed on the site, setup fee paid, team still preparing: look around, no changes yet.
      preparing: access?.onboarding === 'setup',
    });
  } catch (error) {
    console.error('[organization/status] error:', error);
    return NextResponse.json({ error: 'Erro ao carregar o estado da empresa.' }, { status: 500 });
  }
}
