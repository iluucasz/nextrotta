import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth';
import { createLoginHandoff } from '../auth-handoff';
import { recordAudit } from '../audit';
import { cancelBilling } from '../billing/billing';
import { checkLimit } from '../billing/entitlements';
import { sql } from '../db';
import { getOrganizationSettings } from '../organization-settings-store';
import { calculateSubscriptionValue, type BillingCycle } from '../plans';
import { getAccessById } from '../organization-access';
import { getRootDomain, isValidOrganizationSlug, resolveHost } from '../tenant-host';
import type { OrganizationStatus } from '../types';
import { getInstanceStatus } from '../whatsapp/instance';
import { isUuid, PlatformError, type Actor } from './errors';
import { markLeadConverted } from './leads';
import { getSubscription, parseSubscriptionInput, setSubscription } from './plans';
import { getPlatformSettings } from './settings';

export { isUuid, PlatformError, type Actor };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown) {
  return text(value) || null;
}

function temporaryPassword() {
  return randomBytes(12).toString('base64url');
}


// ---------------------------------------------------------------------------------------------
// Listing and detail
// ---------------------------------------------------------------------------------------------

export async function listOrganizations(filters: { status?: string | null; search?: string | null }) {
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const conditions = ['o.deleted_at IS NULL'];

  if (filters.status) conditions.push(`o.status = ${add(filters.status)}`);
  if (filters.search) {
    const term = add(`%${filters.search.toLowerCase()}%`);
    conditions.push(`(lower(o.name) LIKE ${term} OR lower(o.slug) LIKE ${term} OR lower(COALESCE(o.legal_name, '')) LIKE ${term})`);
  }

  const rows = await sql.query(
    `
      SELECT
        o.id, o.name, o.legal_name AS "legalName", o.slug, o.status, o.email, o.city, o.state,
        o.created_at AS "createdAt", o.activated_at AS "activatedAt", o.status_changed_at AS "statusChangedAt",
        o.onboarding_status AS "onboardingStatus", o.signup_source AS "signupSource",
        (SELECT COUNT(*)::int FROM technicians t
          WHERE t.organization_id = o.id AND t.deleted_at IS NULL AND t.status = 'active') AS "activeTechnicians",
        (SELECT COUNT(*)::int FROM users u
          WHERE u.organization_id = o.id AND u.deleted_at IS NULL AND u.status = 'active') AS "activeUsers",
        (SELECT json_build_object('name', u.name, 'email', u.email) FROM users u
          WHERE u.organization_id = o.id AND u.role = 'admin' AND u.deleted_at IS NULL
          ORDER BY u.created_at LIMIT 1) AS "admin",
        p.id AS plan_id, p.name AS plan_name, s.cycle, s.base_price, s.extra_technician_price,
        s.included_technicians, s.discount_percent, s.discount_amount, s.next_due_date
      FROM organizations o
      LEFT JOIN subscriptions s ON s.organization_id = o.id AND s.canceled_at IS NULL
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY o.created_at DESC
    `,
    params,
  );

  // The subscription summary the list shows: plan, cycle, current value and next due date.
  return rows.map(({ plan_id, plan_name, cycle, base_price, extra_technician_price, included_technicians, discount_percent, discount_amount, next_due_date, ...organization }) => ({
    ...organization,
    subscription: plan_id
      ? {
          planId: plan_id,
          planName: plan_name,
          cycle,
          includedTechnicians: Number(included_technicians),
          nextDueDate: next_due_date,
          value: calculateSubscriptionValue(
            {
              cycle: cycle as BillingCycle,
              basePrice: Number(base_price),
              extraTechnicianPrice: Number(extra_technician_price),
              includedTechnicians: Number(included_technicians),
              discountPercent: Number(discount_percent),
              discountAmount: Number(discount_amount),
            },
            Number(organization.activeTechnicians),
          ).value,
        }
      : null,
  }));
}

async function requireOrganization(organizationId: string) {
  if (!isUuid(organizationId)) throw new PlatformError('Organização não encontrada.', 404);

  const rows = await sql`SELECT * FROM organizations WHERE id = ${organizationId} AND deleted_at IS NULL`;
  if (!rows[0]) throw new PlatformError('Organização não encontrada.', 404);
  return rows[0];
}

