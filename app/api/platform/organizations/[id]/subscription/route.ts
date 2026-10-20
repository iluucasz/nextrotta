import { NextRequest, NextResponse } from 'next/server';
import { syncSubscriptionValue } from '@/lib/billing/billing';
import { getOrganizationDetail } from '@/lib/platform/organizations';
import { getSubscription, parseSubscriptionInput, setSubscription } from '@/lib/platform/plans';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** The organization's subscription with the current value (base + extra technicians − discounts). */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    await getOrganizationDetail(id); // 404 for an unknown organization
    return NextResponse.json({ subscription: await getSubscription(id) });
  });
}

/**
 * { planId, cycle: "monthly"|"annual", discountPercent?, discountAmount?, setupFee?, chargeSetupFee?,
 *   graceDays?, limitOverrides?: { maxUsers?, storageMb?, whatsappMessagesMonth?, portoRunsMonth? } }
 */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    await getOrganizationDetail(id);
    await setSubscription(id, parseSubscriptionInput(await readJson(request)), { id: owner.userId });

    // Saved here either way; if the gateway refuses the new value, the owner sees why and can
    // retry with { action: "sync" } on /billing.
    const syncWarning = await syncSubscriptionValue(id)
      .then(() => null)
      .catch((error: unknown) => (error instanceof Error ? error.message : 'Falha ao atualizar a assinatura no Asaas.'));

    return NextResponse.json({ subscription: await getSubscription(id), syncWarning });
  });
}
