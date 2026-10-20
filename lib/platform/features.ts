import { recordAudit } from '../audit';
import { sql } from '../db';
import { CORE_FEATURES } from '../plans';
import { isUuid, PlatformError, type Actor } from './errors';

const FEATURE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;

export type FeatureScope = 'general' | 'custom';

function serializeFeature(row: Record<string, unknown>) {
  return {
    key: String(row.key),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    scope: row.scope as FeatureScope,
    builtin: Boolean(row.builtin),
    core: CORE_FEATURES.includes(String(row.key) as (typeof CORE_FEATURES)[number]),
    createdAt: new Date(row.created_at as string).toISOString(),
    promotedAt: row.promoted_at ? new Date(row.promoted_at as string).toISOString() : null,
    archived: Boolean(row.archived_at),
    plans: (row.plans as Array<{ id: string; name: string }> | null) ?? [],
    organizations: (row.organizations as Array<{ id: string; name: string }> | null) ?? [],
  };
}

export type CatalogFeature = ReturnType<typeof serializeFeature>;

/** Every feature with the plans that include it and the organizations it was granted to. */
export async function listFeatures(options: { includeArchived?: boolean } = {}) {
  const rows = await sql`
    SELECT f.*,
      (SELECT COALESCE(json_agg(json_build_object('id', p.id, 'name', p.name) ORDER BY p.display_order), '[]'::json)
         FROM plans p WHERE f.key = ANY(p.features) AND p.archived_at IS NULL) AS plans,
      (SELECT COALESCE(json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.name), '[]'::json)
         FROM organization_features g JOIN organizations o ON o.id = g.organization_id
         WHERE g.feature_key = f.key AND g.revoked_at IS NULL AND o.deleted_at IS NULL) AS organizations
    FROM features f
    WHERE ${options.includeArchived ?? true} OR f.archived_at IS NULL
    ORDER BY f.builtin DESC, f.created_at, f.name
  `;
  return rows.map(serializeFeature);
}

async function requireFeature(key: string) {
  const rows = await sql`SELECT * FROM features WHERE key = ${key}`;
  if (!rows[0]) throw new PlatformError('Recurso não encontrado.', 404);
  return rows[0];
}

export async function getFeature(key: string) {
  await requireFeature(key);
  const feature = (await listFeatures()).find((item) => item.key === key)!;
  const history = await sql`
    SELECT a.action, a.details, a.created_at, u.name AS actor_name, o.name AS organization_name
    FROM audit_events a
    LEFT JOIN users u ON u.id = a.actor_id
    LEFT JOIN organizations o ON o.id = a.organization_id
    WHERE a.target_type = 'feature' AND a.target_id = ${key}
    ORDER BY a.created_at DESC
    LIMIT 100
  `;
  return {
    feature,
    history: history.map((row) => ({
      action: String(row.action),
      reason: (row.details as { reason?: string } | null)?.reason ?? null,
      organizationName: (row.organization_name as string | null) ?? null,
      actorName: (row.actor_name as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
    })),
  };
}

/** General, non-archived feature keys: the ones a plan may include. */
export async function listGeneralFeatureKeys() {
  const rows = await sql`SELECT key FROM features WHERE scope = 'general' AND archived_at IS NULL`;
  return new Set(rows.map((row) => String(row.key)));
}

function audit(actor: Actor, action: string, key: string, details: Record<string, unknown>, organizationId: string | null = null) {
  return recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action,
    targetType: 'feature',
    targetId: key,
    details,
  });
}

/** New features are always custom: they reach organizations only by grant, until promoted. */
export async function createFeature(input: Record<string, unknown>, actor: Actor) {
  const key = String(input.key ?? '').trim().toLowerCase();
  const name = String(input.name ?? '').trim();
  const description = String(input.description ?? '').trim() || null;
  if (!FEATURE_KEY_PATTERN.test(key)) throw new PlatformError('Chave: comece com letra e use letras minúsculas, números e "_".');
  if (!name) throw new PlatformError('Informe o nome do recurso.');

  try {
    await sql`
      INSERT INTO features (key, name, description, scope, created_by)
      VALUES (${key}, ${name}, ${description}, 'custom', ${actor.id})
    `;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PlatformError('Esta chave já está cadastrada.', 409);
    throw error;
  }
  await audit(actor, 'feature.created', key, { name, description });
  return (await getFeature(key)).feature;
}

export async function updateFeature(key: string, input: Record<string, unknown>, actor: Actor) {
  const before = await requireFeature(key);
  const name = 'name' in input ? String(input.name ?? '').trim() : String(before.name);
  if (!name) throw new PlatformError('Informe o nome do recurso.');
  const description = 'description' in input ? String(input.description ?? '').trim() || null : before.description;

  await sql`UPDATE features SET name = ${name}, description = ${description}, updated_at = NOW() WHERE key = ${key}`;
  await audit(actor, 'feature.updated', key, { before: { name: before.name, description: before.description }, after: { name, description } });
  return (await getFeature(key)).feature;
}

