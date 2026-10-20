import { recordAudit } from '../audit';
import { syncSubscriptionValueQuietly } from '../billing/billing';
import { sql } from '../db';
import {
  calculateSubscriptionValue,
  CORE_FEATURES,
  effectiveLimits,
  LIMIT_KEYS,
  planFromRow,
  type BillingCycle,
  type Plan,
  type PlanLimits,
} from '../plans';
import { isUuid, PlatformError, type Actor } from './errors';
import { grantBonusCredits } from './ai-credits';
import { listGeneralFeatureKeys } from './features';
import { assertStorageFits, autoAssignQuietly, getStorageRoom } from './storage-containers';
import { getPlatformSettings } from './settings';

const PLAN_KEY_PATTERN = /^[a-z0-9_]{2,40}$/;

function money(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new PlatformError(`${label}: informe um valor maior ou igual a zero.`);
  return Math.round(parsed * 100) / 100;
}

function wholeNumber(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new PlatformError(`${label}: informe um número inteiro maior ou igual a zero.`);
  return parsed;
}

/** null/'' = unlimited. */
function optionalLimit(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null;
  return wholeNumber(value, label);
}

const PLAN_COLUMNS = `
  p.*,
  (SELECT COUNT(*)::int FROM subscriptions s
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.plan_id = p.id AND s.canceled_at IS NULL AND o.deleted_at IS NULL
      AND o.status IN ('active', 'past_due')) AS active_subscriptions
`;

function serializePlan(row: Record<string, unknown>) {
  return { ...planFromRow(row), activeSubscriptions: Number(row.active_subscriptions ?? 0) };
}

export async function listPlans() {
  const rows = await sql.query(`SELECT ${PLAN_COLUMNS} FROM plans p ORDER BY p.archived_at NULLS FIRST, p.display_order, p.name`);
  return rows.map(serializePlan);
}

async function requirePlan(planId: string) {
  if (!isUuid(planId)) throw new PlatformError('Plano não encontrado.', 404);
  const rows = await sql.query(`SELECT ${PLAN_COLUMNS} FROM plans p WHERE p.id = $1`, [planId]);
  if (!rows[0]) throw new PlatformError('Plano não encontrado.', 404);
  return rows[0];
}

/** Validates the plan fields present in `input`; with `partial`, missing fields are left out. */
function parsePlanInput(input: Record<string, unknown>, partial: boolean, generalFeatures: Set<string>) {
  const values: Record<string, unknown> = {};
  const has = (key: string) => key in input;
  const need = (key: string) => {
    if (!partial && !has(key)) throw new PlatformError(`Campo obrigatório: ${key}.`);
    return has(key);
  };

  if (need('name')) {
    const name = String(input.name ?? '').trim();
    if (!name) throw new PlatformError('Informe o nome do plano.');
    values.name = name;
  }
  if (has('description')) values.description = String(input.description ?? '').trim() || null;
  if (need('monthlyPrice')) values.monthly_price = money(input.monthlyPrice, 'Preço mensal');
  if (need('annualPrice')) values.annual_price = money(input.annualPrice, 'Preço anual');
  if (has('extraTechnicianPrice')) values.extra_technician_price = money(input.extraTechnicianPrice, 'Técnico extra');
  if (has('setupFee')) values.setup_fee = money(input.setupFee, 'Implantação');
  if (has('onRequest')) values.on_request = Boolean(input.onRequest);
  if (has('featured')) values.featured = Boolean(input.featured);
  if (has('visible')) values.visible = Boolean(input.visible);
  if (has('displayOrder')) values.display_order = wholeNumber(input.displayOrder, 'Ordem');
  if (has('includedTechnicians')) values.included_technicians = wholeNumber(input.includedTechnicians, 'Técnicos incluídos');
  if (has('aiMonthlyCredits')) values.ai_monthly_credits = wholeNumber(input.aiMonthlyCredits, 'Cota mensal de IA');
  if (has('aiBonusCredits')) values.ai_bonus_credits = wholeNumber(input.aiBonusCredits, 'Bônus de IA');
  if (has('backupRetentionDays')) {
    const days = optionalLimit(input.backupRetentionDays, 'Retenção de backup');
    if (days === 0) throw new PlatformError('Retenção de backup: use pelo menos 1 dia, ou deixe vazio para ilimitado.');
    values.backup_retention_days = days;
  }

  if (has('limits')) {
    const limits = (input.limits ?? {}) as Record<string, unknown>;
    const columns: Record<keyof PlanLimits, string> = {
      maxUsers: 'max_users',
      storageMb: 'storage_mb',
      whatsappMessagesMonth: 'whatsapp_messages_month',
      portoRunsMonth: 'porto_runs_month',
    };
    for (const key of LIMIT_KEYS) {
      if (key in limits) values[columns[key]] = optionalLimit(limits[key], 'Limite');
    }
  }

  if (need('features')) {
    const features = Array.isArray(input.features) ? input.features : [];
    if (!features.every((feature) => typeof feature === 'string' && generalFeatures.has(feature))) {
      throw new PlatformError('Há recursos desconhecidos, arquivados ou sob medida na lista.');
    }
    const missingCore = CORE_FEATURES.filter((feature) => !features.includes(feature));
    if (missingCore.length) throw new PlatformError('Técnicos, OS, horas, escala e folha fazem parte de todos os planos.');
    values.features = Array.from(new Set(features));
  }

  return values;
}

