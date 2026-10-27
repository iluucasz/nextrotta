import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { annualFactor, planFromRow } from '@/lib/plans';
import { getBuilderPlan, listModuleOffers } from '@/lib/platform/modules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Plans shown on the marketing site: the visible, non-archived ready-made packages, with readable
 * feature names, and `builder` ("Monte o seu": the base plus the modules on sale, each with its price)
 * or null when the builder is off.
 */
export async function GET() {
  try {
    const [rows, catalog] = await Promise.all([
      sql`SELECT * FROM plans WHERE visible = TRUE AND archived_at IS NULL ORDER BY display_order, name`,
      // General features only: custom ones are never advertised.
      sql`SELECT key, name, description FROM features WHERE scope = 'general' AND archived_at IS NULL ORDER BY builtin DESC, created_at, name`,
    ]);
    const general = new Set(catalog.map((feature) => String(feature.key)));
    const all = rows.map(planFromRow);
    const builderPlan = await getBuilderPlan();
    const offers = builderPlan ? await listModuleOffers(builderPlan) : [];
    const factor = builderPlan ? annualFactor(builderPlan) : 12;
    const builder =
      builderPlan && offers.length
        ? {
            key: builderPlan.key,
            name: builderPlan.name,
            description: builderPlan.description,
            monthlyPrice: builderPlan.monthlyPrice,
            annualPrice: builderPlan.annualPrice,
            extraTechnicianPrice: builderPlan.extraTechnicianPrice,
            setupFee: builderPlan.setupFee,
            includedTechnicians: builderPlan.includedTechnicians,
            limits: builderPlan.limits,
            backupRetentionDays: builderPlan.backupRetentionDays,
            features: builderPlan.features.filter((key) => general.has(key)),
            modules: offers.map((offer) => ({
              key: offer.key,
              name: offer.name,
              description: offer.description,
              monthlyPrice: offer.monthlyPrice,
              annualPrice: Math.round(offer.monthlyPrice * factor * 100) / 100,
              setupFee: offer.setupFee,
            })),
          }
        : null;
    const plans = all.filter((plan) => plan.kind === 'package').map((plan) => {
      return {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        monthlyPrice: plan.monthlyPrice,
        annualPrice: plan.annualPrice,
        extraTechnicianPrice: plan.extraTechnicianPrice,
        setupFee: plan.setupFee,
        onRequest: plan.onRequest,
        featured: plan.featured,
        includedTechnicians: plan.includedTechnicians,
        limits: plan.limits,
        backupRetentionDays: plan.backupRetentionDays,
        ai: plan.features.includes('ai'),
        features: plan.features.filter((key) => general.has(key)),
      };
    });
    return NextResponse.json({
      plans,
      builder,
      features: catalog.map((feature) => ({ key: String(feature.key), name: String(feature.name), description: (feature.description as string | null) ?? null })),
    });
  } catch (error) {
    console.error('[public/plans] error:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os planos.' }, { status: 500 });
  }
}