/**
 * Archiving turns the feature off everywhere (grants stop counting, plans drop it); restoring brings
 * the grants back but not the plans. Built-in features can't be archived.
 */
export async function setFeatureArchived(key: string, archived: boolean, reason: string, actor: Actor) {
  const feature = await requireFeature(key);
  if (feature.builtin) throw new PlatformError('Recursos nativos do produto não podem ser arquivados.');
  if (archived && reason.trim().length < 5) throw new PlatformError('Informe o motivo do arquivamento.');

  await sql.transaction([
    sql`UPDATE features SET archived_at = ${archived ? new Date().toISOString() : null}, updated_at = NOW() WHERE key = ${key}`,
    ...(archived ? [sql`UPDATE plans SET features = array_remove(features, ${key}), updated_at = NOW() WHERE ${key} = ANY(features)`] : []),
  ]);
  await audit(actor, archived ? 'feature.archived' : 'feature.restored', key, { reason: reason || null });
  return (await getFeature(key)).feature;
}

/** Sets exactly which organizations have the custom feature. */
export async function setFeatureOrganizations(key: string, organizationIds: unknown, actor: Actor) {
  const feature = await requireFeature(key);
  if (feature.archived_at) throw new PlatformError('Restaure o recurso antes de liberá-lo.');
  if (!Array.isArray(organizationIds) || !organizationIds.every(isUuid)) throw new PlatformError('Lista de organizações inválida.');

  const current = await sql`SELECT organization_id FROM organization_features WHERE feature_key = ${key} AND revoked_at IS NULL`;
  const currentIds = new Set(current.map((row) => String(row.organization_id)));
  const wanted = new Set(organizationIds as string[]);

  for (const organizationId of wanted) {
    if (currentIds.has(organizationId)) continue;
    await sql`INSERT INTO organization_features (organization_id, feature_key, granted_by) VALUES (${organizationId}, ${key}, ${actor.id})`;
    await audit(actor, 'feature.granted', key, { name: feature.name }, organizationId);
  }
  for (const organizationId of currentIds) {
    if (wanted.has(organizationId)) continue;
    await sql`
      UPDATE organization_features SET revoked_at = NOW(), revoked_by = ${actor.id}
      WHERE organization_id = ${organizationId} AND feature_key = ${key} AND revoked_at IS NULL
    `;
    await audit(actor, 'feature.revoked', key, { name: feature.name }, organizationId);
  }
  return (await getFeature(key)).feature;
}

/** Turns a custom feature into a general one, included in the chosen plans. */
export async function promoteFeature(key: string, planIds: unknown, reason: string, actor: Actor) {
  const feature = await requireFeature(key);
  if (feature.archived_at) throw new PlatformError('Restaure o recurso antes de promovê-lo.');
  if (!Array.isArray(planIds) || !planIds.length || !planIds.every(isUuid)) throw new PlatformError('Selecione pelo menos um plano.');
  if (reason.trim().length < 5) throw new PlatformError('Informe o motivo da promoção.');

  const plans = await sql`SELECT id, name FROM plans WHERE id = ANY(${planIds as string[]}::uuid[]) AND archived_at IS NULL`;
  if (plans.length !== planIds.length) throw new PlatformError('Há planos inválidos ou arquivados na seleção.');

  await sql.transaction([
    sql`UPDATE features SET scope = 'general', promoted_at = COALESCE(promoted_at, NOW()), updated_at = NOW() WHERE key = ${key}`,
    sql`
      UPDATE plans SET features = array_append(features, ${key}), updated_at = NOW()
      WHERE id = ANY(${planIds as string[]}::uuid[]) AND NOT (${key} = ANY(features))
    `,
  ]);
  await audit(actor, 'feature.promoted', key, { reason, plans: plans.map((plan) => plan.name) });
  return (await getFeature(key)).feature;
}

/** Custom features of one organization, for its detail page. */
export async function listOrganizationFeatures(organizationId: string) {
  const rows = await sql`
    SELECT f.key, f.name, f.description, g.granted_at
    FROM organization_features g
    JOIN features f ON f.key = g.feature_key
    WHERE g.organization_id = ${organizationId} AND g.revoked_at IS NULL AND f.archived_at IS NULL
    ORDER BY f.name
  `;
  return rows.map((row) => ({
    key: String(row.key),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    grantedAt: new Date(row.granted_at as string).toISOString(),
  }));
}

/** Grants or revokes one feature for one organization. */
export async function setOrganizationFeature(organizationId: string, key: string, enabled: boolean, actor: Actor) {
  const current = await sql`SELECT organization_id FROM organization_features WHERE feature_key = ${key} AND revoked_at IS NULL`;
  const ids = new Set(current.map((row) => String(row.organization_id)));
  if (enabled) ids.add(organizationId);
  else ids.delete(organizationId);
  await setFeatureOrganizations(key, [...ids], actor);
  return listOrganizationFeatures(organizationId);
}
