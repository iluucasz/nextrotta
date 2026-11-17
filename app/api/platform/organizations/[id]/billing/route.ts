import { NextRequest, NextResponse } from 'next/server';
import { activateBilling, createPaymentLink, listCharges, refreshCharges, syncSubscriptionValue } from '@/lib/billing/billing';
import { createSimulatedCharge, ensureSimulatedSchedule, isTestOrganization, setSimulatedPayment } from '@/lib/billing/simulation';
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
    await ensureSimulatedSchedule(id);
    const [subscription, charges] = await Promise.all([getSubscription(id), listCharges(id)]);
    return NextResponse.json({ subscription, charges });
  });
}

/**
 * { action: "activate", firstDueDate?: "YYYY-MM-DD" } — starts charging (customer, setup fee,
 *   recurring subscription). Defaults to 7 days from today.
 * { action: "sync" } — pushes the current value to the gateway and pulls the charges back.
 * { action: "link", kind: "setup" | "one_off", value?, dueDate?, description? } — makes a payment link (answers `link`).
 * { action: "simulate", chargeId, paid } — test companies only: marks a simulated instalment as paid or undoes it.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    await getOrganizationDetail(id);
    const body = await readJson(request);
    let link: { invoiceUrl: string | null; value: number; dueDate: string; simulated?: boolean } | null = null;

    if (body.action === 'activate') {
      await activateBilling(id, { firstDueDate: typeof body.firstDueDate === 'string' ? body.firstDueDate : null }, {
        id: owner.userId,
      });
    } else if (body.action === 'sync') {
      await syncSubscriptionValue(id);
      await refreshCharges(id);
    } else if (body.action === 'link') {
      if (body.kind !== 'setup' && body.kind !== 'one_off') throw new PlatformError('Escolha o tipo da cobrança.');
      const input = {
        kind: body.kind as 'setup' | 'one_off',
        value: body.value == null || body.value === '' ? null : Number(body.value),
        dueDate: typeof body.dueDate === 'string' && body.dueDate ? body.dueDate : null,
        description: typeof body.description === 'string' ? body.description : null,
      };
      // A test company gets a simulated charge (no link, nothing at the gateway) unless the owner asks for the gateway's sandbox
      // (`gateway: true`); a real one always gets a gateway link.
      link = (await isTestOrganization(id)) && body.gateway !== true
        ? await createSimulatedCharge(id, input, owner.userId)
        : await createPaymentLink(id, input, { id: owner.userId }, { allowTest: body.gateway === true });
    } else if (body.action === 'simulate') {
      if (typeof body.chargeId !== 'string' || typeof body.paid !== 'boolean') throw new PlatformError('Informe a cobrança e se foi paga.');
      await setSimulatedPayment(id, body.chargeId, body.paid, owner.userId);
    } else {
      throw new PlatformError('Ação inválida.');
    }

    const [subscription, charges] = await Promise.all([getSubscription(id), listCharges(id)]);
    return NextResponse.json({ subscription, charges, link });
  });
}
