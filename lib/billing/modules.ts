import { recordAudit } from '../audit';
import { sql } from '../db';
import { grantBonusCredits, grantCurrentMonthCredits } from '../platform/ai-credits';
import { createBugReport } from '../platform/bugs';
import { PlatformError } from '../platform/errors';
import { getBuilderPlan, listModuleOffers } from '../platform/modules';
import { getSubscription } from '../platform/plans';
import { annualFactor, type SubscriptionModule } from '../plans';
import { newValueStartsOn } from './upgrade';
import { applyNewValueFromNextMonth, createModuleSetupCharge, nextMonthDueDate } from './billing';

/**
 * "Adicionar módulo" for a company on "Monte o seu" (the plan "montagem"): the admin adds one of the modules on sale
 * without calling anyone. The module unlocks at once (entitlements read the subscription on every request); its monthly
 * price joins the subscription from the next charge on; the module's own setup fee is one charge now. A company on a
 * package (Essencial, Pro) moves to another package instead (upgrade).
 */

const round2 = (value: number) => Math.round(value * 100) / 100;

export type AddableModule = { key: string; name: string; description: string | null; price: number; setupFee: number };

async function loadBuilderSubscription(organizationId: string) {
  const subscription = await getSubscription(organizationId);
  if (!subscription || subscription.canceledAt) {
    throw new PlatformError('Sua empresa ainda não tem um plano ativo. Fale com o suporte do NextRotta.', 409);
  }
  const builder = await getBuilderPlan();
  if (!builder || builder.id !== subscription.plan.id) return { subscription, builder: null };
  return { subscription, builder };
}

/** Lifetime and test companies don't pay: the owner changes their modules in the panel. */
async function isUnbilled(organizationId: string) {
  const [row] = await sql`SELECT unbilled, onboarding_status FROM organizations WHERE id = ${organizationId}`;
  return { unbilled: Boolean(row?.unbilled), awaitingPayment: row?.onboarding_status === 'awaiting_payment' };
}

/** What the admin can add (empty and unavailable when the plan is a package, the company doesn't pay, or the first payment is pending). */
export async function listAddableModules(organizationId: string) {
  const { subscription, builder } = await loadBuilderSubscription(organizationId);
  const state = await isUnbilled(organizationId);
  if (!builder || state.unbilled || state.awaitingPayment) return { available: false, cycle: subscription.cycle, modules: [] as AddableModule[], current: [] as string[], effectiveFrom: null as string | null };

  const offers = await listModuleOffers(builder);
  const factor = subscription.cycle === 'annual' ? annualFactor(builder) : 1;
  const have = new Set(subscription.modules.map((module) => module.key));
  return {
    available: true,
    cycle: subscription.cycle,
    current: [...have],
    effectiveFrom: await newValueStartsOn(organizationId, subscription.nextDueDate),
    modules: offers
      .filter((offer) => !have.has(offer.key))
      .map((offer): AddableModule => ({ key: offer.key, name: offer.name, description: offer.description, price: round2(offer.monthlyPrice * factor), setupFee: round2(offer.setupFee) })),
  };
}

export async function addModule(organizationId: string, moduleKey: unknown, actor: { userId: string; impersonating: boolean }) {
  const { subscription, builder } = await loadBuilderSubscription(organizationId);
  const state = await isUnbilled(organizationId);
  if (state.unbilled) throw new PlatformError('Os módulos da sua empresa são ajustados pelo suporte do NextRotta.', 409);
  if (state.awaitingPayment) throw new PlatformError('Conclua o pagamento da implantação antes de adicionar módulos.', 409);
  if (!builder) throw new PlatformError('Seu plano é um pacote pronto. Para ganhar mais recursos, mude de plano.', 409);

  const offers = await listModuleOffers(builder);
  const offer = offers.find((candidate) => candidate.key === moduleKey);
  if (!offer) throw new PlatformError('Esse módulo não está à venda.', 404);
  if (subscription.modules.some((module) => module.key === offer.key)) throw new PlatformError('Sua empresa já tem esse módulo.', 409);

  const price = round2(offer.monthlyPrice * (subscription.cycle === 'annual' ? annualFactor(builder) : 1));
  const setupFee = round2(offer.setupFee);
  const chosen: SubscriptionModule = { key: offer.key, price, setupFee };

  // Guarded by the module list it was read from: two admins adding the same module at once add it once.
  const updated = await sql`
    UPDATE subscriptions
    SET modules = modules || ${JSON.stringify([chosen])}::jsonb, base_price = base_price + ${price}, updated_at = NOW()
    WHERE organization_id = ${organizationId} AND NOT (modules @> ${JSON.stringify([{ key: offer.key }])}::jsonb)
    RETURNING organization_id
  `;
  if (!updated.length) throw new PlatformError('Sua empresa já tem esse módulo.', 409);

  if (offer.key === 'ai') {
    await grantBonusCredits(organizationId, builder.aiBonusCredits);
    await grantCurrentMonthCredits(organizationId, builder.aiMonthlyCredits);
  }

  let gatewayWarning: string | null = null;
  let effectiveFrom: string | null = null;
  try {
    effectiveFrom = await applyNewValueFromNextMonth(organizationId);
  } catch (error) {
    gatewayWarning = error instanceof Error ? error.message : 'erro desconhecido';
    console.error('[modules] gateway update failed:', organizationId, error);
  }
  effectiveFrom ??= nextMonthDueDate(1);

  let invoiceUrl: string | null = null;
  if (setupFee > 0) {
    try {
      invoiceUrl = (await createModuleSetupCharge(organizationId, offer.key, offer.name, setupFee)).invoiceUrl;
    } catch (error) {
      gatewayWarning ??= error instanceof Error ? error.message : 'erro desconhecido';
      console.error('[modules] setup charge failed:', organizationId, error);
    }
  }

  const ticket = await createBugReport(
    { organizationId, userId: actor.userId },
    {
      type: 'support',
      category: 'settings',
      title: `Módulo adicionado: ${offer.name}`,
      description: [
        `A empresa adicionou o módulo ${offer.name} pelo sistema.`,
        '',
        `Mensalidade do módulo: R$ ${price.toFixed(2).replace('.', ',')} (${subscription.cycle === 'annual' ? 'por ano' : 'por mês'}), a partir da cobrança de ${effectiveFrom}.`,
        `Implantação do módulo: R$ ${setupFee.toFixed(2).replace('.', ',')}${setupFee > 0 ? ' (cobrança avulsa gerada agora)' : ''}.`,
        'O módulo já está liberado: combine com o cliente a configuração.',
        ...(gatewayWarning ? ['', `Atenção: o Asaas não aceitou parte da alteração (${gatewayWarning}). Confira a assinatura e as cobranças no painel.`] : []),
      ].join('\n'),
    },
  );

  await recordAudit({
    organizationId,
    actorId: actor.userId,
    actorRole: actor.impersonating ? 'platform_owner' : 'admin',
    action: 'subscription.module_added',
    targetType: 'subscription',
    targetId: organizationId,
    details: { module: offer.key, price, setupFee, effectiveFrom, gatewayWarning },
  });

  return { module: { key: offer.key, name: offer.name }, price, setupFee, cycle: subscription.cycle, effectiveFrom, invoiceUrl, ticket };
}
