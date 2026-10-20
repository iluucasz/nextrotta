import { recordAudit } from '../audit';
import { sql } from '../db';
import { grantBonusCredits, grantCurrentMonthCredits } from '../platform/ai-credits';
import { createBugReport } from '../platform/bugs';
import { PlatformError } from '../platform/errors';
import { getSubscription } from '../platform/plans';
import { calculateSubscriptionValue, effectiveLimits, planFromRow, type Plan, type PlanLimits } from '../plans';
import { FEATURE_DESCRIPTIONS } from '../site/content';
import { applyNewValueFromNextMonth, nextMonthDueDate } from './billing';

/**
 * Self-service upgrade from the admin's subscription page. Features unlock immediately (entitlements
 * read the plan on every request); the new value is only charged from next month on; a support
 * ticket tells the team to set the new features up with the customer.
 */

type Improvement = { label: string; from: string; to: string };
type NewFeature = { key: string; name: string; description: string };

const integer = (value: number) => new Intl.NumberFormat('pt-BR').format(value);
const amount = (value: number | null) => (value === null ? 'Ilimitado' : integer(value));
const storage = (mb: number | null) =>
  mb === null ? 'Ilimitado' : mb >= 1024 ? `${integer(Math.round((mb / 1024) * 10) / 10)} GB` : `${integer(mb)} MB`;
const retention = (days: number | null) =>
  days === null ? 'Ilimitado' : days % 30 === 0 ? `${days / 30} ${days === 30 ? 'mês' : 'meses'}` : `${days} dias`;
/** null = unlimited, so it beats any number. */
const better = (to: number | null, from: number | null) => (to === null ? from !== null : from !== null && to > from);

function improvements(current: Plan, next: Plan, overrides: Partial<PlanLimits>): Improvement[] {
  const before = effectiveLimits(current.limits, overrides);
  const after = effectiveLimits(next.limits, overrides);
  const has = (plan: Plan, feature: string) => plan.features.includes(feature);
  const rows: Improvement[] = [];

  if (next.includedTechnicians > current.includedTechnicians) {
    rows.push({ label: 'Técnicos incluídos', from: integer(current.includedTechnicians), to: integer(next.includedTechnicians) });
  }
  if (better(after.maxUsers, before.maxUsers)) rows.push({ label: 'Usuários', from: amount(before.maxUsers), to: amount(after.maxUsers) });
  if (better(after.storageMb, before.storageMb)) rows.push({ label: 'Armazenamento', from: storage(before.storageMb), to: storage(after.storageMb) });
  if (has(next, 'whatsapp') && (!has(current, 'whatsapp') || better(after.whatsappMessagesMonth, before.whatsappMessagesMonth))) {
    rows.push({
      label: 'Mensagens de WhatsApp por mês',
      from: has(current, 'whatsapp') ? amount(before.whatsappMessagesMonth) : '—',
      to: amount(after.whatsappMessagesMonth),
    });
  }
  if (has(next, 'porto') && (!has(current, 'porto') || better(after.portoRunsMonth, before.portoRunsMonth))) {
    rows.push({
      label: 'Execuções do Porto por mês',
      from: has(current, 'porto') ? amount(before.portoRunsMonth) : '—',
      to: amount(after.portoRunsMonth),
    });
  }
  if (better(next.backupRetentionDays, current.backupRetentionDays)) {
    rows.push({ label: 'Backups diários guardados por', from: retention(current.backupRetentionDays), to: retention(next.backupRetentionDays) });
  }
  const credits = (plan: Plan) => (has(plan, 'ai') ? plan.aiMonthlyCredits : 0);
  if (credits(next) > credits(current)) {
    rows.push({ label: 'Créditos de IA por mês', from: credits(current) ? integer(credits(current)) : '—', to: integer(credits(next)) });
  }
  return rows;
}

async function loadUpgradeContext(organizationId: string) {
  const subscription = await getSubscription(organizationId);
  if (!subscription || subscription.canceledAt) {
    throw new PlatformError('Sua empresa ainda não tem um plano ativo. Fale com o suporte do NextRotta.', 409);
  }
  const [planRows, catalog, organization] = await Promise.all([
    sql`SELECT * FROM plans WHERE archived_at IS NULL ORDER BY display_order, name`,
    sql`SELECT key, name, description FROM features WHERE scope = 'general' AND archived_at IS NULL`,
    sql`SELECT onboarding_status FROM organizations WHERE id = ${organizationId}`,
  ]);
  const plans = planRows.map(planFromRow);
  const current = plans.find((plan) => plan.id === subscription.plan.id) ?? planFromRow((await sql`SELECT * FROM plans WHERE id = ${subscription.plan.id}`)[0]);
  const featureInfo = new Map(catalog.map((row) => [String(row.key), row]));
  const price = (plan: Plan) => (subscription.cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice);

  const options = plans
    .filter((plan) => plan.visible && !plan.onRequest && plan.id !== current.id && price(plan) > price(current))
    .map((plan) => {
      const newFeatures: NewFeature[] = plan.features
        .filter((key) => !current.features.includes(key) && featureInfo.has(key))
        .map((key) => {
          const info = featureInfo.get(key)!;
          return {
            key,
            name: String(info.name),
            description: (info.description as string | null) ?? FEATURE_DESCRIPTIONS[key as keyof typeof FEATURE_DESCRIPTIONS] ?? '',
          };
        });
      const value = calculateSubscriptionValue(
        {
          cycle: subscription.cycle,
          basePrice: price(plan),
          extraTechnicianPrice: plan.extraTechnicianPrice,
          includedTechnicians: plan.includedTechnicians,
          discountPercent: subscription.discountPercent,
          discountAmount: subscription.discountAmount,
        },
        subscription.activeTechnicians,
      ).value;
      return {
        plan,
        summary: {
          key: plan.key,
          name: plan.name,
          description: plan.description,
          basePrice: price(plan),
          value,
          newFeatures,
          improvements: improvements(current, plan, subscription.limitOverrides ?? {}),
        },
      };
    });

  return { subscription, current, options, onboarding: (organization[0]?.onboarding_status as string | null) ?? null };
}

