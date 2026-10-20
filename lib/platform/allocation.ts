import { recordAudit } from '../audit';
import { sql } from '../db';
import { effectiveLimits, LIMIT_KEYS, type PlanLimits } from '../plans';
import { isUuid, PlatformError, type Actor } from './errors';
import { getPlatformSettings } from './settings';
import { assertStorageFits, getStorageRoom } from './storage-containers';
import { getStoragePool } from './vercel-plan';

/**
 * Operação → Capacidade → Distribuir recursos: the owner hands each organization a share of what
 * the platform has. A share is the organization's effective limit (plan value, or its own override
 * in subscriptions.limit_overrides), the same number checkLimit() enforces. Moving shares never
 * deletes anything: every change is an override plus an audit event.
 */

export type ResourceKey = keyof PlanLimits;

export const RESOURCES: Record<ResourceKey, { label: string; unit: 'mb' | 'count'; monthly: boolean }> = {
  storageMb: { label: 'Armazenamento', unit: 'mb', monthly: false },
  whatsappMessagesMonth: { label: 'Mensagens de WhatsApp por mês', unit: 'count', monthly: true },
  portoRunsMonth: { label: 'Execuções do Porto por mês', unit: 'count', monthly: true },
  maxUsers: { label: 'Usuários ativos', unit: 'count', monthly: false },
};

const PLAN_COLUMNS: Record<ResourceKey, string> = {
  storageMb: 'storage_mb',
  whatsappMessagesMonth: 'whatsapp_messages_month',
  portoRunsMonth: 'porto_runs_month',
  maxUsers: 'max_users',
};

const MONTH_START = `date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`;

/** What each organization uses of the resource now (this month for the monthly ones). */
const USAGE_SQL: Record<ResourceKey, string> = {
  storageMb: `(SELECT COALESCE(SUM(d.bytes), 0)::float / (1024 * 1024) FROM organization_files d WHERE d.organization_id = o.id)`,
  whatsappMessagesMonth: `(SELECT COUNT(*)::int FROM whatsapp_messages m
                            WHERE m.organization_id = o.id AND m.status = 'sent' AND m.created_at >= ${MONTH_START})`,
  portoRunsMonth: `(SELECT COUNT(*)::int FROM porto_sync_log l
                     WHERE l.organization_id = o.id AND l.status NOT IN ('skipped', 'dry_run') AND l.started_at >= ${MONTH_START})`,
  maxUsers: `(SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.id AND u.deleted_at IS NULL AND u.status = 'active')`,
};

export function parseResource(value: unknown): ResourceKey {
  if (typeof value === 'string' && (LIMIT_KEYS as string[]).includes(value)) return value as ResourceKey;
  throw new PlatformError('Recurso inválido.');
}

/** The platform's total of the resource; null = no total informed (allocations aren't capped). */
async function poolOf(key: ResourceKey) {
  if (key === 'storageMb') {
    const pool = await getStoragePool();
    return pool === null ? null : Math.round(pool);
  }
  const { capacity } = await getPlatformSettings();
  return capacity.pools[key];
}

function format(key: ResourceKey, value: number) {
  if (RESOURCES[key].unit === 'mb') {
    return value >= 1024 ? `${(value / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB` : `${Math.round(value)} MB`;
  }
  return value.toLocaleString('pt-BR');
}

type Row = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planName: string;
  /** What the plan gives (null = unlimited). */
  planValue: number | null;
  /** Whether the owner set an own value for this organization. */
  adjusted: boolean;
  /** Effective share (null = unlimited). */
  allocated: number | null;
  used: number;
  overrides: Partial<PlanLimits>;
};

