import { recordAudit } from '../audit';
import { sql } from '../db';
import { effectiveLimits, type PlanLimits } from '../plans';
import { isUuid, PlatformError, type Actor } from './errors';
import { getPlatformSettings, updatePlatformSettings } from './settings';
import { formatMb, getStorageCapacity } from './vercel-plan';

/**
 * Operação → Armazenamento: file storage sized in containers (e.g. 10 GB with a 5% reserve) and each
 * organization placed in one. Bookkeeping only: every file lives in the one Blob store, each
 * organization in its own folder (library/<organization id>/), and its own limit is checked on
 * upload (checkLimit). The container's reserve is never handed out.
 */

/** Size and reserve for containers opened automatically (platform settings → capacity.storageLot). */
export type StorageLotSettings = { sizeGb: number; reservePercent: number };

const MB = 1024 * 1024;

export type ContainerOrganization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  planName: string | null;
  /** What it receives (plan or override), in MB; null = no limit. */
  limitMb: number | null;
  usedMb: number;
  containerId: string | null;
  since: string | null;
};

export type StorageContainer = {
  id: string;
  name: string;
  notes: string | null;
  sizeMb: number;
  reservePercent: number;
  usableMb: number;
  allocatedMb: number;
  usedMb: number;
  freeMb: number;
  createdAt: string;
  organizations: number;
};

function usableOf(sizeMb: number, reservePercent: number) {
  return Math.floor(sizeMb * (1 - reservePercent / 100));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}

async function loadOrganizations(organizationId?: string): Promise<ContainerOrganization[]> {
  const rows = await sql.query(
    `
      SELECT o.id, o.name, o.slug, o.status, o.storage_container_id, o.storage_container_since,
             s.organization_id IS NOT NULL AS subscribed, s.limit_overrides, p.name AS plan_name, p.storage_mb,
             (SELECT COALESCE(SUM(d.bytes), 0)::float FROM organization_files d WHERE d.organization_id = o.id) AS used_bytes
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.canceled_at IS NULL
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE o.deleted_at IS NULL ${organizationId ? 'AND o.id = $1' : ''}
      ORDER BY o.created_at
    `,
    organizationId ? [organizationId] : [],
  );
  return rows.map((row) => {
    const planLimits: PlanLimits = {
      maxUsers: null,
      storageMb: row.storage_mb === null ? null : Number(row.storage_mb),
      whatsappMessagesMonth: null,
      portoRunsMonth: null,
    };
    // Without a subscription there are no limits (lib/billing/entitlements.ts).
    const limitMb = row.subscribed ? effectiveLimits(planLimits, row.limit_overrides as Partial<PlanLimits>).storageMb : null;
    return {
      id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      status: String(row.status),
      planName: row.subscribed ? String(row.plan_name) : null,
      limitMb,
      usedMb: round(Number(row.used_bytes) / MB),
      containerId: row.storage_container_id ? String(row.storage_container_id) : null,
      since: row.storage_container_since ? new Date(row.storage_container_since).toISOString() : null,
    };
  });
}

async function loadContainers(organizations: ContainerOrganization[]): Promise<StorageContainer[]> {
  const rows = await sql`
    SELECT id, name, notes, size_mb, reserve_percent, created_at
    FROM storage_containers
    WHERE archived_at IS NULL
    ORDER BY created_at
  `;
  return rows.map((row) => {
    const id = String(row.id);
    const members = organizations.filter((organization) => organization.containerId === id);
    const sizeMb = Number(row.size_mb);
    const reservePercent = Number(row.reserve_percent);
    const usableMb = usableOf(sizeMb, reservePercent);
    const allocatedMb = members.reduce((sum, organization) => sum + (organization.limitMb ?? 0), 0);
    return {
      id,
      name: String(row.name),
      notes: row.notes ? String(row.notes) : null,
      sizeMb,
      reservePercent,
      usableMb,
      allocatedMb,
      usedMb: round(members.reduce((sum, organization) => sum + organization.usedMb, 0)),
      freeMb: usableMb - allocatedMb,
      createdAt: new Date(row.created_at).toISOString(),
      organizations: members.length,
    };
  });
}