export async function getOrganizationDetail(organizationId: string) {
  const organization = await requireOrganization(organizationId);
  // Live WhatsApp state (stored by getInstanceStatus) instead of whatever was last saved.
  await getInstanceStatus(organizationId).catch(() => null);

  const [usage, porto, whatsapp, settings, provisioning, subscription] = await Promise.all([
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM technicians WHERE organization_id = ${organizationId}
          AND deleted_at IS NULL AND status = 'active') AS "activeTechnicians",
        (SELECT COUNT(*)::int FROM users WHERE organization_id = ${organizationId}
          AND deleted_at IS NULL AND status = 'active') AS "activeUsers",
        -- Archived documents still occupy storage: their files are kept.
        (SELECT COALESCE(SUM(bytes), 0)::bigint FROM organization_files
          WHERE organization_id = ${organizationId}) AS "storageBytes",
        (SELECT COUNT(*)::int FROM whatsapp_messages WHERE organization_id = ${organizationId} AND status = 'sent'
          AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS "whatsappSentThisMonth",
        (SELECT COUNT(*)::int FROM porto_sync_log WHERE organization_id = ${organizationId}
          AND started_at >= date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo') AS "portoRunsThisMonth"
    `,
    sql`
      SELECT cpf IS NOT NULL AND encrypted_password IS NOT NULL AS configured, automation_enabled AS "automationEnabled",
             dry_run_only AS "dryRunOnly", last_hours_import_at AS "lastHoursImportAt",
             last_hours_import_status AS "lastHoursImportStatus", last_schedule_check_at AS "lastScheduleCheckAt",
             last_schedule_import_status AS "lastScheduleImportStatus", last_error AS "lastError"
      FROM porto_config WHERE organization_id = ${organizationId}
    `,
    sql`
      SELECT enabled, updated_at AS "updatedAt", instance_name AS "instance", connection_state AS "state",
             connected_number AS "number", connection_checked_at AS "checkedAt"
      FROM whatsapp_config WHERE organization_id = ${organizationId}
    `,
    getOrganizationSettings(organizationId),
    getProvisioning(organizationId),
    getSubscription(organizationId),
  ]);
  const access = await getAccessById(organizationId);

  return {
    organization: serializeOrganization(organization),
    usage: usage[0],
    integrations: {
      porto: porto[0] ?? { configured: false, automationEnabled: false },
      whatsapp: whatsapp[0] ?? { enabled: false },
    },
    settings,
    provisioning,
    subscription,
    access: access ? { level: access.level, readOnlyUntil: access.readOnlyUntil, since: access.since } : null,
  };
}

function serializeOrganization(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    city: row.city,
    state: row.state,
    slug: row.slug,
    status: row.status,
    statusReason: row.status_reason,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    // Self-service signups: awaiting_payment (setup fee) → setup (team preparing) → done (released).
    onboardingStatus: (row.onboarding_status as string | null) ?? null,
    signupSource: (row.signup_source as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Creation and provisioning
// ---------------------------------------------------------------------------------------------

export async function checkSlugAvailability(rawSlug: string) {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidOrganizationSlug(slug)) {
    return { slug, available: false, reason: 'Use letras minúsculas, números e hífen (sem nomes reservados).' };
  }

  const { reservedSubdomains } = await getPlatformSettings();
  if (reservedSubdomains.includes(slug)) {
    return { slug, available: false, reason: 'Este subdomínio está reservado nas configurações da plataforma.' };
  }

  const taken = await sql`SELECT 1 FROM organizations WHERE slug = ${slug}`;
  return taken.length
    ? { slug, available: false, reason: 'Este subdomínio já está em uso.' }
    : { slug, available: true, reason: null };
}

async function isEmailTaken(email: string) {
  const rows = await sql`SELECT 1 FROM users WHERE email = ${email} AND deleted_at IS NULL`;
  return rows.length > 0;
}

type ProvisioningStepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

type ProvisioningStep = {
  key: string;
  label: string;
  status: ProvisioningStepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  note: string | null;
};

const PROVISIONING_STEPS: Array<Pick<ProvisioningStep, 'key' | 'label'>> = [
  { key: 'organization', label: 'Criar organização e subdomínio' },
  { key: 'plan', label: 'Aplicar plano, limites e créditos iniciais' },
  { key: 'settings', label: 'Criar configurações padrão' },
  { key: 'admin', label: 'Criar administrador' },
  { key: 'whatsapp', label: 'Criar instância de WhatsApp' },
  { key: 'worker', label: 'Registrar no worker de automações' },
  { key: 'activate', label: 'Ativar e validar o subdomínio' },
];

export async function createOrganization(input: Record<string, unknown>, actor: Actor) {
  const name = text(input.name);
  const slug = text(input.slug).toLowerCase();
  const adminName = text((input.admin as Record<string, unknown> | undefined)?.name);
  const adminEmail = text((input.admin as Record<string, unknown> | undefined)?.email).toLowerCase();

  if (!name) throw new PlatformError('Informe o nome da empresa.');
  const subscription = input.subscription ? parseSubscriptionInput(input.subscription as Record<string, unknown>) : null;
  if (!adminName || !EMAIL_PATTERN.test(adminEmail)) throw new PlatformError('Informe nome e e-mail válidos do administrador.');

  const availability = await checkSlugAvailability(slug);
  if (!availability.available) throw new PlatformError(availability.reason ?? 'Subdomínio indisponível.', 409);
  if (await isEmailTaken(adminEmail)) throw new PlatformError('Este e-mail já é usado por outra conta.', 409);

  const steps: ProvisioningStep[] = PROVISIONING_STEPS.map((step) => ({
    ...step,
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    error: null,
    note: null,
  }));

  try {
    const created = await sql`
      INSERT INTO organizations (slug, name, legal_name, document, email, phone, city, state, status)
      VALUES (
        ${slug}, ${name}, ${optionalText(input.legalName)}, ${optionalText(input.document)},
        ${optionalText(input.email)}, ${optionalText(input.phone)}, ${optionalText(input.city)},
        ${optionalText(input.state)}, 'provisioning'
      )
      RETURNING *
    `;
    const organization = created[0];

    await sql`
      INSERT INTO organization_provisioning (organization_id, admin_name, admin_email, steps, subscription)
      VALUES (
        ${organization.id}, ${adminName}, ${adminEmail}, ${JSON.stringify(steps)}::jsonb,
        ${subscription ? JSON.stringify(subscription) : null}::jsonb
      )
    `;

    if (typeof input.leadId === 'string') await markLeadConverted(input.leadId, String(organization.id), actor);

    await recordAudit({
      organizationId: String(organization.id),
      actorId: actor.id,
      actorRole: 'platform_owner',
      action: 'organization.created',
      targetType: 'organization',
      targetId: String(organization.id),
      details: { name, slug, adminEmail },
    });

    return serializeOrganization(organization);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PlatformError('Este subdomínio já está em uso.', 409);
    throw error;
  }
}

export async function getProvisioning(organizationId: string) {
  const rows = await sql`
    SELECT steps, started_at AS "startedAt", finished_at AS "finishedAt", updated_at AS "updatedAt"
    FROM organization_provisioning WHERE organization_id = ${organizationId}
  `;
  return (rows[0] as { steps: ProvisioningStep[]; startedAt: string; finishedAt: string | null } | undefined) ?? null;
}

type StepOutcome = { status: 'done' | 'skipped'; note?: string };

/**
 * Runs the pending steps in order, persisting each step's state as it goes so the progress screen
 * can poll it. Stops at the first error; calling again resumes from the failed step (every step is
 * safe to repeat). Returns the admin's temporary password when this run created the admin.
 */
export async function runProvisioning(organizationId: string, actor: Actor) {
  const organization = await requireOrganization(organizationId);

  // Claim the run: refuse while another one is mid-step, unless that one looks abandoned.
  const claimed = await sql`
    UPDATE organization_provisioning
    SET updated_at = NOW()
    WHERE organization_id = ${organizationId}
      AND (NOT steps @> '[{"status": "running"}]'::jsonb OR updated_at < NOW() - INTERVAL '2 minutes')
    RETURNING admin_name, admin_email, steps, subscription
  `;
  if (!claimed[0]) {
    const existing = await getProvisioning(organizationId);
    if (!existing) throw new PlatformError('Esta organização não tem provisionamento.', 404);
    throw new PlatformError('O provisionamento já está em andamento.', 409);
  }

  const run = claimed[0];
  const steps = run.steps as ProvisioningStep[];
  let adminTemporaryPassword: string | null = null;

  const persist = () => sql`
    UPDATE organization_provisioning
    SET steps = ${JSON.stringify(steps)}::jsonb, updated_at = NOW()
    WHERE organization_id = ${organizationId}
  `;

  const actions: Record<string, () => Promise<StepOutcome>> = {
    organization: async () => {
      if (!isValidOrganizationSlug(String(organization.slug))) throw new Error('Subdomínio inválido.');
      return { status: 'done' };
    },
    plan: async () => {
      if (!run.subscription) return { status: 'skipped', note: 'Nenhum plano escolhido na criação.' };
      await setSubscription(organizationId, run.subscription, actor);
      return { status: 'done' };
    },
    settings: async () => {
      await sql`INSERT INTO organization_settings (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`;
      return { status: 'done' };
    },
    admin: async () => {
      const email = String(run.admin_email);
      const existing = await sql`
        SELECT organization_id FROM users WHERE email = ${email} AND deleted_at IS NULL LIMIT 1
      `;
      if (existing[0]) {
        if (existing[0].organization_id === organizationId) return { status: 'done', note: 'Administrador já existia.' };
        throw new Error('Este e-mail passou a ser usado por outra conta. Ajuste o administrador e tente de novo.');
      }

      adminTemporaryPassword = temporaryPassword();
      await sql`
        INSERT INTO users (organization_id, email, name, password_hash, role)
        VALUES (${organizationId}, ${email}, ${String(run.admin_name)}, ${await hashPassword(adminTemporaryPassword)}, 'admin')
      `;
      return { status: 'done' };
    },
    whatsapp: async () => ({
      status: 'skipped',
      note: 'A instância de WhatsApp é criada quando a empresa configurar o WhatsApp.',
    }),
    worker: async () => {
      // Registered switched off: the worker only runs an organization once it enables automation.
      await sql.transaction([
        sql`INSERT INTO porto_config (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`,
        sql`INSERT INTO whatsapp_config (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`,
      ]);
      return { status: 'done', note: 'Automações registradas desligadas, até a empresa configurar.' };
    },
    activate: async () => {
      const host = resolveHost(`${organization.slug}.${getRootDomain()}`);
      if (host.kind !== 'organization' || host.slug !== organization.slug) {
        throw new Error('O subdomínio não é reconhecido pela plataforma.');
      }

      await sql`
        UPDATE organizations
        SET status = 'active', activated_at = COALESCE(activated_at, NOW()), status_changed_at = NOW(), updated_at = NOW()
        WHERE id = ${organizationId} AND status = 'provisioning'
      `;
      return { status: 'done' };
    },
  };

  for (const step of steps) {
    if (step.status === 'done' || step.status === 'skipped') continue;

    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.error = null;
    await persist();

    try {
      const outcome = await actions[step.key]();
      step.status = outcome.status;
      step.note = outcome.note ?? null;
      step.finishedAt = new Date().toISOString();
      await persist();
    } catch (error) {
      step.status = 'error';
      step.error = error instanceof Error ? error.message : 'Erro inesperado.';
      step.finishedAt = new Date().toISOString();
      await persist();
      await recordAudit({
        organizationId,
        actorId: actor.id,
        actorRole: 'platform_owner',
        action: 'organization.provisioning_failed',
        targetType: 'organization',
        targetId: organizationId,
        details: { step: step.key, error: step.error },
      });
      break;
    }
  }

  const finished = steps.every((step) => step.status === 'done' || step.status === 'skipped');
  if (finished) {
    await sql`UPDATE organization_provisioning SET finished_at = COALESCE(finished_at, NOW()) WHERE organization_id = ${organizationId}`;
    await recordAudit({
      organizationId,
      actorId: actor.id,
      actorRole: 'platform_owner',
      action: 'organization.provisioned',
      targetType: 'organization',
      targetId: organizationId,
    });
  }

  return { provisioning: await getProvisioning(organizationId), finished, adminTemporaryPassword };
}

// ---------------------------------------------------------------------------------------------
// Editing and lifecycle
// ---------------------------------------------------------------------------------------------

const EDITABLE_FIELDS: Record<string, string> = {
  name: 'name',
  legalName: 'legal_name',
  document: 'document',
  email: 'email',
  phone: 'phone',
  city: 'city',
  state: 'state',
};

export async function updateOrganization(organizationId: string, input: Record<string, unknown>, actor: Actor) {
  const before = await requireOrganization(organizationId);
  const changes: Record<string, string | null> = {};

  for (const [field, column] of Object.entries(EDITABLE_FIELDS)) {
    if (field in input) changes[column] = optionalText(input[field]);
  }
  if ('name' in changes && !changes.name) throw new PlatformError('O nome da empresa não pode ficar vazio.');
  if (!Object.keys(changes).length) throw new PlatformError('Nada para alterar.');

  const columns = Object.keys(changes);
  const assignments = columns.map((column, index) => `${column} = $${index + 2}`).join(', ');
  const rows = await sql.query(
    `UPDATE organizations SET ${assignments}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [organizationId, ...columns.map((column) => changes[column])],
  );

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'organization.updated',
    targetType: 'organization',
    targetId: organizationId,
    details: {
      before: Object.fromEntries(columns.map((column) => [column, before[column] ?? null])),
      after: changes,
    },
  });

  return serializeOrganization(rows[0]);
}

const STATUS_ACTIONS: Record<string, { to: OrganizationStatus; from: OrganizationStatus[]; needsReason: boolean }> = {
  suspend: { to: 'suspended', from: ['active', 'past_due'], needsReason: true },
  reactivate: { to: 'active', from: ['suspended', 'canceled', 'past_due'], needsReason: false },
  cancel: { to: 'canceled', from: ['active', 'past_due', 'suspended'], needsReason: true },
};

export async function changeOrganizationStatus(
  organizationId: string,
  action: string,
  reason: string,
  actor: Actor,
) {
  const rule = STATUS_ACTIONS[action];
  if (!rule) throw new PlatformError('Ação inválida.');
  if (rule.needsReason && reason.trim().length < 3) throw new PlatformError('Informe o motivo.');

  const organization = await requireOrganization(organizationId);
  if (!rule.from.includes(organization.status as OrganizationStatus)) {
    throw new PlatformError('Essa ação não se aplica ao estado atual da organização.', 409);
  }

  if (action === 'cancel') await cancelBilling(organizationId, actor);

  const rows = await sql`
    UPDATE organizations
    SET status = ${rule.to}, status_source = 'owner', status_reason = ${reason.trim() || null},
        status_changed_at = NOW(), updated_at = NOW()
    WHERE id = ${organizationId}
    RETURNING *
  `;

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: `organization.${action}`,
    targetType: 'organization',
    targetId: organizationId,
    details: { from: organization.status, to: rule.to, reason: reason.trim() || null },
  });

  return serializeOrganization(rows[0]);
}

// ---------------------------------------------------------------------------------------------
// Users of an organization
// ---------------------------------------------------------------------------------------------

export async function listOrganizationUsers(organizationId: string) {
  await requireOrganization(organizationId);
  return sql`
    SELECT u.id, u.name, u.email, u.role, u.status, u.last_login_at AS "lastLoginAt", u.created_at AS "createdAt",
           t.id AS "technicianId"
    FROM users u
    LEFT JOIN technicians t ON t.user_id = u.id AND t.deleted_at IS NULL
    WHERE u.organization_id = ${organizationId} AND u.deleted_at IS NULL
    ORDER BY u.role, u.name
  `;
}

export async function createOrganizationAdmin(organizationId: string, input: Record<string, unknown>, actor: Actor) {
  await requireOrganization(organizationId);
  const name = text(input.name);
  const email = text(input.email).toLowerCase();
  if (!name || !EMAIL_PATTERN.test(email)) throw new PlatformError('Informe nome e e-mail válidos.');
  if (await isEmailTaken(email)) throw new PlatformError('Este e-mail já é usado por outra conta.', 409);

  const userLimit = await checkLimit(organizationId, 'maxUsers');
  if (!userLimit.allowed) throw new PlatformError(userLimit.message, 403);

  const password = temporaryPassword();
  const rows = await sql`
    INSERT INTO users (organization_id, email, name, password_hash, role)
    VALUES (${organizationId}, ${email}, ${name}, ${await hashPassword(password)}, 'admin')
    RETURNING id, name, email, role, status
  `;

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'user.created',
    targetType: 'user',
    targetId: String(rows[0].id),
    details: { email, role: 'admin' },
  });

  return { user: rows[0], temporaryPassword: password };
}