export async function createPlan(input: Record<string, unknown>, actor: Actor) {
  const key = String(input.key ?? '').trim().toLowerCase();
  if (!PLAN_KEY_PATTERN.test(key)) throw new PlatformError('Chave do plano: use letras minúsculas, números e "_".');

  const values = { key, ...parsePlanInput(input, false, await listGeneralFeatureKeys()) };
  const columns = Object.keys(values);

  try {
    const rows = await sql.query(
      `INSERT INTO plans (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`,
      columns.map((column) => (values as Record<string, unknown>)[column]),
    );
    await recordAudit({
      organizationId: null,
      actorId: actor.id,
      actorRole: 'platform_owner',
      action: 'plan.created',
      targetType: 'plan',
      targetId: String(rows[0].id),
      details: values,
    });
    return serializePlan(await requirePlan(String(rows[0].id)));
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PlatformError('Já existe um plano com essa chave.', 409);
    throw error;
  }
}

/**
 * Edits a plan. A price change applies to new subscriptions only, unless `applyPriceChange` is
 * "next_cycle": then every active subscription of the plan adopts the new prices too.
 */
export async function updatePlan(planId: string, input: Record<string, unknown>, actor: Actor) {
  const before = await requirePlan(planId);
  const values = parsePlanInput(input, true, await listGeneralFeatureKeys());
  if ('archived' in input) values.archived_at = input.archived ? new Date().toISOString() : null;
  if (!Object.keys(values).length) throw new PlatformError('Nada para alterar.');

  const columns = Object.keys(values);
  await sql.query(
    `UPDATE plans SET ${columns.map((column, index) => `${column} = $${index + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
    [planId, ...columns.map((column) => values[column])],
  );

  const priceChanged = ['monthly_price', 'annual_price', 'extra_technician_price', 'included_technicians'].some(
    (column) => column in values && Number(values[column]) !== Number(before[column]),
  );
  let affectedSubscriptions = 0;

  if (priceChanged && input.applyPriceChange === 'next_cycle') {
    const updated = await sql`
      UPDATE subscriptions s
      SET base_price = CASE s.cycle WHEN 'annual' THEN p.annual_price ELSE p.monthly_price END,
          extra_technician_price = p.extra_technician_price,
          included_technicians = p.included_technicians,
          updated_at = NOW()
      FROM plans p
      WHERE p.id = s.plan_id AND s.plan_id = ${planId} AND s.canceled_at IS NULL
      RETURNING s.organization_id
    `;
    affectedSubscriptions = updated.length;
    for (const row of updated) await syncSubscriptionValueQuietly(String(row.organization_id));
  }

  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'plan.updated',
    targetType: 'plan',
    targetId: planId,
    details: { changes: values, applyPriceChange: priceChanged ? input.applyPriceChange ?? 'new_only' : null, affectedSubscriptions },
  });

  return { plan: serializePlan(await requirePlan(planId)), affectedSubscriptions };
}

// ---------------------------------------------------------------------------------------------
// An organization's subscription
// ---------------------------------------------------------------------------------------------

export type SubscriptionInput = {
  planId: string;
  cycle: BillingCycle;
  discountPercent?: number;
  discountAmount?: number;
  /** Defaults to the plan's setup fee. */
  setupFee?: number;
  /** false = setup fee waived. */
  chargeSetupFee?: boolean;
  graceDays?: number;
  limitOverrides?: Partial<PlanLimits>;
};