export async function getStorage() {
  const [organizations, settings, vercel] = await Promise.all([loadOrganizations(), getPlatformSettings(), getStorageCapacity()]);
  const containers = await loadContainers(organizations);
  const active = new Set(containers.map((container) => container.id));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  return {
    containers,
    organizations: organizations.map((organization) => ({
      ...organization,
      // A container archived meanwhile counts as none.
      containerId: organization.containerId && active.has(organization.containerId) ? organization.containerId : null,
    })),
    defaults: settings.capacity.storageLot,
    totals: {
      sizeMb: sum(containers.map((container) => container.sizeMb)),
      usableMb: sum(containers.map((container) => container.usableMb)),
      allocatedMb: sum(containers.map((container) => container.allocatedMb)),
      usedMb: round(sum(organizations.map((organization) => organization.usedMb))),
    },
    vercel: {
      plan: vercel.plan,
      hobbyRoomMb: vercel.hobby?.roomMb ?? null,
      blocked: vercel.blocked,
    },
  };
}

function text(value: unknown, label: string, max = 80) {
  const result = String(value ?? '').trim();
  if (!result) throw new PlatformError(`Informe ${label}.`);
  if (result.length > max) throw new PlatformError(`${label[0].toUpperCase()}${label.slice(1)}: no máximo ${max} caracteres.`);
  return result;
}

function sizeInput(value: unknown) {
  const sizeGb = Number(value);
  if (!Number.isFinite(sizeGb) || sizeGb < 0.1) throw new PlatformError('Tamanho: informe pelo menos 0,1 GB.');
  return Math.round(sizeGb * 1024);
}

function reserveInput(value: unknown) {
  const reserve = value === '' || value === null || value === undefined ? 0 : Number(value);
  if (!Number.isFinite(reserve) || reserve < 0 || reserve >= 50) throw new PlatformError('Folga: de 0 a menos de 50%.');
  return Math.round(reserve * 100) / 100;
}

async function requireContainer(id: string) {
  if (!isUuid(id)) throw new PlatformError('Container não encontrado.', 404);
  const organizations = await loadOrganizations();
  const container = (await loadContainers(organizations)).find((item) => item.id === id);
  if (!container) throw new PlatformError('Container não encontrado.', 404);
  return container;
}

async function nameTaken(name: string, exceptId?: string) {
  const rows = await sql`
    SELECT 1 FROM storage_containers
    WHERE archived_at IS NULL AND lower(name) = lower(${name}) AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)
  `;
  return rows.length > 0;
}

export async function createContainer(input: Record<string, unknown>, actor: Actor) {
  const name = text(input.name, 'o nome do container');
  if (await nameTaken(name)) throw new PlatformError(`Já existe um container chamado “${name}”.`);
  const sizeMb = sizeInput(input.sizeGb);
  const reservePercent = reserveInput(input.reservePercent);
  const notes = String(input.notes ?? '').trim() || null;
  const [row] = await sql`
    INSERT INTO storage_containers (name, size_mb, reserve_percent, notes, created_by)
    VALUES (${name}, ${sizeMb}, ${reservePercent}, ${notes}, ${actor.id})
    RETURNING id
  `;
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'storage_container.created',
    targetType: 'storage_container',
    targetId: String(row.id),
    details: { name, sizeMb, reservePercent },
  });
  return getStorage();
}

export async function updateContainer(id: string, input: Record<string, unknown>, actor: Actor) {
  const container = await requireContainer(id);
  const name = 'name' in input ? text(input.name, 'o nome do container') : container.name;
  if (name.toLowerCase() !== container.name.toLowerCase() && (await nameTaken(name, id))) {
    throw new PlatformError(`Já existe um container chamado “${name}”.`);
  }
  const sizeMb = 'sizeGb' in input ? sizeInput(input.sizeGb) : container.sizeMb;
  const reservePercent = 'reservePercent' in input ? reserveInput(input.reservePercent) : container.reservePercent;
  const notes = 'notes' in input ? String(input.notes ?? '').trim() || null : container.notes;
  const usableMb = usableOf(sizeMb, reservePercent);
  if (usableMb < container.allocatedMb) {
    throw new PlatformError(
      `As empresas deste container recebem ${formatMb(container.allocatedMb)}: com esse tamanho e folga sobrariam só ${formatMb(usableMb)}. ` +
        'Transfira empresas antes de diminuir.',
    );
  }
  await sql`
    UPDATE storage_containers
    SET name = ${name}, size_mb = ${sizeMb}, reserve_percent = ${reservePercent}, notes = ${notes}, updated_at = NOW()
    WHERE id = ${id}
  `;
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'storage_container.updated',
    targetType: 'storage_container',
    targetId: id,
    details: {
      before: { name: container.name, sizeMb: container.sizeMb, reservePercent: container.reservePercent },
      after: { name, sizeMb, reservePercent },
    },
  });
  return getStorage();
}

