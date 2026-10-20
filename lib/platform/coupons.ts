// Relative imports only: expireCoupons() runs in the VPS worker (worker/tsconfig.json).
import { recordAudit } from '../audit';
import { brasiliaToday, syncSubscriptionValueQuietly } from '../billing/billing';
import { sql } from '../db';
import { isUuid, PlatformError, type Actor } from './errors';

export type CouponKind = 'percent' | 'fixed';

const CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/;

function iso(value: unknown) {
  return value ? new Date(value as string).toISOString() : null;
}

function day(value: unknown) {
  return value ? new Date(value as string).toISOString().slice(0, 10) : null;
}

function serializeCoupon(row: Record<string, unknown>) {
  const expiresOn = day(row.expires_on);
  const uses = Number(row.uses ?? 0);
  const maxUses = row.max_uses === null || row.max_uses === undefined ? null : Number(row.max_uses);
  const archived = Boolean(row.archived_at);
  const status = archived
    ? 'archived'
    : expiresOn && expiresOn < brasiliaToday()
      ? 'expired'
      : maxUses !== null && uses >= maxUses
        ? 'exhausted'
        : 'active';
  return {
    id: String(row.id),
    code: String(row.code),
    kind: row.kind as CouponKind,
    value: Number(row.value),
    durationCycles: Number(row.duration_cycles),
    expiresOn,
    planKeys: (row.plan_keys as string[]) ?? [],
    maxUses,
    uses,
    activeUses: Number(row.active_uses ?? 0),
    status,
    createdAt: iso(row.created_at)!,
  };
}

export type Coupon = ReturnType<typeof serializeCoupon>;

const COUPON_COLUMNS = `
  c.*,
  (SELECT COUNT(*)::int FROM coupon_redemptions r WHERE r.coupon_id = c.id) AS uses,
  (SELECT COUNT(*)::int FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.ended_at IS NULL) AS active_uses
`;

export async function listCoupons() {
  const rows = await sql.query(`SELECT ${COUPON_COLUMNS} FROM coupons c ORDER BY c.created_at DESC`);
  return rows.map(serializeCoupon);
}

async function requireCoupon(id: string) {
  if (!isUuid(id)) throw new PlatformError('Cupom não encontrado.', 404);
  const rows = await sql.query(`SELECT ${COUPON_COLUMNS} FROM coupons c WHERE c.id = $1`, [id]);
  if (!rows[0]) throw new PlatformError('Cupom não encontrado.', 404);
  return rows[0];
}

export async function getCoupon(id: string) {
  const coupon = serializeCoupon(await requireCoupon(id));
  const redemptions = await sql`
    SELECT r.*, o.name AS organization_name
    FROM coupon_redemptions r
    JOIN organizations o ON o.id = r.organization_id
    WHERE r.coupon_id = ${id}
    ORDER BY r.applied_at DESC
  `;
  return {
    coupon,
    redemptions: redemptions.map((row) => ({
      id: String(row.id),
      organizationId: String(row.organization_id),
      organizationName: String(row.organization_name),
      appliedAt: iso(row.applied_at)!,
      endsOn: day(row.ends_on),
      endedAt: iso(row.ended_at),
      endReason: (row.end_reason as string | null) ?? null,
    })),
  };
}

