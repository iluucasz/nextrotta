// Relative imports only: grantMonthlyCredits() runs in the VPS worker (worker/tsconfig.json).
import { recordAudit } from '../audit';
import { brasiliaToday } from '../billing/billing';
import { sql } from '../db';
import { isUuid, PlatformError, type Actor } from './errors';
import { getPlatformSettings } from './settings';

const PAID = `('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')`;

function serializePackage(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    credits: Number(row.credits),
    price: Number(row.price),
    sold: Number(row.sold ?? 0),
    archived: Boolean(row.archived_at),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

const PACKAGE_COLUMNS = `
  k.*,
  (SELECT COUNT(*)::int FROM billing_charges c WHERE c.credit_package_id = k.id AND c.status IN ${PAID}) AS sold
`;

export async function listCreditPackages(options: { activeOnly?: boolean } = {}) {
  const rows = await sql.query(
    `SELECT ${PACKAGE_COLUMNS} FROM ai_credit_packages k ${options.activeOnly ? 'WHERE k.archived_at IS NULL' : ''} ORDER BY k.credits`,
  );
  return rows.map(serializePackage);
}

function parsePackage(input: Record<string, unknown>) {
  const name = String(input.name ?? '').trim();
  const credits = Number(input.credits);
  const price = Number(input.price);
  if (!name) throw new PlatformError('Informe o nome do pacote.');
  if (!Number.isInteger(credits) || credits <= 0) throw new PlatformError('Quantidade de créditos: número inteiro maior que zero.');
  if (!Number.isFinite(price) || price <= 0) throw new PlatformError('Informe um preço maior que zero.');
  return { name, credits, price: Math.round(price * 100) / 100 };
}

function audit(actor: Actor, action: string, targetId: string, details: Record<string, unknown>, organizationId: string | null = null) {
  return recordAudit({ organizationId, actorId: actor.id, actorRole: 'platform_owner', action, targetType: 'ai_credit_package', targetId, details });
}

export async function createCreditPackage(input: Record<string, unknown>, actor: Actor) {
  const values = parsePackage(input);
  const rows = await sql`
    INSERT INTO ai_credit_packages (name, credits, price) VALUES (${values.name}, ${values.credits}, ${values.price}) RETURNING id
  `;
  await audit(actor, 'ai_package.created', String(rows[0].id), { ...values, reason: input.reason ?? null });
  return getCreditPackage(String(rows[0].id));
}

export async function getCreditPackage(id: string) {
  if (!isUuid(id)) throw new PlatformError('Pacote não encontrado.', 404);
  const rows = await sql.query(`SELECT ${PACKAGE_COLUMNS} FROM ai_credit_packages k WHERE k.id = $1`, [id]);
  if (!rows[0]) throw new PlatformError('Pacote não encontrado.', 404);
  const sales = await sql`
    SELECT c.id, c.value, c.status, c.due_date, c.paid_at, o.id AS organization_id, o.name AS organization_name
    FROM billing_charges c JOIN organizations o ON o.id = c.organization_id
    WHERE c.credit_package_id = ${id}
    ORDER BY c.created_at DESC
  `;
  return {
    package: serializePackage(rows[0]),
    sales: sales.map((row) => ({
      id: String(row.id),
      organizationId: String(row.organization_id),
      organizationName: String(row.organization_name),
      value: Number(row.value),
      status: String(row.status),
      dueDate: new Date(row.due_date).toISOString().slice(0, 10),
      paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    })),
  };
}

/** Price changes apply to new purchases only; charges already issued keep their value. */
export async function updateCreditPackage(id: string, input: Record<string, unknown>, actor: Actor) {
  const { package: before } = await getCreditPackage(id);
  if ('archived' in input) {
    const archived = Boolean(input.archived);
    await sql`UPDATE ai_credit_packages SET archived_at = ${archived ? new Date().toISOString() : null}, updated_at = NOW() WHERE id = ${id}`;
    await audit(actor, archived ? 'ai_package.archived' : 'ai_package.restored', id, { name: before.name });
    return getCreditPackage(id);
  }
  const values = parsePackage(input);
  await sql`
    UPDATE ai_credit_packages SET name = ${values.name}, credits = ${values.credits}, price = ${values.price}, updated_at = NOW()
    WHERE id = ${id}
  `;
  await audit(actor, 'ai_package.updated', id, { before, after: values, reason: input.reason ?? null });
  return getCreditPackage(id);
}

/** Used for the cost per answer while there are no answers to measure. */
const TYPICAL_PROMPT_TOKENS = 3500;
const TYPICAL_COMPLETION_TOKENS = 400;

/**
 * What an answer really costs and the minimum price per credit for the owner's margin. The cost
 * comes from the tokens of the last 90 days of answers × the current conversion prices, so it
 * follows a price change at once. margin = (price − cost) ÷ price, so price = cost ÷ (1 − margin).
 */
export async function getCreditPricing() {
  const [{ ai }, [usage]] = await Promise.all([
    getPlatformSettings(),
    sql`
      SELECT COUNT(*)::int AS answers, COALESCE(AVG(prompt_tokens), 0)::float AS prompt, COALESCE(AVG(completion_tokens), 0)::float AS completion,
             COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY prompt_tokens), 0)::float AS prompt_p90,
             COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY completion_tokens), 0)::float AS completion_p90
      FROM ai_messages
      WHERE role = 'assistant' AND prompt_tokens IS NOT NULL AND created_at > NOW() - INTERVAL '90 days'
    `,
  ]);
  const answers = Number(usage?.answers ?? 0);
  const measured = answers > 0;
  const prompt = measured ? Number(usage.prompt) : TYPICAL_PROMPT_TOKENS;
  const completion = measured ? Number(usage.completion) : TYPICAL_COMPLETION_TOKENS;
  const costOf = (input: number, output: number) => (input * ai.inputCostPerMillion + output * ai.outputCostPerMillion) / 1_000_000;
  const costPerUse = costOf(prompt, completion);
  const costPerCredit = costPerUse / ai.creditsPerUse;
  const margin = ai.targetMarginPercent;
  return {
    answersMeasured: answers,
    source: measured ? ('measured' as const) : ('estimate' as const),
    promptTokens: Math.round(prompt),
    completionTokens: Math.round(completion),
    costPerUse,
    /** A heavier answer (90th percentile), to see how much room the margin leaves. */
    costPerUseP90: measured ? costOf(Number(usage.prompt_p90), Number(usage.completion_p90)) : null,
    costPerCredit,
    targetMarginPercent: margin,
    minPricePerCredit: margin === null || costPerCredit <= 0 ? null : costPerCredit / (1 - margin / 100),
    pricesConfigured: ai.inputCostPerMillion > 0 || ai.outputCostPerMillion > 0,
  };
}

/** The price that gives the target margin, rounded up to R$ 0,50 so it never ends below it. */
function priceForMargin(credits: number, minPricePerCredit: number) {
  return Math.max(0.5, Math.ceil(credits * minPricePerCredit * 2) / 2);
}

/** Sets every active package to the price of the target margin (new purchases only). */
export async function applyTargetMargin(input: Record<string, unknown>, actor: Actor) {
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new PlatformError('Informe o motivo.');
  const pricing = await getCreditPricing();
  if (!pricing.pricesConfigured) throw new PlatformError('Preencha os preços da conversão (entrada e saída por milhão de tokens) antes.');
  if (pricing.minPricePerCredit === null) throw new PlatformError('Defina a margem desejada antes.');
  const packages = await listCreditPackages({ activeOnly: true });
  const changes = [];
  for (const item of packages) {
    const price = priceForMargin(item.credits, pricing.minPricePerCredit);
    if (price === item.price) continue;
    await sql`UPDATE ai_credit_packages SET price = ${price}, updated_at = NOW() WHERE id = ${item.id}`;
    await audit(actor, 'ai_package.updated', item.id, {
      before: { price: item.price },
      after: { price },
      reason,
      targetMarginPercent: pricing.targetMarginPercent,
    });
    changes.push({ name: item.name, before: item.price, after: price });
  }
  return { changes };
}

/** Credits consumed, revenue from packages, the provider's real cost and the top consumers. */
export async function getCreditsOverview(period: { from: string; to: string }) {
  const [consumption, revenue, top, settings, packages] = await Promise.all([
    sql`
      SELECT COALESCE(SUM(-quantity), 0)::int AS credits, COALESCE(SUM(cost), 0)::float AS cost
      FROM ai_credit_ledger
      WHERE kind = 'consumption'
        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${period.from}::date AND ${period.to}::date
    `,
    sql.query(
      `SELECT COALESCE(SUM(value), 0)::float AS total FROM billing_charges
       WHERE kind = 'credits' AND status IN ${PAID}
         AND (COALESCE(paid_at, created_at) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $1::date AND $2::date`,
      [period.from, period.to],
    ),
    sql`
      SELECT o.id, o.name,
        COALESCE(SUM(-l.quantity) FILTER (
          WHERE l.kind = 'consumption'
            AND (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${period.from}::date AND ${period.to}::date
        ), 0)::int AS consumed,
        COALESCE(SUM(l.quantity), 0)::int AS balance
      FROM organizations o
      LEFT JOIN ai_credit_ledger l ON l.organization_id = o.id
      WHERE o.deleted_at IS NULL
      GROUP BY o.id, o.name
      ORDER BY consumed DESC, o.name
    `,
    getPlatformSettings(),
    listCreditPackages(),
  ]);
  const pricing = await getCreditPricing();

  return {
    consumedCredits: Number(consumption[0].credits),
    providerCost: Number(consumption[0].cost),
    revenue: Number(revenue[0].total),
    organizations: top.map((row) => ({ id: String(row.id), name: String(row.name), consumed: Number(row.consumed), balance: Number(row.balance) })),
    conversion: settings.ai,
    pricing,
    packages: packages.map((item) => {
      const cost = item.credits * pricing.costPerCredit;
      return {
        ...item,
        /** What the answers of this package cost the owner at the provider. */
        cost,
        marginPercent: item.price > 0 && pricing.pricesConfigured ? ((item.price - cost) / item.price) * 100 : null,
        priceForMargin: pricing.minPricePerCredit === null ? null : priceForMargin(item.credits, pricing.minPricePerCredit),
      };
    }),
  };
}

const KIND_LABELS: Record<string, string> = {
  monthly: 'Cota mensal do plano',
  bonus: 'Bônus de entrada',
  purchase: 'Compra',
  consumption: 'Consumo',
  adjustment: 'Ajuste do dono',
  expiration: 'Cota mensal não usada (expirou)',
};

/** Balance and statement of one organization. */
export async function getOrganizationCredits(organizationId: string) {
  const [balance, ledger, plan, usage] = await Promise.all([
    sql`SELECT COALESCE(SUM(quantity), 0)::int AS balance FROM ai_credit_ledger WHERE organization_id = ${organizationId}`,
    sql`
      SELECT l.*, u.name AS author_name FROM ai_credit_ledger l
      LEFT JOIN users u ON u.id = l.created_by
      WHERE l.organization_id = ${organizationId}
      ORDER BY l.created_at DESC
      LIMIT 200
    `,
    sql`
      SELECT p.ai_monthly_credits, p.ai_bonus_credits, ('ai' = ANY(p.features)) AS has_ai
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.organization_id = ${organizationId} AND s.canceled_at IS NULL
    `,
    sql`
      SELECT TO_CHAR(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(SUM(-quantity), 0)::int AS credits, COUNT(*)::int AS uses
      FROM ai_credit_ledger
      WHERE organization_id = ${organizationId} AND kind = 'consumption'
        AND created_at >= ((DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '5 months') AT TIME ZONE 'America/Sao_Paulo')
      GROUP BY 1 ORDER BY 1
    `,
  ]);
  return {
    balance: Number(balance[0].balance),
    monthlyCredits: plan[0] ? Number(plan[0].ai_monthly_credits) : 0,
    planIncludesAi: plan[0] ? Boolean(plan[0].has_ai) : null,
    usage: usage.map((row) => ({ month: String(row.month), credits: Number(row.credits), uses: Number(row.uses) })),
    entries: ledger.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      kindLabel: KIND_LABELS[String(row.kind)] ?? String(row.kind),
      quantity: Number(row.quantity),
      cost: row.cost === null ? null : Number(row.cost),
      description: (row.description as string | null) ?? null,
      authorName: (row.author_name as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
    })),
  };
}