/** Only an empty container can be archived; it stays in the database. */
export async function archiveContainer(id: string, actor: Actor) {
  const container = await requireContainer(id);
  if (container.organizations > 0) {
    throw new PlatformError(`“${container.name}” ainda tem ${container.organizations} empresa(s): transfira-as antes de arquivar.`);
  }
  await sql`UPDATE storage_containers SET archived_at = NOW(), archived_by = ${actor.id}, updated_at = NOW() WHERE id = ${id}`;
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'storage_container.archived',
    targetType: 'storage_container',
    targetId: id,
    details: { name: container.name },
  });
  return getStorage();
}

async function place(organization: ContainerOrganization, container: StorageContainer | null, actorId: string | null, reason: string) {
  await sql`
    UPDATE organizations
    SET storage_container_id = ${container?.id ?? null}, storage_container_since = ${container ? new Date().toISOString() : null}, updated_at = NOW()
    WHERE id = ${organization.id}
  `;
  await recordAudit({
    organizationId: organization.id,
    actorId,
    actorRole: actorId ? 'platform_owner' : 'system',
    action: 'storage_container.assigned',
    targetType: 'organization',
    targetId: organization.id,
    details: { from: organization.containerId, to: container?.id ?? null, toName: container?.name ?? null, limitMb: organization.limitMb, reason },
  });
}

/**
 * Puts an organization in a container (or takes it out, containerId null). It must fit in what's
 * free of the container's usable part; an organization without a limit can't be placed.
 */
export async function assignOrganization(organizationId: string, input: Record<string, unknown>, actor: Actor) {
  if (!isUuid(organizationId)) throw new PlatformError('Empresa não encontrada.', 404);
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new PlatformError('Informe o motivo.');
  const [organization] = await loadOrganizations(organizationId);
  if (!organization) throw new PlatformError('Empresa não encontrada.', 404);

  const containerId = input.containerId ? String(input.containerId) : null;
  if (!containerId) {
    if (!organization.containerId) throw new PlatformError(`${organization.name} já está sem container.`);
    await place(organization, null, actor.id, reason);
    return getStorage();
  }
  const container = await requireContainer(containerId);
  if (organization.containerId === container.id) throw new PlatformError(`${organization.name} já está em “${container.name}”.`);
  if (organization.limitMb === null) {
    throw new PlatformError(
      `${organization.name} está sem limite de armazenamento${organization.planName ? '' : ' (sem plano)'}: ` +
        'dê um valor em Capacidade → Distribuir recursos antes de colocá-la num container.',
    );
  }
  if (organization.limitMb > container.freeMb) {
    throw new PlatformError(
      `Não cabe: ${organization.name} recebe ${formatMb(organization.limitMb)} e “${container.name}” tem ${formatMb(Math.max(0, container.freeMb))} livres. ` +
        'Escolha outro container, aumente este ou abra um novo.',
    );
  }
  await place(organization, container, actor.id, reason);
  return getStorage();
}

/**
 * Places organizations without a container (all of them, or one) in the first container with room,
 * opening a new one with the default size when none fits. Organizations without a limit stay out.
 * Used by the panel button and right after an organization gets its subscription.
 */
