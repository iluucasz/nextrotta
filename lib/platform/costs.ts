import { sql } from '../db';
import { calculateSubscriptionValue, type BillingCycle } from '../plans';
import { PlatformError } from './errors';

/**
 * What each organization costs the platform in a month and what it pays (Operação → Gastos and the
 * organization's "Custos" tab). The owner enters what each service cost in the month (infra_costs);
 * every category is split by what drives it, measured in the database:
 * - VPS: Porto browser time (the heavy part of the server);
 * - WhatsApp: messages sent;
 * - storage (Vercel Blob): space each organization's files take;
 * - database: estimated size of each organization's rows;
 * - AI: the provider cost recorded per answer (ai_credit_ledger);
 * - the rest (hosting, domain, e-mail, others): evenly.
 * When nobody used a measured resource in the month, it's split evenly. An estimate, not accounting.
 */

export const INFRA_COST_CATEGORIES = {
  vps: 'VPS',
  vercel: 'Vercel (hospedagem)',
  storage: 'Armazenamento (Blob)',
  database: 'Banco de dados',
  domain: 'Domínio',
  whatsapp: 'WhatsApp',
  ai: 'IA',
  email: 'E-mail',
  other: 'Outros',
} as const;

export type CostCategory = keyof typeof INFRA_COST_CATEGORIES;

/** How each category is split; null = evenly among the month's organizations. */
const DRIVERS: Partial<Record<CostCategory, { key: UsageKey; basis: string }>> = {
  vps: { key: 'portoMinutes', basis: 'minutos de navegador do Porto' },
  whatsapp: { key: 'whatsappMessages', basis: 'mensagens de WhatsApp enviadas' },
  storage: { key: 'storageMb', basis: 'espaço de arquivos usado' },
  database: { key: 'databaseMb', basis: 'tamanho estimado dos dados no banco' },
  ai: { key: 'aiCost', basis: 'custo real das respostas da IA' },
};

type UsageKey = 'portoMinutes' | 'whatsappMessages' | 'storageMb' | 'databaseMb' | 'aiCost';

export type OrganizationUsage = {
  portoMinutes: number;
  portoRuns: number;
  whatsappMessages: number;
  storageMb: number;
  databaseMb: number;
  aiCredits: number;
  /** What the AI provider charged for this organization's answers (measured, R$). */
  aiCost: number;
};

