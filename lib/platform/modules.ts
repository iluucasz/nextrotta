import { recordAudit } from '../audit';
import { sql } from '../db';
import { annualFactor, CORE_FEATURES, planFromRow, quoteBuilder, type BillingCycle, type ModuleOffer, type Plan } from '../plans';
import { PlatformError, type Actor } from './errors';

/**
 * Modules: the general features a company can add to the builder plan ("Monte o seu"), each with the
 * price the owner set. Features the base already includes, and the core ones, are never sold apart.
 */

function money(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new PlatformError(`${label}: informe um valor maior ou igual a zero.`);
  return Math.round(parsed * 100) / 100;
}

/** The base of the builder, or null when there isn't one (the builder is off). */
export async function getBuilderPlan(): Promise<Plan | null> {
  const rows = await sql`SELECT * FROM plans WHERE kind = 'builder' AND archived_at IS NULL ORDER BY display_order LIMIT 1`;
  return rows[0] ? planFromRow(rows[0]) : null;
}

/** The modules on sale: general features with a price that the base doesn't already include. */
export async function listModuleOffers(builder?: Plan | null): Promise<ModuleOffer[]> {
  const plan = builder === undefined ? await getBuilderPlan() : builder;
  const rows = await sql`
    SELECT key, name, description, module_price, module_setup_fee
    FROM features
    WHERE scope = 'general' AND archived_at IS NULL AND module_price IS NOT NULL
    ORDER BY builtin DESC, created_at, name
  `;
  return rows
    .filter((row) => !plan?.features.includes(String(row.key)))
    .map((row) => ({
      key: String(row.key),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      monthlyPrice: Number(row.module_price),
      setupFee: Number(row.module_setup_fee),
    }));
}

/** What the builder costs with these modules, or an error naming the ones that can't be chosen. */
export async function quoteBuilderSelection(moduleKeys: unknown, cycle: BillingCycle) {
  const plan = await getBuilderPlan();
  if (!plan) throw new PlatformError('A montagem de plano não está disponível.');
  const selected = Array.isArray(moduleKeys) ? moduleKeys.map(String) : [];
  const offers = await listModuleOffers(plan);
  const quote = quoteBuilder(plan, offers, selected, cycle);
  if (quote.unknown.length) {
    throw new PlatformError(`Módulo indisponível: ${quote.unknown.join(', ')}.`);
  }
  const details = quote.modules.map((module) => {
    const offer = offers.find((candidate) => candidate.key === module.key)!;
    return { ...module, name: offer.name, description: offer.description };
  });
  return { plan, quote, details };
}

/** The owner's view: every general feature, whether it is sold as a module and at what price. */
export async function listModulePrices() {
  const [builder, rows] = await Promise.all([
    getBuilderPlan(),
    sql`
      SELECT key, name, description, builtin, module_price, module_setup_fee
      FROM features
      WHERE scope = 'general' AND archived_at IS NULL
      ORDER BY builtin DESC, created_at, name
    `,
  ]);
  return {
    builder: builder && {
      id: builder.id,
      name: builder.name,
      monthlyPrice: builder.monthlyPrice,
      annualPrice: builder.annualPrice,
      annualFactor: annualFactor(builder),
      setupFee: builder.setupFee,
      includedTechnicians: builder.includedTechnicians,
      extraTechnicianPrice: builder.extraTechnicianPrice,
    },
    modules: rows.map((row) => {
      const key = String(row.key);
      const core = (CORE_FEATURES as string[]).includes(key);
      const inBase = Boolean(builder?.features.includes(key));
      return {
        key,
        name: String(row.name),
        description: (row.description as string | null) ?? null,
        core,
        inBase,
        // Core and base features aren't sold apart, whatever price they carry.
        sellable: !core && !inBase,
        monthlyPrice: row.module_price === null ? null : Number(row.module_price),
        setupFee: Number(row.module_setup_fee),
      };
    }),
  };
}

/** Sets (or, with price null, removes) a feature's module price and setup fee. */
export async function setModulePrice(featureKey: string, input: Record<string, unknown>, actor: Actor) {
  const [feature] = await sql`SELECT key, scope, archived_at, module_price, module_setup_fee FROM features WHERE key = ${featureKey}`;
  if (!feature || feature.archived_at) throw new PlatformError('Recurso não encontrado.', 404);
  if (feature.scope !== 'general') throw new PlatformError('Só recursos gerais podem ser vendidos como módulo. Promova o recurso antes.');
  if ((CORE_FEATURES as string[]).includes(featureKey)) throw new PlatformError('Este recurso faz parte da base de todos os planos.');
  const builder = await getBuilderPlan();
  if (builder?.features.includes(featureKey)) throw new PlatformError('Este recurso já está incluso na base da montagem.');

  const price = input.monthlyPrice === null || input.monthlyPrice === '' || input.monthlyPrice === undefined ? null : money(input.monthlyPrice, 'Preço mensal');
  const setupFee = input.setupFee === undefined ? Number(feature.module_setup_fee) : money(input.setupFee, 'Implantação do módulo');
  await sql`UPDATE features SET module_price = ${price}, module_setup_fee = ${setupFee}, updated_at = NOW() WHERE key = ${featureKey}`;

  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'module.price_updated',
    targetType: 'feature',
    targetId: featureKey,
    details: {
      before: { monthlyPrice: feature.module_price === null ? null : Number(feature.module_price), setupFee: Number(feature.module_setup_fee) },
      after: { monthlyPrice: price, setupFee },
    },
  });
  return listModulePrices();
}
