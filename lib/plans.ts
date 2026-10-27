/**
 * Plans, features and subscription pricing. Dependency-free: shared by the owner panel, the
 * organization's screens, the API and the worker. Database access lives in lib/billing/.
 */

/** General features a plan can unlock. Keys are stored in plans.features. */
export const PLAN_FEATURES = {
  technicians: 'Técnicos',
  services: 'Ordens de serviço',
  service_import: 'Importação de planilhas de OS',
  hours: 'Horas e banco de horas',
  schedule: 'Escala',
  payroll: 'Folha de pagamento e recibo',
  library: 'Biblioteca de documentos',
  porto: 'Automação Porto Seguro',
  whatsapp: 'Notificações por WhatsApp',
  finance: 'Controle financeiro',
  billing_report: 'Faturamento',
  management_dashboard: 'Dashboard gerencial',
  ai: 'Assistente de IA',
  parts: 'Venda de Peças',
  support: 'Suporte',
} as const;

export type PlanFeature = keyof typeof PLAN_FEATURES;

/** The core of the product: every plan includes these and they are never gated. */
export const CORE_FEATURES: PlanFeature[] = ['technicians', 'services', 'hours', 'schedule', 'payroll', 'support'];

export function isPlanFeature(value: unknown): value is PlanFeature {
  return typeof value === 'string' && value in PLAN_FEATURES;
}

export type BillingCycle = 'monthly' | 'annual';

/** Limits: null means unlimited. */
export interface PlanLimits {
  maxUsers: number | null;
  storageMb: number | null;
  whatsappMessagesMonth: number | null;
  portoRunsMonth: number | null;
}

/**
 * Limits the owner can set (plans, overrides, distribution). WhatsApp isn't one: every organization
 * sends from its own number, so messages are always unlimited (owner's decision, 07/10/2026).
 */
export const LIMIT_KEYS: Array<keyof PlanLimits> = ['maxUsers', 'storageMb', 'portoRunsMonth'];

/** A package is a ready-made plan; the builder is the base to which modules are added one by one. */
export type PlanKind = 'package' | 'builder';