async function loadRows(key: ResourceKey, organizationId?: string): Promise<Row[]> {
  const rows = await sql.query(
    `
      SELECT o.id, o.name, o.slug, o.status, p.name AS plan_name,
             p.${PLAN_COLUMNS[key]} AS plan_value, s.limit_overrides,
             ${USAGE_SQL[key]} AS used
      FROM organizations o
      JOIN subscriptions s ON s.organization_id = o.id AND s.canceled_at IS NULL
      JOIN plans p ON p.id = s.plan_id
      WHERE o.deleted_at IS NULL ${organizationId ? 'AND o.id = $1' : ''}
      ORDER BY o.name
    `,
    organizationId ? [organizationId] : [],
  );
  return rows.map((row) => {
    const overrides = (row.limit_overrides ?? {}) as Partial<PlanLimits>;
    const planValue = row.plan_value === null ? null : Number(row.plan_value);
    const limits = effectiveLimits({ maxUsers: null, storageMb: null, whatsappMessagesMonth: null, portoRunsMonth: null, [key]: planValue }, overrides);
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status),
      planName: String(row.plan_name),
      planValue,
      adjusted: key in overrides,
      allocated: limits[key],
      used: Math.round(Number(row.used) * 10) / 10,
      overrides,
    };
  });
}

export async function getAllocation(key: ResourceKey) {
  const [rows, pool, unsubscribed, containers] = await Promise.all([
    loadRows(key),
    poolOf(key),
    sql`
      SELECT COUNT(*)::int AS count FROM organizations o
      WHERE o.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id AND s.canceled_at IS NULL)
    `,
    key === 'storageMb' ? sql`SELECT COUNT(*)::int AS count FROM storage_containers WHERE archived_at IS NULL` : Promise.resolve([]),
  ]);
  const hasContainers = Number(containers[0]?.count ?? 0) > 0;
  const allocated = rows.reduce((sum, row) => sum + (row.allocated ?? 0), 0);
  return {
    resource: key,
    ...RESOURCES[key],
    pool,
    allocated,
    unlimited: rows.filter((row) => row.allocated === null).length,
    free: pool === null ? null : pool - allocated,
    /** Why there's no total, when it's on purpose (storage lots open as needed). */
    poolNote: pool === null && hasContainers ? 'Por container: veja Operação → Armazenamento' : null,
    used: rows.reduce((sum, row) => sum + row.used, 0),
    /** Organizations without a subscription have no limits and can't receive a share. */
    unsubscribed: Number(unsubscribed[0]?.count ?? 0),
    organizations: rows.map(({ overrides: _overrides, ...row }) => row),
  };
}

async function requireRow(key: ResourceKey, organizationId: string) {
  if (!isUuid(organizationId)) throw new PlatformError('Empresa não encontrada.', 404);
  const [row] = await loadRows(key, organizationId);
  if (!row) throw new PlatformError('Empresa sem plano ativo: contrate um plano antes de distribuir recursos.', 404);
  return row;
}

function wholeAmount(key: ResourceKey, value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new PlatformError(`${label}: informe um número maior ou igual a zero.`);
  return Math.round(parsed);
}

function overridesWith(row: Row, key: ResourceKey, mode: 'plan' | 'value' | 'unlimited', value: number | null) {
  const next: Partial<PlanLimits> = { ...row.overrides };
  if (mode === 'plan') delete next[key];
  else next[key] = mode === 'unlimited' ? null : value;
  return next;
}

/**
 * Sets one organization's share: its own value, back to the plan's, or unlimited. Refuses less
 * than what it already uses and more than what's free of the platform's total.
 */