export async function updateOrganizationUser(
  organizationId: string,
  userId: string,
  input: Record<string, unknown>,
  actor: Actor,
) {
  if (!isUuid(userId)) throw new PlatformError('Usuário não encontrado.', 404);
  const rows = await sql`
    SELECT u.id, u.role, u.status, t.id AS technician_id
    FROM users u
    LEFT JOIN technicians t ON t.user_id = u.id AND t.deleted_at IS NULL
    WHERE u.id = ${userId} AND u.organization_id = ${organizationId} AND u.deleted_at IS NULL
  `;
  const user = rows[0];
  if (!user) throw new PlatformError('Usuário não encontrado.', 404);

  const changes: Record<string, unknown> = {};
  let temporary: string | null = null;

  if (input.role !== undefined) {
    if (input.role !== 'admin' && input.role !== 'technician') throw new PlatformError('Papel inválido.');
    if (input.role === 'technician' && !user.technician_id) {
      throw new PlatformError('Para virar técnico, o usuário precisa de um cadastro de técnico.');
    }
    changes.role = input.role;
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'inactive') throw new PlatformError('Estado inválido.');
    if (input.status === 'active' && user.status !== 'active') {
      const userLimit = await checkLimit(organizationId, 'maxUsers');
      if (!userLimit.allowed) throw new PlatformError(userLimit.message, 403);
    }
    changes.status = input.status;
  }
  if (input.resetPassword === true) {
    temporary = temporaryPassword();
    changes.password_hash = await hashPassword(temporary);
  }
  if (!Object.keys(changes).length) throw new PlatformError('Nada para alterar.');

  const columns = Object.keys(changes);
  const assignments = columns.map((column, index) => `${column} = $${index + 3}`).join(', ');
  const updated = await sql.query(
    `UPDATE users SET ${assignments}, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING id, name, email, role, status`,
    [userId, organizationId, ...columns.map((column) => changes[column])],
  );

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'user.updated',
    targetType: 'user',
    targetId: userId,
    details: {
      ...(changes.role ? { role: { from: user.role, to: changes.role } } : {}),
      ...(changes.status ? { status: { from: user.status, to: changes.status } } : {}),
      ...(temporary ? { passwordReset: true } : {}),
    },
  });

  return { user: updated[0], temporaryPassword: temporary };
}