export async function autoAssign(actor: Actor | null, organizationId?: string) {
  const settings = await getPlatformSettings();
  const organizations = await loadOrganizations(organizationId);
  const containers = await loadContainers(await loadOrganizations());
  const active = new Set(containers.map((container) => container.id));
  const pending = organizations.filter((organization) => !(organization.containerId && active.has(organization.containerId)));
  const placed: Array<{ organization: string; container: string }> = [];
  const skipped: Array<{ organization: string; reason: string }> = [];

  for (const organization of pending) {
    if (organization.limitMb === null) {
      skipped.push({ organization: organization.name, reason: 'sem limite de armazenamento' });
      continue;
    }
    let container = containers.find((item) => item.freeMb >= (organization.limitMb ?? 0)) ?? null;
    if (!container) {
      const lot = settings.capacity.storageLot;
      const sizeMb = lot ? Math.round(lot.sizeGb * 1024) : 0;
      if (!lot || usableOf(sizeMb, lot.reservePercent) < organization.limitMb) {
        skipped.push({
          organization: organization.name,
          reason: lot ? 'recebe mais que um container padrão: crie um container do tamanho dela' : 'nenhum container com espaço e sem tamanho padrão definido',
        });
        continue;
      }
      let number = containers.length + 1;
      while (await nameTaken(`Armazenamento ${number}`)) number += 1;
      const name = `Armazenamento ${number}`;
      const [row] = await sql`
        INSERT INTO storage_containers (name, size_mb, reserve_percent, created_by)
        VALUES (${name}, ${sizeMb}, ${lot.reservePercent}, ${actor?.id ?? null})
        RETURNING id, created_at
      `;
      await recordAudit({
        organizationId: null,
        actorId: actor?.id ?? null,
        actorRole: actor ? 'platform_owner' : 'system',
        action: 'storage_container.created',
        targetType: 'storage_container',
        targetId: String(row.id),
        details: { name, sizeMb, reservePercent: lot.reservePercent, automatic: true },
      });
      const usableMb = usableOf(sizeMb, lot.reservePercent);
      container = {
        id: String(row.id),
        name,
        notes: null,
        sizeMb,
        reservePercent: lot.reservePercent,
        usableMb,
        allocatedMb: 0,
        usedMb: 0,
        freeMb: usableMb,
        createdAt: new Date(row.created_at).toISOString(),
        organizations: 0,
      };
      containers.push(container);
    }
    await place(organization, container, actor?.id ?? null, 'Distribuição automática');
    container.allocatedMb += organization.limitMb;
    container.freeMb -= organization.limitMb;
    container.organizations += 1;
    placed.push({ organization: organization.name, container: container.name });
  }
  return { placed, skipped };
}

/**
 * What an organization's storage limit can go up to without overflowing its container: its current
 * limit plus what's free in the container. null = no container (only the platform total applies).
 */
export async function getStorageRoom(organizationId: string) {
  const organizations = await loadOrganizations();
  const organization = organizations.find((item) => item.id === organizationId) ?? null;
  if (!organization?.containerId) return { organization, container: null, maxMb: null };
  const container = (await loadContainers(organizations)).find((item) => item.id === organization.containerId) ?? null;
  if (!container) return { organization, container: null, maxMb: null };
  return { organization, container, maxMb: (organization.limitMb ?? 0) + container.freeMb };
}

/**
 * Refuses a storage limit that doesn't fit in the organization's container. `releasedMb` is what
 * another organization of the same container gives up in the same operation (a transfer).
 */
export async function assertStorageFits(organizationId: string, nextMb: number | null, releasedMb = 0) {
  const { organization, container, maxMb } = await getStorageRoom(organizationId);
  if (!organization || !container || maxMb === null) return;
  if (nextMb === null) {
    throw new PlatformError(
      `${organization.name} está no container “${container.name}”: armazenamento sem limite não cabe num container. ` +
        'Tire a empresa do container em Operação → Armazenamento, ou dê um valor.',
    );
  }
  if (nextMb > maxMb + releasedMb) {
    throw new PlatformError(
      `Não cabe no container “${container.name}”: ${organization.name} pode ir até ${formatMb(maxMb + releasedMb)} ` +
        `(recebe ${formatMb(organization.limitMb ?? 0)} + ${formatMb(Math.max(0, container.freeMb + releasedMb))} livres). ` +
        'Transfira a empresa para um container com mais espaço em Operação → Armazenamento, ou aumente o container.',
    );
  }
}

/** Size and reserve of the containers opened automatically; sizeGb empty = never open one. */
export async function setContainerDefaults(input: Record<string, unknown>, actor: Actor) {
  const { capacity } = await getPlatformSettings();
  const empty = input.sizeGb === '' || input.sizeGb === null || input.sizeGb === undefined;
  const storageLot = empty ? null : { sizeGb: sizeInput(input.sizeGb) / 1024, reservePercent: reserveInput(input.reservePercent) };
  await updatePlatformSettings({ capacity: { ...capacity, storageLot } }, actor);
  return getStorage();
}

/** Never blocks the flow that called it (signup, provisioning): a failure only leaves the organization without a container. */
export async function autoAssignQuietly(organizationId: string) {
  try {
    await autoAssign(null, organizationId);
  } catch (error) {
    console.error('[storage] Automatic container assignment failed:', error);
  }
}