/** Manual credit or debit by the owner, with a reason. */
export async function adjustCredits(organizationId: string, input: Record<string, unknown>, actor: Actor) {
  const quantity = Number(input.quantity);
  const reason = String(input.reason ?? '').trim();
  if (!Number.isInteger(quantity) || quantity === 0) throw new PlatformError('Informe uma quantidade inteira diferente de zero (negativa para debitar).');
  if (reason.length < 5) throw new PlatformError('Informe o motivo do ajuste.');

  if (quantity < 0) {
    const { balance } = await getOrganizationCredits(organizationId);
    if (balance + quantity < 0) throw new PlatformError(`O saldo atual é ${balance}; não dá para debitar ${-quantity}.`);
  }

  await sql`
    INSERT INTO ai_credit_ledger (organization_id, kind, quantity, description, created_by)
    VALUES (${organizationId}, 'adjustment', ${quantity}, ${reason}, ${actor.id})
  `;
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'ai_credits.adjusted',
    targetType: 'organization',
    targetId: organizationId,
    details: { quantity, reason },
  });
  return getOrganizationCredits(organizationId);
}

/** One-time entry bonus of the plan, when the organization first subscribes. */
export async function grantBonusCredits(organizationId: string, credits: number) {
  if (credits <= 0) return;
  await sql`
    INSERT INTO ai_credit_ledger (organization_id, kind, quantity, description)
    VALUES (${organizationId}, 'bonus', ${credits}, 'Bônus de entrada do plano')
    ON CONFLICT (organization_id) WHERE kind = 'bonus' DO NOTHING
  `;
}