export function parseSubscriptionInput(input: Record<string, unknown>): SubscriptionInput {
  const planId = String(input.planId ?? '');
  if (!isUuid(planId)) throw new PlatformError('Escolha um plano.');
  if (input.cycle !== 'monthly' && input.cycle !== 'annual') throw new PlatformError('Escolha o ciclo: mensal ou anual.');

  const result: SubscriptionInput = { planId, cycle: input.cycle };
  if (input.discountPercent !== undefined) {
    const percent = Number(input.discountPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new PlatformError('Desconto: entre 0% e 100%.');
    result.discountPercent = percent;
  }
  if (input.discountAmount !== undefined) result.discountAmount = money(input.discountAmount, 'Desconto');
  if (input.setupFee !== undefined) result.setupFee = money(input.setupFee, 'Implantação');
  if (input.chargeSetupFee !== undefined) result.chargeSetupFee = Boolean(input.chargeSetupFee);
  if (input.graceDays !== undefined) result.graceDays = wholeNumber(input.graceDays, 'Carência');
  if (input.limitOverrides !== undefined) {
    const raw = (input.limitOverrides ?? {}) as Record<string, unknown>;
    const overrides: Partial<PlanLimits> = {};
    for (const key of LIMIT_KEYS) {
      if (key in raw) overrides[key] = optionalLimit(raw[key], 'Limite');
    }
    result.limitOverrides = overrides;
  }
  return result;
}

export async function getSubscription(organizationId: string) {
  const rows = await sql`
    SELECT s.*, p.name AS plan_name, p.key AS plan_key,
      (SELECT COUNT(*)::int FROM technicians t
        WHERE t.organization_id = s.organization_id AND t.deleted_at IS NULL AND t.status = 'active') AS active_technicians
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    WHERE s.organization_id = ${organizationId}
  `;
  const row = rows[0];
  if (!row) return null;

  const pricing = {
    cycle: row.cycle as BillingCycle,
    basePrice: Number(row.base_price),
    extraTechnicianPrice: Number(row.extra_technician_price),
    includedTechnicians: Number(row.included_technicians),
    discountPercent: Number(row.discount_percent),
    discountAmount: Number(row.discount_amount),
  };

  return {
    plan: { id: String(row.plan_id), key: String(row.plan_key), name: String(row.plan_name) },
    ...pricing,
    activeTechnicians: Number(row.active_technicians),
    ...calculateSubscriptionValue(pricing, Number(row.active_technicians)),
    setupFee: Number(row.setup_fee),
    setupFeeStatus: String(row.setup_fee_status),
    graceDays: Number(row.grace_days),
    limitOverrides: row.limit_overrides as Partial<PlanLimits>,
    nextDueDate: row.next_due_date,
    canceledAt: row.canceled_at,
    asaas: {
      customerId: row.asaas_customer_id,
      subscriptionId: row.asaas_subscription_id,
      setupPaymentId: row.asaas_setup_payment_id,
    },
  };
}

/**
 * Subscribes the organization to a plan, or changes its plan/cycle/discounts. Prices are copied
 * from the plan at this moment. Changing plan or cycle never re-charges the setup fee.
 */
export async function setSubscription(organizationId: string, input: SubscriptionInput, actor: Actor) {
  const plan: Plan = planFromRow(await requirePlan(input.planId));
  if (plan.archived) throw new PlatformError('Esse plano está arquivado.');

  const existing = (await sql`SELECT * FROM subscriptions WHERE organization_id = ${organizationId}`)[0];
  // More storage must still fit in the organization's container (Operação → Armazenamento).
  const { organization: storageNow } = await getStorageRoom(organizationId);
  const storageBefore = storageNow?.limitMb ?? null;
  const storageAfter = effectiveLimits(plan.limits, (input.limitOverrides ?? existing?.limit_overrides ?? {}) as Partial<PlanLimits>).storageMb;
  if (storageAfter !== storageBefore && (storageAfter === null || storageBefore === null || storageAfter > storageBefore)) {
    await assertStorageFits(organizationId, storageAfter);
  }
  const defaultGraceDays = existing ? Number(existing.grace_days) : (await getPlatformSettings()).defaultGraceDays;
  const basePrice = input.cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
  const setupFee = input.setupFee ?? (existing ? Number(existing.setup_fee) : plan.setupFee);
  const setupFeeStatus = existing
    ? String(existing.setup_fee_status)
    : input.chargeSetupFee === false || setupFee === 0
      ? setupFee === 0
        ? 'none'
        : 'waived'
      : 'pending';

  await sql`
    INSERT INTO subscriptions (
      organization_id, plan_id, cycle, base_price, extra_technician_price, included_technicians,
      discount_percent, discount_amount, setup_fee, setup_fee_status, grace_days, limit_overrides
    )
    VALUES (
      ${organizationId}, ${plan.id}, ${input.cycle}, ${basePrice}, ${plan.extraTechnicianPrice}, ${plan.includedTechnicians},
      ${input.discountPercent ?? 0}, ${input.discountAmount ?? 0}, ${setupFee}, ${setupFeeStatus},
      ${input.graceDays ?? defaultGraceDays}, ${JSON.stringify(input.limitOverrides ?? {})}::jsonb
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET plan_id = EXCLUDED.plan_id,
        cycle = EXCLUDED.cycle,
        base_price = EXCLUDED.base_price,
        extra_technician_price = EXCLUDED.extra_technician_price,
        included_technicians = EXCLUDED.included_technicians,
        discount_percent = ${input.discountPercent ?? (existing ? Number(existing.discount_percent) : 0)},
        discount_amount = ${input.discountAmount ?? (existing ? Number(existing.discount_amount) : 0)},
        grace_days = ${input.graceDays ?? defaultGraceDays},
        limit_overrides = ${JSON.stringify(input.limitOverrides ?? existing?.limit_overrides ?? {})}::jsonb,
        canceled_at = NULL,
        updated_at = NOW()
  `;
  if (!existing) await grantBonusCredits(organizationId, plan.aiBonusCredits);

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: existing ? 'subscription.updated' : 'subscription.created',
    targetType: 'subscription',
    targetId: organizationId,
    details: {
      before: existing ? { planId: existing.plan_id, cycle: existing.cycle, basePrice: Number(existing.base_price) } : null,
      after: { planId: plan.id, cycle: input.cycle, basePrice, setupFee, setupFeeStatus },
    },
  });
  // With a plan it has a storage limit: place it in a container (no-op when it already has one).
  await autoAssignQuietly(organizationId);

  return getSubscription(organizationId);
}