async function parseCouponInput(input: Record<string, unknown>) {
  const kind = input.kind === 'fixed' ? 'fixed' : input.kind === 'percent' ? 'percent' : null;
  if (!kind) throw new PlatformError('Escolha o tipo do desconto.');
  const value = Number(input.value);
  if (!Number.isFinite(value) || value <= 0) throw new PlatformError('Informe um valor de desconto maior que zero.');
  if (kind === 'percent' && value > 100) throw new PlatformError('O percentual não pode passar de 100%.');

  const durationCycles = Number(input.durationCycles ?? 0);
  if (!Number.isInteger(durationCycles) || durationCycles < 0) throw new PlatformError('Duração: número inteiro de ciclos (0 = permanente).');

  const expiresOn = typeof input.expiresOn === 'string' && input.expiresOn ? input.expiresOn : null;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new PlatformError('Validade inválida.');

  const maxUses = input.maxUses === null || input.maxUses === undefined || input.maxUses === '' ? null : Number(input.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) throw new PlatformError('Limite de usos: número inteiro maior que zero, ou vazio para ilimitado.');

  const planKeys = Array.isArray(input.planKeys) ? input.planKeys.map(String) : [];
  if (planKeys.length) {
    const known = await sql`SELECT key FROM plans WHERE key = ANY(${planKeys})`;
    if (known.length !== new Set(planKeys).size) throw new PlatformError('Há planos desconhecidos na lista.');
  }

  return { kind, value: Math.round(value * 100) / 100, durationCycles, expiresOn, maxUses, planKeys: Array.from(new Set(planKeys)) };
}

function audit(actor: Actor, action: string, couponId: string, details: Record<string, unknown>, organizationId: string | null = null) {
  return recordAudit({ organizationId, actorId: actor.id, actorRole: 'platform_owner', action, targetType: 'coupon', targetId: couponId, details });
}

export async function createCoupon(input: Record<string, unknown>, actor: Actor) {
  const code = String(input.code ?? '').trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw new PlatformError('Código: 3 a 40 letras, números, "-" ou "_", sem espaços.');
  const values = await parseCouponInput(input);

  try {
    const rows = await sql`
      INSERT INTO coupons (code, kind, value, duration_cycles, expires_on, plan_keys, max_uses, created_by)
      VALUES (${code}, ${values.kind}, ${values.value}, ${values.durationCycles}, ${values.expiresOn},
              ${values.planKeys}, ${values.maxUses}, ${actor.id})
      RETURNING id
    `;
    await audit(actor, 'coupon.created', String(rows[0].id), { code, ...values });
    return getCoupon(String(rows[0].id));
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PlatformError('Já existe um cupom com esse código.', 409);
    throw error;
  }
}

/** Changes apply to the next organizations that receive the coupon; current ones keep theirs. */
export async function updateCoupon(id: string, input: Record<string, unknown>, actor: Actor) {
  const before = serializeCoupon(await requireCoupon(id));

  if ('archived' in input) {
    const archived = Boolean(input.archived);
    await sql`UPDATE coupons SET archived_at = ${archived ? new Date().toISOString() : null}, updated_at = NOW() WHERE id = ${id}`;
    await audit(actor, archived ? 'coupon.archived' : 'coupon.restored', id, { code: before.code, reason: input.reason ?? null });
    return getCoupon(id);
  }

  const values = await parseCouponInput(input);
  await sql`
    UPDATE coupons
    SET kind = ${values.kind}, value = ${values.value}, duration_cycles = ${values.durationCycles},
        expires_on = ${values.expiresOn}, plan_keys = ${values.planKeys}, max_uses = ${values.maxUses}, updated_at = NOW()
    WHERE id = ${id}
  `;
  await audit(actor, 'coupon.updated', id, { code: before.code, before, after: values });
  return getCoupon(id);
}