export type CostLine = {
  category: CostCategory;
  label: string;
  /** What the platform paid in the month for this category. */
  total: number;
  basis: string;
  /** This organization's part of the driver (0–1). */
  share: number;
  amount: number;
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MB = 1024 * 1024;
const cents = (value: number) => Math.round(value * 100) / 100;

function monthBounds(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const start = `${month}-01`;
  const next = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  return { start, next };
}

/**
 * Bytes of each organization's rows, summed over every table with an organization_id. Leaves out
 * indexes and the database's own overhead: it's a share, not the exact size.
 */
async function databaseBytesByOrganization() {
  const tables = await sql`
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
    ORDER BY c.table_name
  `;
  if (!tables.length) return new Map<string, number>();
  const parts = tables.map((row) => {
    const table = String(row.table_name).replace(/"/g, '""');
    return `SELECT organization_id::text AS id, SUM(pg_column_size(t.*))::float AS bytes FROM "${table}" t WHERE organization_id IS NOT NULL GROUP BY 1`;
  });
  const rows = await sql.query(`SELECT id, SUM(bytes)::float AS bytes FROM (${parts.join(' UNION ALL ')}) parts GROUP BY id`);
  return new Map(rows.map((row) => [String(row.id), Number(row.bytes)]));
}

export async function getCostAllocation(month: string) {
  if (!MONTH_PATTERN.test(month)) throw new PlatformError('Mês inválido (use AAAA-MM).');
  const { start, next } = monthBounds(month);
  const [costs, organizations, browser, messages, storage, ai, databaseBytes] = await Promise.all([
    sql`SELECT category, SUM(amount)::float AS total FROM infra_costs WHERE deleted_at IS NULL AND month = ${month} GROUP BY category`,
    sql`
      SELECT o.id, o.name, o.slug, o.status,
             s.cycle, s.base_price, s.extra_technician_price, s.included_technicians, s.discount_percent, s.discount_amount,
             (SELECT COUNT(*)::int FROM technicians t WHERE t.organization_id = o.id AND t.deleted_at IS NULL AND t.status = 'active') AS active_technicians
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.canceled_at IS NULL
      WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due', 'suspended')
      ORDER BY o.name
    `,
    sql`
      SELECT organization_id, COALESCE(SUM(duration_ms), 0)::float AS ms, COUNT(*)::int AS runs
      FROM porto_sync_log
      WHERE started_at >= ${start}::date AND started_at < ${next}::date
      GROUP BY organization_id
    `,
    sql`
      SELECT organization_id, COUNT(*)::int AS sent
      FROM whatsapp_messages
      WHERE status = 'sent' AND created_at >= ${start}::date AND created_at < ${next}::date
      GROUP BY organization_id
    `,
    // Files are kept while archived too: they still take space.
    sql`SELECT organization_id, COALESCE(SUM(bytes), 0)::float AS bytes FROM organization_files GROUP BY organization_id`,
    sql`
      SELECT organization_id, COALESCE(SUM(cost), 0)::float AS cost, COALESCE(-SUM(quantity), 0)::int AS credits
      FROM ai_credit_ledger
      WHERE kind = 'consumption' AND created_at >= ${start}::date AND created_at < ${next}::date
      GROUP BY organization_id
    `,
    databaseBytesByOrganization(),
  ]);

  const byOrganization = <T>(rows: Record<string, unknown>[], read: (row: Record<string, unknown>) => T) =>
    new Map(rows.map((row) => [String(row.organization_id), read(row)]));
  const browserOf = byOrganization(browser, (row) => ({ ms: Number(row.ms), runs: Number(row.runs) }));
  const sentOf = byOrganization(messages, (row) => Number(row.sent));
  const storageOf = byOrganization(storage, (row) => Number(row.bytes));
  const aiOf = byOrganization(ai, (row) => ({ cost: Number(row.cost), credits: Number(row.credits) }));

  const usage = new Map<string, OrganizationUsage>(
    organizations.map((row) => {
      const id = String(row.id);
      const porto = browserOf.get(id) ?? { ms: 0, runs: 0 };
      return [
        id,
        {
          portoMinutes: Math.round(porto.ms / 60000),
          portoRuns: porto.runs,
          whatsappMessages: sentOf.get(id) ?? 0,
          storageMb: Math.round(((storageOf.get(id) ?? 0) / MB) * 1000) / 1000,
          databaseMb: Math.round(((databaseBytes.get(id) ?? 0) / MB) * 1000) / 1000,
          aiCredits: aiOf.get(id)?.credits ?? 0,
          aiCost: cents(aiOf.get(id)?.cost ?? 0),
        },
      ];
    }),
  );
  // Raw drivers (before rounding) so shares add up to 1.
  const driver = (id: string, key: UsageKey) => {
    if (key === 'portoMinutes') return browserOf.get(id)?.ms ?? 0;
    if (key === 'whatsappMessages') return sentOf.get(id) ?? 0;
    if (key === 'storageMb') return storageOf.get(id) ?? 0;
    if (key === 'databaseMb') return databaseBytes.get(id) ?? 0;
    return aiOf.get(id)?.cost ?? 0;
  };
  const ids = organizations.map((row) => String(row.id));
  const driverTotals = Object.fromEntries(
    (Object.keys(DRIVERS) as CostCategory[]).map((category) => [category, ids.reduce((sum, id) => sum + driver(id, DRIVERS[category]!.key), 0)]),
  ) as Partial<Record<CostCategory, number>>;

  const totals = Object.fromEntries(costs.map((row) => [String(row.category), Number(row.total)])) as Partial<Record<CostCategory, number>>;
  const count = ids.length || 1;

  const rows = organizations.map((row) => {
    const id = String(row.id);
    const lines: CostLine[] = (Object.keys(totals) as CostCategory[]).map((category) => {
      const total = totals[category] ?? 0;
      const rule = DRIVERS[category];
      const driverTotal = rule ? driverTotals[category] ?? 0 : 0;
      const share = rule && driverTotal > 0 ? driver(id, rule.key) / driverTotal : 1 / count;
      return {
        category,
        label: INFRA_COST_CATEGORIES[category] ?? category,
        total,
        basis: rule && driverTotal > 0 ? rule.basis : 'em partes iguais entre as empresas',
        share,
        amount: cents(total * share),
      };
    });
    const cost = cents(lines.reduce((sum, line) => sum + line.amount, 0));
    const revenue = row.cycle
      ? (() => {
          const { value } = calculateSubscriptionValue(
            {
              cycle: row.cycle as BillingCycle,
              basePrice: Number(row.base_price),
              extraTechnicianPrice: Number(row.extra_technician_price),
              includedTechnicians: Number(row.included_technicians),
              discountPercent: Number(row.discount_percent),
              discountAmount: Number(row.discount_amount),
            },
            Number(row.active_technicians),
          );
          return cents(row.cycle === 'annual' ? value / 12 : value);
        })()
      : 0;
    const used = usage.get(id)!;
    return {
      organizationId: id,
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status),
      portoBrowserMinutes: used.portoMinutes,
      portoRuns: used.portoRuns,
      whatsappMessages: used.whatsappMessages,
      usage: used,
      lines,
      estimatedCost: cost,
      monthlyRevenue: revenue,
      margin: cents(revenue - cost),
    };
  });

  return {
    month,
    costs: (Object.entries(totals) as Array<[CostCategory, number]>).map(([category, total]) => ({
      category,
      label: INFRA_COST_CATEGORIES[category] ?? category,
      total,
    })),
    totalCost: cents(Object.values(totals).reduce((sum, value) => sum + (value ?? 0), 0)),
    totalRevenue: cents(rows.reduce((sum, row) => sum + row.monthlyRevenue, 0)),
    /** What the AI provider charged in the month (measured), whether or not the owner entered it. */
    measuredAiCost: cents(ids.reduce((sum, id) => sum + (aiOf.get(id)?.cost ?? 0), 0)),
    organizations: rows,
    method:
      'VPS pelo tempo de navegador do Porto; WhatsApp pelas mensagens enviadas; armazenamento pelo espaço dos arquivos; banco pelo tamanho estimado dos dados; ' +
      'IA pelo custo real das respostas; o resto em partes iguais entre as organizações ativas.',
  };
}

/** One organization's month: its usage, its part of each cost, what it pays. */
export async function getOrganizationCosts(organizationId: string, month: string) {
  const allocation = await getCostAllocation(month);
  const organization = allocation.organizations.find((row) => row.organizationId === organizationId) ?? null;
  return {
    month,
    organization,
    platform: {
      costs: allocation.costs,
      totalCost: allocation.totalCost,
      organizations: allocation.organizations.length,
      measuredAiCost: allocation.measuredAiCost,
    },
    method: allocation.method,
  };
}