export async function setAllocation(organizationId: string, input: Record<string, unknown>, actor: Actor) {
  const key = parseResource(input.resource);
  const mode = input.mode === 'plan' || input.mode === 'unlimited' ? input.mode : 'value';
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new PlatformError('Informe o motivo do ajuste.');

  const row = await requireRow(key, organizationId);
  const next = mode === 'plan' ? row.planValue : mode === 'unlimited' ? null : wholeAmount(key, input.value, 'Valor');
  const unit = RESOURCES[key];

  if (next !== null && next < row.used) {
    throw new PlatformError(
      `${row.name} já usa ${format(key, row.used)}${unit.monthly ? ' neste mês' : ''}: não dá para deixar menos que isso.`,
    );
  }

  if (key === 'storageMb' && (next === null || row.allocated === null || next > row.allocated)) await assertStorageFits(row.id, next);

  const pool = await poolOf(key);
  const growing = row.allocated !== null && (next === null || next > row.allocated);
  if (pool !== null && (growing || row.allocated === null)) {
    if (next === null) {
      throw new PlatformError('Com o total da plataforma definido, nenhuma empresa pode ficar sem limite: informe um valor.');
    }
    const { allocated } = await getAllocation(key);
    const othersAllocated = allocated - (row.allocated ?? 0);
    if (othersAllocated + next > pool) {
      const free = Math.max(0, pool - othersAllocated - (row.allocated ?? 0));
      throw new PlatformError(
        `Só há ${format(key, free)} livres de ${unit.label.toLowerCase()} (total ${format(key, pool)}). ` +
          'Transfira de outra empresa ou aumente o total em "Definir capacidades".',
      );
    }
  }

  await sql`
    UPDATE subscriptions SET limit_overrides = ${JSON.stringify(overridesWith(row, key, mode, next))}::jsonb, updated_at = NOW()
    WHERE organization_id = ${organizationId} AND canceled_at IS NULL
  `;
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'allocation.updated',
    targetType: 'subscription',
    targetId: organizationId,
    details: { resource: key, before: row.allocated, after: next, mode, reason },
  });
  return getAllocation(key);
}

/** Moves part of one organization's share to another; the platform's total doesn't change. */
export async function transferAllocation(input: Record<string, unknown>, actor: Actor) {
  const key = parseResource(input.resource);
  const amount = wholeAmount(key, input.amount, 'Quantidade');
  const reason = String(input.reason ?? '').trim();
  if (amount <= 0) throw new PlatformError('Quantidade: informe um valor maior que zero.');
  if (!reason) throw new PlatformError('Informe o motivo da transferência.');
  if (input.from === input.to) throw new PlatformError('Escolha duas empresas diferentes.');

  const from = await requireRow(key, String(input.from ?? ''));
  const to = await requireRow(key, String(input.to ?? ''));
  if (from.allocated === null) throw new PlatformError(`${from.name} está sem limite: defina um valor antes de transferir dela.`);
  if (to.allocated === null) throw new PlatformError(`${to.name} já está sem limite: não há o que somar.`);

  const spare = from.allocated - from.used;
  if (amount > spare) {
    throw new PlatformError(
      `${from.name} só pode ceder ${format(key, Math.max(0, spare))}: o resto está em uso${RESOURCES[key].monthly ? ' neste mês' : ''}.`,
    );
  }

  const fromNext = from.allocated - amount;
  const toNext = to.allocated + amount;
  if (key === 'storageMb') {
    // Within one container the amount just changes hands; across containers the receiver's must fit it.
    const [fromRoom, toRoom] = await Promise.all([getStorageRoom(from.id), getStorageRoom(to.id)]);
    const sameContainer = Boolean(fromRoom.container && fromRoom.container.id === toRoom.container?.id);
    await assertStorageFits(to.id, toNext, sameContainer ? amount : 0);
  }
  await sql.transaction([
    sql`
      UPDATE subscriptions SET limit_overrides = ${JSON.stringify(overridesWith(from, key, 'value', fromNext))}::jsonb, updated_at = NOW()
      WHERE organization_id = ${from.id} AND canceled_at IS NULL
    `,
    sql`
      UPDATE subscriptions SET limit_overrides = ${JSON.stringify(overridesWith(to, key, 'value', toNext))}::jsonb, updated_at = NOW()
      WHERE organization_id = ${to.id} AND canceled_at IS NULL
    `,
  ]);
  const details = { resource: key, amount, from: from.id, to: to.id, reason };
  await recordAudit({
    organizationId: from.id,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'allocation.transferred',
    targetType: 'subscription',
    targetId: from.id,
    details: { ...details, before: from.allocated, after: fromNext },
  });
  await recordAudit({
    organizationId: to.id,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'allocation.transferred',
    targetType: 'subscription',
    targetId: to.id,
    details: { ...details, before: to.allocated, after: toNext },
  });
  return getAllocation(key);
}