/** When the new value first applies: the first charge due next month or later. */
async function firstChargeFromNextMonth(organizationId: string, billingDay: number | null, nextDueDate: string | null) {
  const nextMonthStart = `${nextMonthDueDate(1).slice(0, 7)}-01`;
  const [pending] = await sql`
    SELECT due_date::text AS due FROM billing_charges
    WHERE organization_id = ${organizationId} AND kind = 'subscription' AND status = 'PENDING' AND due_date >= ${nextMonthStart}
    ORDER BY due_date LIMIT 1
  `;
  if (pending) return String(pending.due);
  if (nextDueDate && nextDueDate >= nextMonthStart) return nextDueDate;
  const day = billingDay ?? (nextDueDate ? Number(nextDueDate.slice(8, 10)) : null);
  return day ? nextMonthDueDate(day) : null;
}

const dateKey = (value: unknown) => (value ? new Date(value as string).toISOString().slice(0, 10) : null);

export async function listUpgradeOptions(organizationId: string) {
  const { subscription, current, options, onboarding } = await loadUpgradeContext(organizationId);
  const [row] = await sql`SELECT billing_day FROM subscriptions WHERE organization_id = ${organizationId}`;
  return {
    current: { key: current.key, name: current.name, cycle: subscription.cycle, value: subscription.value },
    options: options.map((option) => option.summary),
    // Awaiting the setup payment, the subscription isn't running yet: no upgrades until then.
    available: onboarding !== 'awaiting_payment',
    effectiveFrom: await firstChargeFromNextMonth(organizationId, row?.billing_day ?? null, dateKey(subscription.nextDueDate)),
  };
}

export async function upgradeSubscription(organizationId: string, planKey: unknown, actor: { userId: string; impersonating: boolean }) {
  const { subscription, current, options, onboarding } = await loadUpgradeContext(organizationId);
  if (onboarding === 'awaiting_payment') throw new PlatformError('Conclua o pagamento da implantação antes de mudar de plano.', 409);
  const option = options.find((candidate) => candidate.plan.key === planKey);
  if (!option) throw new PlatformError('Esse plano não está disponível como upgrade do seu plano atual.');
  const plan = option.plan;

  // Prices copied from the plan now; cycle, discounts, setup fee and limit overrides stay.
  await sql`
    UPDATE subscriptions
    SET plan_id = ${plan.id}, base_price = ${option.summary.basePrice}, extra_technician_price = ${plan.extraTechnicianPrice},
        included_technicians = ${plan.includedTechnicians}, updated_at = NOW()
    WHERE organization_id = ${organizationId}
  `;
  if (plan.features.includes('ai')) {
    await grantBonusCredits(organizationId, plan.aiBonusCredits);
    await grantCurrentMonthCredits(organizationId, plan.aiMonthlyCredits);
  }

  let gatewayWarning: string | null = null;
  let effectiveFrom: string | null = null;
  try {
    effectiveFrom = await applyNewValueFromNextMonth(organizationId);
  } catch (error) {
    gatewayWarning = error instanceof Error ? error.message : 'erro desconhecido';
    console.error('[upgrade] gateway update failed:', organizationId, error);
  }
  const [row] = await sql`SELECT billing_day, next_due_date FROM subscriptions WHERE organization_id = ${organizationId}`;
  effectiveFrom ??= await firstChargeFromNextMonth(organizationId, row?.billing_day ?? null, dateKey(row?.next_due_date));

  // The team's to-do (and the customer's channel): set the new features up together.
  const lines = [
    `A empresa fez upgrade do plano ${current.name} para o ${plan.name} pelo sistema.`,
    '',
    'Recursos novos para configurar com o cliente:',
    ...(option.summary.newFeatures.length ? option.summary.newFeatures.map((feature) => `- ${feature.name}`) : ['- (sem recursos novos; só limites maiores)']),
    ...(option.summary.improvements.length
      ? ['', 'Limites:', ...option.summary.improvements.map((item) => `- ${item.label}: ${item.from} → ${item.to}`)]
      : []),
    '',
    `Novo valor: R$ ${option.summary.value.toFixed(2).replace('.', ',')} a partir da cobrança de ${effectiveFrom ?? 'próximo mês'}.`,
    ...(gatewayWarning ? ['', `Atenção: o Asaas não aceitou o novo valor (${gatewayWarning}). Ajuste a assinatura no painel.`] : []),
  ];
  const ticket = await createBugReport(
    { organizationId, userId: actor.userId },
    { type: 'support', category: 'settings', title: `Upgrade para o plano ${plan.name}: configurar as novidades`, description: lines.join('\n') },
  );

  await recordAudit({
    organizationId,
    actorId: actor.userId,
    actorRole: actor.impersonating ? 'platform_owner' : 'admin',
    action: 'subscription.upgraded',
    targetType: 'subscription',
    targetId: organizationId,
    details: {
      from: { plan: current.key, value: subscription.value },
      to: { plan: plan.key, value: option.summary.value },
      effectiveFrom,
      gatewayWarning,
    },
  });

  return {
    previousPlan: current.name,
    plan: { key: plan.key, name: plan.name },
    cycle: subscription.cycle,
    value: option.summary.value,
    effectiveFrom,
    newFeatures: option.summary.newFeatures,
    improvements: option.summary.improvements,
    ticket,
  };
}
