import { NextResponse } from 'next/server';
import { PLAN_FEATURES, type PlanFeature } from '../plans';
import { organizationHasFeature } from './entitlements';

/**
 * For API routes of plan-gated features: a 403 response when the organization's plan doesn't
 * include `feature`, otherwise null.
 */
export async function blockUnlessFeature(organizationId: string, feature: PlanFeature) {
  if (await organizationHasFeature(organizationId, feature)) return null;

  return NextResponse.json(
    { error: `${PLAN_FEATURES[feature]} não está incluído no plano da sua empresa.`, feature },
    { status: 403 },
  );
}
