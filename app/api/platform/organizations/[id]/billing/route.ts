import { NextRequest, NextResponse } from 'next/server';
import { activateBilling, listCharges, refreshCharges, syncSubscriptionValue } from '@/lib/billing/billing';
import { getOrganizationDetail, PlatformError } from '@/lib/platform/organizations';
import { getSubscription } from '@/lib/platform/plans';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Subscription plus every charge mirrored from the gateway. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    await getOrganizationDetail(id);
    const [subscription, charges] = await Promise.all([getSubscription(id), listCharges(id)]);
    return NextResponse.json({ subscription, charges });
  });
}

/**
 * { action: "activate", firstDueDate?: "YYYY-MM-DD" } — starts charging (customer, setup fee,
 *   recurring subscription). Defaults to 7 days from today.
 * { action: "sync" } — pushes the current value to the gateway and pulls the charges back.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    await getOrganizationDetail(id);
    const body = await readJson(request);

    if (body.action === 'activate') {
      await activateBilling(id, { firstDueDate: typeof body.firstDueDate === 'string' ? body.firstDueDate : null }, {
        id: owner.userId,
      });
    } else if (body.action === 'sync') {
      await syncSubscriptionValue(id);
      await refreshCharges(id);
    } else {
      throw new PlatformError('Ação inválida.');
    }

    const [subscription, charges] = await Promise.all([getSubscription(id), listCharges(id)]);
    return NextResponse.json({ subscription, charges });
  });
}
