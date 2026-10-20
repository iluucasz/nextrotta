import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { planFromRow } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plans shown on the marketing site: the visible, non-archived ones, with readable feature names. */
export async function GET() {
  try {
    const [rows, catalog] = await Promise.all([
      sql`SELECT * FROM plans WHERE visible = TRUE AND archived_at IS NULL ORDER BY display_order, name`,
      // General features only: custom ones are never advertised.
      sql`SELECT key, name, description FROM features WHERE scope = 'general' AND archived_at IS NULL ORDER BY builtin DESC, created_at, name`,
    ]);
    const general = new Set(catalog.map((feature) => String(feature.key)));
    const plans = rows.map((row) => {
      const plan = planFromRow(row);
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
      features: catalog.map((feature) => ({ key: String(feature.key), name: String(feature.name), description: (feature.description as string | null) ?? null })),
    });
  } catch (error) {
    console.error('[public/plans] error:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os planos.' }, { status: 500 });
  }
}
