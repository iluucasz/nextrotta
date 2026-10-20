// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { sql } from '../db';
import { effectiveLimits, planFromRow, type PlanFeature, type PlanLimits } from '../plans';

export interface Entitlements {
  planKey: string | null;
  planName: string | null;
  /** null = the organization has no subscription yet, so no general feature is restricted. */
  features: string[] | null;
  /** Custom features granted to this organization alone (catalog of features). */
  granted: string[];
  /** Custom (not general) feature keys: only a grant unlocks them, with or without a plan. */
  customOnly: string[];
  limits: PlanLimits;
}

const UNLIMITED: PlanLimits = { maxUsers: null, storageMb: null, whatsappMessagesMonth: null, portoRunsMonth: null };

/** What the organization's plan unlocks right now. Features follow the plan live; prices don't. */
export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const [rows, catalog] = await Promise.all([
    sql`
      SELECT p.*, s.limit_overrides
      FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.organization_id = ${organizationId}
        AND s.canceled_at IS NULL
    `,
    sql`
      SELECT f.key, f.scope,
        EXISTS (
          SELECT 1 FROM organization_features g
          WHERE g.organization_id = ${organizationId} AND g.feature_key = f.key AND g.revoked_at IS NULL
        ) AS granted
      FROM features f
      WHERE f.archived_at IS NULL
    `,
  ]);

  const granted = catalog.filter((row) => row.granted).map((row) => String(row.key));
  const customOnly = catalog.filter((row) => row.scope === 'custom').map((row) => String(row.key));
  const active = new Set(catalog.map((row) => String(row.key)));

  if (!rows[0]) return { planKey: null, planName: null, features: null, granted, customOnly, limits: UNLIMITED };

  const plan = planFromRow(rows[0]);
  return {
    planKey: plan.key,
    planName: plan.name,
    features: plan.features.filter((key) => active.has(key)),
    granted,
    customOnly,
    limits: effectiveLimits(plan.limits, rows[0].limit_overrides as Partial<PlanLimits>),
  };
}

/** Built-in features follow the plan; custom ones need a grant to this organization. */
export function hasFeature(entitlements: Entitlements, feature: string) {
  if (entitlements.granted.includes(feature)) return true;
  if (entitlements.features === null) return !entitlements.customOnly.includes(feature);
  return entitlements.features.includes(feature);
}

/** Feature keys the organization can use, or null when no general feature is restricted. */
export function enabledFeatures(entitlements: Entitlements) {
  if (entitlements.features === null) return null;
  return Array.from(new Set([...entitlements.features, ...entitlements.granted]));
}

export async function organizationHasFeature(organizationId: string, feature: PlanFeature | string) {
  return hasFeature(await getEntitlements(organizationId), feature);
}

/** First day of the current month in Brasília, as a timestamp boundary. */
const MONTH_START_SQL = `date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;

async function currentUsage(organizationId: string, key: keyof PlanLimits): Promise<number> {
  const queries: Record<keyof PlanLimits, string> = {
    maxUsers: `SELECT COUNT(*)::int AS used FROM users
               WHERE organization_id = $1 AND deleted_at IS NULL AND status = 'active'`,
    // Archived documents still count: their files are kept.
    storageMb: `SELECT COALESCE(SUM(bytes), 0)::float / (1024 * 1024) AS used FROM organization_files
                WHERE organization_id = $1`,
    whatsappMessagesMonth: `SELECT COUNT(*)::int AS used FROM whatsapp_messages
                            WHERE organization_id = $1 AND status = 'sent' AND created_at >= ${MONTH_START_SQL}`,
    // Only runs that write count (automatic ones and "Rodar agora"); tests and skipped runs don't.
    portoRunsMonth: `SELECT COUNT(*)::int AS used FROM porto_sync_log
                     WHERE organization_id = $1 AND status NOT IN ('skipped', 'dry_run') AND started_at >= ${MONTH_START_SQL}`,
  };

  const rows = await sql.query(queries[key], [organizationId]);
  return Number(rows[0]?.used ?? 0);
}

const LIMIT_MESSAGES: Record<keyof PlanLimits, (limit: number) => string> = {
  maxUsers: (limit) => `O plano permite até ${limit} usuários ativos. Desative um usuário ou fale com o suporte para ampliar.`,
  storageMb: (limit) => `O armazenamento do plano (${limit} MB) está cheio. Fale com o suporte para ampliar.`,
  whatsappMessagesMonth: (limit) => `Limite mensal de ${limit} mensagens de WhatsApp do plano atingido.`,
  portoRunsMonth: (limit) => `Limite mensal de ${limit} execuções da automação Porto do plano atingido.`,
};

/**
 * Whether adding `amount` (1 user, N megabytes, 1 message, 1 run) stays within the limit.
 * Returns the message to show when it doesn't.
 */
export async function checkLimit(
  organizationId: string,
  key: keyof PlanLimits,
  amount = 1,
): Promise<{ allowed: true } | { allowed: false; message: string }> {
  const { limits } = await getEntitlements(organizationId);
  const limit = limits[key];
  if (limit === null) return { allowed: true };

  const used = await currentUsage(organizationId, key);
  return used + amount <= limit ? { allowed: true } : { allowed: false, message: LIMIT_MESSAGES[key](limit) };
}

/** SQL condition: organization `alias` may use `feature` (no subscription = everything allowed). */
export function featureAllowedSql(alias: string, feature: PlanFeature) {
  return `(
    NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = ${alias}.id AND s.canceled_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.organization_id = ${alias}.id AND s.canceled_at IS NULL AND '${feature}' = ANY(p.features)
    )
  )`;
}