function addMonths(dateKey: string, months: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The coupon currently applied to an organization, if any. */
export async function getActiveRedemption(organizationId: string) {
  const rows = await sql`
    SELECT r.*, c.code, c.kind, c.value, c.duration_cycles
    FROM coupon_redemptions r
    JOIN coupons c ON c.id = r.coupon_id
    WHERE r.organization_id = ${organizationId} AND r.ended_at IS NULL
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    couponId: String(row.coupon_id),
    code: String(row.code),
    kind: row.kind as CouponKind,
    value: Number(row.value),
    appliedAt: iso(row.applied_at)!,
    endsOn: day(row.ends_on),
  };
}

/** Applies a coupon to the organization's subscription: its discount replaces the current one. */
export async function applyCoupon(organizationId: string, rawCode: unknown, actor: Actor) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const couponRow = (await sql.query(`SELECT ${COUPON_COLUMNS} FROM coupons c WHERE c.code = $1`, [code]))[0];
  if (!couponRow) throw new PlatformError('Cupom não encontrado.', 404);
  const coupon = serializeCoupon(couponRow);

  if (coupon.status === 'archived') throw new PlatformError('Este cupom está arquivado.');
  if (coupon.status === 'expired') throw new PlatformError('Este cupom está vencido.');
  if (coupon.status === 'exhausted') throw new PlatformError('Este cupom atingiu o limite de usos.');

  const subscription = (
    await sql`
      SELECT s.*, p.key AS plan_key
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.organization_id = ${organizationId} AND s.canceled_at IS NULL
    `
  )[0];
  if (!subscription) throw new PlatformError('A organização precisa de uma assinatura ativa para receber um cupom.');
  if (coupon.planKeys.length && !coupon.planKeys.includes(String(subscription.plan_key))) {
    throw new PlatformError('Este cupom não vale para o plano desta organização.');
  }
  if (await getActiveRedemption(organizationId)) throw new PlatformError('A organização já tem um cupom aplicado. Remova-o antes.');

  const months = subscription.cycle === 'annual' ? 12 : 1;
  const endsOn = coupon.durationCycles ? addMonths(brasiliaToday(), coupon.durationCycles * months) : null;

  await sql.transaction([
    sql`
      INSERT INTO coupon_redemptions (coupon_id, organization_id, previous_discount_percent, previous_discount_amount, ends_on, applied_by)
      VALUES (${coupon.id}, ${organizationId}, ${subscription.discount_percent}, ${subscription.discount_amount}, ${endsOn}, ${actor.id})
    `,
    sql`
      UPDATE subscriptions
      SET discount_percent = ${coupon.kind === 'percent' ? coupon.value : 0},
          discount_amount = ${coupon.kind === 'fixed' ? coupon.value : 0},
          updated_at = NOW()
      WHERE organization_id = ${organizationId}
    `,
  ]);
  await syncSubscriptionValueQuietly(organizationId);
  await audit(actor, 'coupon.applied', coupon.id, { code: coupon.code, endsOn }, organizationId);
  return getActiveRedemption(organizationId);
}

async function endRedemption(organizationId: string, reason: 'expired' | 'removed', actor: Actor | null) {
  const rows = await sql`SELECT * FROM coupon_redemptions WHERE organization_id = ${organizationId} AND ended_at IS NULL`;
  const redemption = rows[0];
  if (!redemption) throw new PlatformError('A organização não tem cupom aplicado.');

  await sql.transaction([
    sql`UPDATE coupon_redemptions SET ended_at = NOW(), end_reason = ${reason} WHERE id = ${redemption.id}`,
    sql`
      UPDATE subscriptions
      SET discount_percent = ${redemption.previous_discount_percent},
          discount_amount = ${redemption.previous_discount_amount},
          updated_at = NOW()
      WHERE organization_id = ${organizationId}
    `,
  ]);
  await syncSubscriptionValueQuietly(organizationId);
  await recordAudit({
    organizationId,
    actorId: actor?.id ?? null,
    actorRole: actor ? 'platform_owner' : 'system',
    action: reason === 'expired' ? 'coupon.expired' : 'coupon.removed',
    targetType: 'coupon',
    targetId: String(redemption.coupon_id),
    details: null,
  });
}

/** Removes the coupon and restores the discount the subscription had before it. */
export function removeCoupon(organizationId: string, actor: Actor) {
  return endRedemption(organizationId, 'removed', actor);
}

/** Daily (worker): coupons whose cycles are over give the previous discount back. */
export async function expireCoupons() {
  const rows = await sql`
    SELECT organization_id FROM coupon_redemptions
    WHERE ended_at IS NULL AND ends_on IS NOT NULL AND ends_on < ${brasiliaToday()}::date
  `;
  for (const row of rows) await endRedemption(String(row.organization_id), 'expired', null);
  return rows.length;
}