function previousMonth(period: string) {
  const [year, month] = period.split('-').map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** This month's quota right away (after an upgrade to a plan with AI); once per month, like the worker's. */
export async function grantCurrentMonthCredits(organizationId: string, credits: number) {
  if (credits <= 0) return;
  const period = brasiliaToday().slice(0, 7);
  await sql`
    INSERT INTO ai_credit_ledger (organization_id, kind, quantity, period, description)
    VALUES (${organizationId}, 'monthly', ${credits}, ${period}, ${`Cota mensal do plano ${period}`})
    ON CONFLICT (organization_id, period) WHERE kind = 'monthly' DO NOTHING
  `;
}

/**
 * Daily (worker), idempotent. The monthly quota doesn't accumulate: what's left of last month's
 * (its quota minus that month's consumption, never more than the balance) expires first. Then each
 * active organization whose plan includes AI gets this month's quota, once.
 */
export async function grantMonthlyCredits() {
  const period = brasiliaToday().slice(0, 7);
  const previous = previousMonth(period);

  await sql`
    INSERT INTO ai_credit_ledger (organization_id, kind, quantity, period, description)
    SELECT g.organization_id, 'expiration', -LEAST(GREATEST(g.quantity - COALESCE(c.used, 0), 0), b.balance), ${previous},
           ${`Cota mensal de ${previous} não usada`}
    FROM ai_credit_ledger g
    CROSS JOIN LATERAL (
      SELECT SUM(-x.quantity) AS used FROM ai_credit_ledger x
      WHERE x.organization_id = g.organization_id AND x.kind = 'consumption'
        AND to_char(x.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${previous}
    ) c
    CROSS JOIN LATERAL (SELECT SUM(y.quantity) AS balance FROM ai_credit_ledger y WHERE y.organization_id = g.organization_id) b
    WHERE g.kind = 'monthly' AND g.period = ${previous}
      AND LEAST(GREATEST(g.quantity - COALESCE(c.used, 0), 0), b.balance) > 0
    ON CONFLICT (organization_id, period) WHERE kind = 'expiration' DO NOTHING
  `;

  const rows = await sql`
    INSERT INTO ai_credit_ledger (organization_id, kind, quantity, period, description)
    SELECT s.organization_id, 'monthly', p.ai_monthly_credits, ${period}, ${`Cota mensal do plano ${period}`}
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.canceled_at IS NULL AND o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
      AND p.ai_monthly_credits > 0 AND 'ai' = ANY(p.features)
    ON CONFLICT (organization_id, period) WHERE kind = 'monthly' DO NOTHING
    RETURNING organization_id
  `;
  return rows.length;
}