export interface Plan {
  id: string;
  key: string;
  kind: PlanKind;
  name: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  extraTechnicianPrice: number;
  setupFee: number;
  onRequest: boolean;
  featured: boolean;
  displayOrder: number;
  visible: boolean;
  includedTechnicians: number;
  limits: PlanLimits;
  /** Feature keys: the built-in ones (PLAN_FEATURES) plus custom features promoted to general. */
  features: string[];
  aiMonthlyCredits: number;
  aiBonusCredits: number;
  /** null = unlimited */
  backupRetentionDays: number | null;
  archived: boolean;
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableInt(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

export function planFromRow(row: Record<string, unknown>): Plan {
  return {
    id: String(row.id),
    key: String(row.key),
    kind: row.kind === 'builder' ? 'builder' : 'package',
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    monthlyPrice: num(row.monthly_price),
    annualPrice: num(row.annual_price),
    extraTechnicianPrice: num(row.extra_technician_price),
    setupFee: num(row.setup_fee),
    onRequest: Boolean(row.on_request),
    featured: Boolean(row.featured),
    displayOrder: num(row.display_order),
    visible: Boolean(row.visible),
    includedTechnicians: num(row.included_technicians),
    limits: {
      maxUsers: nullableInt(row.max_users),
      storageMb: nullableInt(row.storage_mb),
      // Always unlimited (see LIMIT_KEYS); the column is kept for history.
      whatsappMessagesMonth: null,
      portoRunsMonth: nullableInt(row.porto_runs_month),
    },
    features: (Array.isArray(row.features) ? row.features : []).map(String),
    aiMonthlyCredits: num(row.ai_monthly_credits),
    aiBonusCredits: num(row.ai_bonus_credits),
    backupRetentionDays: nullableInt(row.backup_retention_days),
    archived: Boolean(row.archived_at),
  };
}

/** Annual price against twelve months of the monthly one, e.g. "2 meses grátis". */
export function annualSavings(plan: Pick<Plan, 'monthlyPrice' | 'annualPrice'>) {
  return Math.max(0, Math.round((plan.monthlyPrice * 12 - plan.annualPrice) * 100) / 100);
}

export interface SubscriptionPricing {
  cycle: BillingCycle;
  basePrice: number;
  extraTechnicianPrice: number;
  includedTechnicians: number;
  discountPercent: number;
  discountAmount: number;
}

/**
 * What the organization pays per cycle: base price plus technicians beyond the included ones
 * (the extra price is monthly, so an annual cycle charges twelve of it), minus the discounts.
 */
export function calculateSubscriptionValue(pricing: SubscriptionPricing, activeTechnicians: number) {
  const extraTechnicians = Math.max(0, activeTechnicians - pricing.includedTechnicians);
  const extraMonths = pricing.cycle === 'annual' ? 12 : 1;
  const gross = pricing.basePrice + extraTechnicians * pricing.extraTechnicianPrice * extraMonths;
  const discounted = gross * (1 - pricing.discountPercent / 100) - pricing.discountAmount;
  return {
    extraTechnicians,
    gross: Math.round(gross * 100) / 100,
    value: Math.max(0, Math.round(discounted * 100) / 100),
  };
}

// ---------------------------------------------------------------------------------------------
// The builder: a base plus the modules the company chose
// ---------------------------------------------------------------------------------------------

/** A module on sale: a general feature with its own monthly price and setup fee. */
export interface ModuleOffer {
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  setupFee: number;
}

/** A module a subscription chose: the price is for the subscription's cycle and is frozen. */
export interface SubscriptionModule {
  key: string;
  price: number;
  setupFee: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** How many monthly payments the annual price asks for (10 when the annual price is "2 months free"). */
export function annualFactor(plan: Pick<Plan, 'monthlyPrice' | 'annualPrice'>) {
  return plan.monthlyPrice > 0 && plan.annualPrice > 0 ? plan.annualPrice / plan.monthlyPrice : 12;
}

export interface BuilderQuote {
  /** Base plan price for the cycle, before the modules. */
  planPrice: number;
  modules: SubscriptionModule[];
  /** What goes in the subscription's base_price: the plan price plus the modules, for the cycle. */
  basePrice: number;
  /** Plan setup fee plus the modules' ones. */
  setupFee: number;
  /** Chosen keys that are neither included in the base nor on sale. */
  unknown: string[];
}

/**
 * Prices a builder subscription. Keys the base already includes are free; keys that aren't on sale are
 * reported in `unknown` and left out. The annual price of a module is its monthly price times the
 * same factor the base plan uses.
 */
export function quoteBuilder(
  plan: Pick<Plan, 'monthlyPrice' | 'annualPrice' | 'setupFee' | 'features'>,
  offers: ModuleOffer[],
  selected: string[],
  cycle: BillingCycle,
): BuilderQuote {
  const factor = cycle === 'annual' ? annualFactor(plan) : 1;
  const planPrice = cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
  const modules: SubscriptionModule[] = [];
  const unknown: string[] = [];
  for (const key of Array.from(new Set(selected))) {
    if (plan.features.includes(key)) continue;
    const offer = offers.find((candidate) => candidate.key === key);
    if (!offer) unknown.push(key);
    else modules.push({ key, price: round2(offer.monthlyPrice * factor), setupFee: round2(offer.setupFee) });
  }
  return {
    planPrice,
    modules,
    basePrice: round2(planPrice + modules.reduce((total, module) => total + module.price, 0)),
    setupFee: round2(plan.setupFee + modules.reduce((total, module) => total + module.setupFee, 0)),
    unknown,
  };
}

/** Plan limit, unless the organization has its own override (an explicit null means unlimited). */
export function effectiveLimits(planLimits: PlanLimits, overrides: Partial<PlanLimits> | null | undefined): PlanLimits {
  const result: PlanLimits = { ...planLimits, whatsappMessagesMonth: null };
  for (const key of LIMIT_KEYS) {
    if (overrides && key in overrides) result[key] = overrides[key] ?? null;
  }
  return result;
}