// ---------------------------------------------------------------------------------------------
// Internal notes
// ---------------------------------------------------------------------------------------------

export async function listOrganizationNotes(organizationId: string) {
  await requireOrganization(organizationId);
  return sql`
    SELECT n.id, n.text, n.created_at AS "createdAt", u.name AS "authorName"
    FROM organization_notes n
    JOIN users u ON u.id = n.author_id
    WHERE n.organization_id = ${organizationId} AND n.deleted_at IS NULL
    ORDER BY n.created_at DESC
  `;
}

export async function addOrganizationNote(organizationId: string, noteText: string, actor: Actor) {
  await requireOrganization(organizationId);
  const value = noteText.trim();
  if (!value) throw new PlatformError('Escreva a anotação.');

  const rows = await sql`
    INSERT INTO organization_notes (organization_id, author_id, text)
    VALUES (${organizationId}, ${actor.id}, ${value})
    RETURNING id, text, created_at AS "createdAt"
  `;
  return rows[0];
}

export async function archiveOrganizationNote(organizationId: string, noteId: string, actor: Actor) {
  if (!isUuid(noteId)) throw new PlatformError('Anotação não encontrada.', 404);
  const rows = await sql`
    UPDATE organization_notes
    SET deleted_at = NOW(), deleted_by = ${actor.id}
    WHERE id = ${noteId} AND organization_id = ${organizationId} AND deleted_at IS NULL
    RETURNING id
  `;
  if (!rows[0]) throw new PlatformError('Anotação não encontrada.', 404);
}

// ---------------------------------------------------------------------------------------------
// Entering an organization ("entrar na conta")
// ---------------------------------------------------------------------------------------------

/**
 * Opens a session (no time limit) for the owner inside the organization and returns the one-time
 * code that carries it to the organization's subdomain. The reason is optional; the access is
 * always audited.
 */
export async function startImpersonation(organizationId: string, reason: string, actor: Actor) {
  const organization = await requireOrganization(organizationId);
  if (organization.status === 'provisioning') throw new PlatformError('A organização ainda está sendo provisionada.', 409);

  const sessions = await sql`
    INSERT INTO impersonation_sessions (owner_id, organization_id, reason, expires_at)
    VALUES (${actor.id}, ${organizationId}, ${reason.trim() || 'Acesso do dono da plataforma'}, NULL)
    RETURNING id
  `;
  const impersonationId = String(sessions[0].id);

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    impersonationId,
    action: 'impersonation.started',
    details: { reason: reason.trim() },
  });

  const code = await createLoginHandoff(actor.id, organizationId, impersonationId);
  return { slug: String(organization.slug), code, impersonationId };
}
