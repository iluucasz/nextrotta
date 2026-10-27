import { createHash, randomUUID } from 'node:crypto';
import { recordAudit } from './audit';
import { hashPassword } from './auth';
import { createLoginHandoff } from './auth-handoff';
import { createCustomer, getPayment } from './billing/asaas';
import { createSetupCharge, nextMonthDueDate, startSubscriptionAfterSetup, upsertCharge } from './billing/billing';
import { sql } from './db';
import { grantBonusCredits } from './platform/ai-credits';
import { PlatformError } from './platform/errors';
import { quoteBuilderSelection } from './platform/modules';
import { checkSlugAvailability } from './platform/organizations';
import { getPlatformSettings } from './platform/settings';
import { calculateSubscriptionValue, planFromRow, type BillingCycle, type SubscriptionModule } from './plans';
import { autoAssignQuietly } from './platform/storage-containers';
import { validatePhone } from './whatsapp/phone';

/**
 * Self-service subscription from the marketing site: the company creates its account, pays the
 * setup fee and waits in "setup" until the platform owner releases it. The first monthly (or
 * annual) charge is next month, on the day the customer chose.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SIGNUPS_PER_HOUR = 3;
export const BILLING_DAYS = [5, 10, 15, 20, 25];

const clip = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

/** CPF (11 digits) or CNPJ (14 digits) with valid check digits — the gateway refuses anything else. */
export function isValidDocument(raw: unknown) {
  const value = digits(raw);
  if (/^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    const check = (length: number) => {
      const sum = value
        .slice(0, length)
        .split('')
        .reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
      const rest = (sum * 10) % 11;
      return rest === 10 ? 0 : rest;
    };
    return check(9) === Number(value[9]) && check(10) === Number(value[10]);
  }
  if (value.length === 14) {
    const check = (length: number) => {
      const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = value
        .slice(0, length)
        .split('')
        .reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
      const rest = sum % 11;
      return rest < 2 ? 0 : 11 - rest;
    };
    return check(12) === Number(value[12]) && check(13) === Number(value[13]);
  }
  return false;
}

/**
 * What the checkout shows before confirming: today's charge and the first recurring one. For the
 * builder plan ("montagem") `modules` lists the chosen modules; the price is the base plus theirs.
 */
export async function quoteSignup(planKey: unknown, cycle: unknown, billingDay: unknown, moduleKeys: unknown = []) {
  const rows = await sql`SELECT * FROM plans WHERE key = ${String(planKey ?? '')} AND archived_at IS NULL AND (visible = TRUE OR kind = 'builder')`;
  if (!rows[0]) throw new PlatformError('Plano indisponível.');
  const plan = planFromRow(rows[0]);
  if (plan.onRequest) throw new PlatformError('Este plano é sob consulta. Fale com a gente pelo formulário de contato.');
  const billingCycle: BillingCycle = cycle === 'annual' ? 'annual' : 'monthly';
  const day = Number(billingDay);
  if (!BILLING_DAYS.includes(day)) throw new PlatformError('Escolha o dia do vencimento.');

  let basePrice = billingCycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
  let setupFee = plan.setupFee;
  let modules: SubscriptionModule[] = [];
  let moduleDetails: Array<SubscriptionModule & { name: string; description: string | null }> = [];
  if (plan.kind === 'builder') {
    const { quote, details } = await quoteBuilderSelection(moduleKeys, billingCycle);
    basePrice = quote.basePrice;
    setupFee = quote.setupFee;
    modules = quote.modules;
    moduleDetails = details;
  }
  const recurring = calculateSubscriptionValue(
    {
      cycle: billingCycle,
      basePrice,
      extraTechnicianPrice: plan.extraTechnicianPrice,
      includedTechnicians: plan.includedTechnicians,
      discountPercent: 0,
      discountAmount: 0,
    },
    0,
  ).value;
  return { plan, cycle: billingCycle, billingDay: day, basePrice, setupFee, modules, moduleDetails, recurring, firstDueDate: nextMonthDueDate(day) };
}

export async function signUp(input: Record<string, unknown>, sourceIp: string | null) {
  // Honeypot: bots fill every field.
  if (clip(input.website, 200)) throw new PlatformError('Não foi possível concluir.', 400);

  const quote = await quoteSignup(input.plan, input.cycle, input.billingDay, input.modules);

  const company = clip(input.company, 160);
  const legalName = clip(input.legalName, 200) || company;
  const document = digits(input.document);
  const companyEmail = clip(input.companyEmail, 200).toLowerCase();
  const phone = validatePhone(clip(input.phone, 40));
  const city = clip(input.city, 80) || null;
  const state = clip(input.state, 2).toUpperCase() || null;
  const slug = clip(input.slug, 63).toLowerCase();
  const adminName = clip(input.adminName, 120);
  const adminEmail = clip(input.adminEmail, 200).toLowerCase();
  const password = String(input.password ?? '');

  if (!company) throw new PlatformError('Informe o nome da empresa.');
  if (!isValidDocument(document)) throw new PlatformError('CNPJ ou CPF inválido. Confira os números.');
  if (!EMAIL_PATTERN.test(companyEmail)) throw new PlatformError('Informe o e-mail da empresa.');
  if (phone.status !== 'valid') throw new PlatformError('Informe o WhatsApp da empresa com DDD.');
  if (!adminName) throw new PlatformError('Informe o nome de quem vai administrar a conta.');
  if (!EMAIL_PATTERN.test(adminEmail)) throw new PlatformError('Informe um e-mail válido para o acesso.');
  if (password.length < 8) throw new PlatformError('A senha precisa ter pelo menos 8 caracteres.');
  if (input.acceptTerms !== true) throw new PlatformError('Aceite os termos de uso e a política de privacidade para continuar.');

  const availability = await checkSlugAvailability(slug);
  if (!availability.available) throw new PlatformError(availability.reason ?? 'Endereço indisponível.', 409);
  const taken = await sql`SELECT 1 FROM users WHERE email = ${adminEmail} AND deleted_at IS NULL`;
  if (taken.length) throw new PlatformError('Este e-mail já tem uma conta no NextRotta. Entre por ela ou use outro e-mail.', 409);

  const sourceHash = sourceIp ? createHash('sha256').update(`nextrotta-lead:${sourceIp}`).digest('hex') : null;
  if (sourceHash) {
    const recent = await sql`
      SELECT COUNT(*)::int AS total FROM leads
      WHERE source_hash = ${sourceHash} AND origin = 'contratar' AND organization_id IS NOT NULL AND created_at > NOW() - INTERVAL '1 hour'
    `;
    if (Number(recent[0].total) >= MAX_SIGNUPS_PER_HOUR) {
      throw new PlatformError('Muitas contratações a partir desta conexão agora há pouco. Tente mais tarde ou fale com a gente.', 429);
    }
  }

  // The gateway customer first: if it refuses the data, nothing is left half-created here.
  const organizationId = randomUUID();
  const needsPayment = quote.setupFee > 0;
  let customerId: string | null = null;
  try {
    const customer = await createCustomer({
      name: legalName,
      cpfCnpj: document,
      email: companyEmail,
      mobilePhone: phone.national,
      externalReference: organizationId,
    });
    customerId = customer.id;
  } catch (error) {
    throw new PlatformError(`Não foi possível registrar a empresa no sistema de pagamento: ${error instanceof Error ? error.message : 'erro desconhecido'}.`, 400);
  }

  const plan = quote.plan;
  const adminId = randomUUID();
  const passwordHash = await hashPassword(password);
  const { defaultGraceDays } = await getPlatformSettings();

  try {
    await sql.transaction([
      sql`
        INSERT INTO organizations (id, slug, name, legal_name, document, email, phone, city, state, status, activated_at,
                                   status_changed_at, signup_source, onboarding_status)
        VALUES (${organizationId}, ${slug}, ${company}, ${legalName}, ${document}, ${companyEmail}, ${phone.formatted}, ${city}, ${state},
                'active', NOW(), NOW(), 'self_service', 'awaiting_payment')
      `,
      sql`INSERT INTO organization_settings (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`,
      sql`INSERT INTO porto_config (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`,
      sql`INSERT INTO whatsapp_config (organization_id) VALUES (${organizationId}) ON CONFLICT DO NOTHING`,
      sql`
        INSERT INTO users (id, organization_id, email, name, password_hash, role)
        VALUES (${adminId}, ${organizationId}, ${adminEmail}, ${adminName}, ${passwordHash}, 'admin')
      `,
      sql`
        INSERT INTO subscriptions (
          organization_id, plan_id, cycle, base_price, extra_technician_price, included_technicians,
          setup_fee, setup_fee_status, grace_days, billing_day, asaas_customer_id, modules
        )
        VALUES (
          ${organizationId}, ${plan.id}, ${quote.cycle}, ${quote.basePrice}, ${plan.extraTechnicianPrice}, ${plan.includedTechnicians},
          ${quote.setupFee}, ${needsPayment ? 'pending' : 'none'}, ${defaultGraceDays}, ${quote.billingDay}, ${customerId},
          ${JSON.stringify(quote.modules)}::jsonb
        )
      `,
      sql`
        INSERT INTO leads (name, company, email, phone, plan_key, cycle, message, origin, status, organization_id, source_hash)
        VALUES (${adminName}, ${company}, ${adminEmail}, ${phone.formatted}, ${plan.key}, ${quote.cycle},
                ${quote.moduleDetails.length ? `Contratou pelo site. Módulos: ${quote.moduleDetails.map((module) => module.name).join(', ')}.` : 'Contratou pelo site.'},
                'contratar', 'won', ${organizationId}, ${sourceHash})
      `,
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') throw new PlatformError('Este endereço ou e-mail acabou de ser usado. Escolha outro.', 409);
    throw error;
  }

  await grantBonusCredits(organizationId, plan.aiBonusCredits);
  await recordAudit({
    organizationId,
    actorId: adminId,
    actorRole: 'admin',
    action: 'organization.self_signup',
    targetType: 'organization',
    targetId: organizationId,
    details: { plan: plan.key, cycle: quote.cycle, billingDay: quote.billingDay, setupFee: quote.setupFee, modules: quote.modules.map((module) => module.key) },
  });
  await autoAssignQuietly(organizationId);

  // Setup fee to pay now; without one, the subscription starts right away (first charge next month).
  if (needsPayment) {
    await createSetupCharge(organizationId, customerId).catch((error) => {
      // The account exists: the welcome page lets the customer generate the charge again.
      console.error('[signup] setup charge failed:', organizationId, error);
    });
  } else {
    await startSubscriptionAfterSetup(organizationId);
  }

  const code = await createLoginHandoff(adminId, organizationId);
  return { organizationId, slug, code };
}

/** What the welcome page shows while the organization isn't released yet. */
export async function getOnboarding(organizationId: string) {
  const [row] = await sql`
    SELECT o.name, o.onboarding_status, o.email, o.phone, s.setup_fee, s.setup_fee_status, s.billing_day, s.cycle,
           s.next_due_date, s.asaas_customer_id, p.name AS plan_name
    FROM organizations o
    LEFT JOIN subscriptions s ON s.organization_id = o.id
    LEFT JOIN plans p ON p.id = s.plan_id
    WHERE o.id = ${organizationId}
  `;
  if (!row) throw new PlatformError('Empresa não encontrada.', 404);

  const [charge] = await sql`
    SELECT status, value, due_date, invoice_url, paid_at FROM billing_charges
    WHERE organization_id = ${organizationId} AND kind = 'setup'
    ORDER BY created_at DESC LIMIT 1
  `;
  return {
    organizationName: String(row.name),
    status: (row.onboarding_status as string | null) ?? 'done',
    planName: (row.plan_name as string | null) ?? null,
    cycle: (row.cycle as string | null) ?? null,
    billingDay: row.billing_day === null ? null : Number(row.billing_day),
    firstDueDate: row.next_due_date ? new Date(row.next_due_date).toISOString().slice(0, 10) : row.billing_day ? nextMonthDueDate(Number(row.billing_day)) : null,
    contact: { email: (row.email as string | null) ?? null, phone: (row.phone as string | null) ?? null },
    setup: {
      fee: Number(row.setup_fee ?? 0),
      paid: row.setup_fee_status === 'paid' || row.setup_fee_status === 'waived' || row.setup_fee_status === 'none',
      charge: charge
        ? {
            status: String(charge.status),
            value: Number(charge.value),
            dueDate: new Date(charge.due_date).toISOString().slice(0, 10),
            invoiceUrl: (charge.invoice_url as string | null) ?? null,
          }
        : null,
    },
  };
}

// The welcome page polls; the gateway is asked at most this often per organization.
const SETUP_CHECK_MS = 20_000;
const lastSetupCheck = new Map<string, number>();

/**
 * Asks the gateway about the setup charge directly, so the payment is noticed even when the webhook
 * is late, lost or unreachable (local development). The webhook path stays the main one.
 */
export async function checkSetupPayment(organizationId: string, force = false) {
  const last = lastSetupCheck.get(organizationId) ?? 0;
  if (!force && Date.now() - last < SETUP_CHECK_MS) return;
  lastSetupCheck.set(organizationId, Date.now());

  const [row] = await sql`
    SELECT o.onboarding_status, s.asaas_setup_payment_id
    FROM organizations o JOIN subscriptions s ON s.organization_id = o.id
    WHERE o.id = ${organizationId}
  `;
  if (row?.onboarding_status !== 'awaiting_payment' || !row.asaas_setup_payment_id) return;
  try {
    await upsertCharge(organizationId, await getPayment(String(row.asaas_setup_payment_id)));
  } catch (error) {
    console.error('[signup] setup payment check failed:', organizationId, error);
  }
}

/** Generates the setup charge again (it failed at signup, or the previous one was canceled). */
export async function retrySetupCharge(organizationId: string) {
  const onboarding = await getOnboarding(organizationId);
  if (onboarding.status !== 'awaiting_payment') throw new PlatformError('O pagamento da implantação já foi confirmado.');
  const active = onboarding.setup.charge && ['PENDING', 'OVERDUE'].includes(onboarding.setup.charge.status);
  if (active) return getOnboarding(organizationId);
  const [row] = await sql`SELECT asaas_customer_id FROM subscriptions WHERE organization_id = ${organizationId}`;
  if (!row?.asaas_customer_id) throw new PlatformError('Fale com o suporte para gerar a cobrança.', 409);
  await createSetupCharge(organizationId, String(row.asaas_customer_id));
  return getOnboarding(organizationId);
}

/** Owner: releases the platform to the organization (end of the onboarding). */
export async function releaseOrganization(organizationId: string, actorId: string) {
  // Released before the setup fee was paid (the owner waived or will collect it another way): the
  // recurring charge still has to exist, starting next month, as the paid path would have done.
  await startSubscriptionAfterSetup(organizationId);
  const rows = await sql`
    UPDATE organizations SET onboarding_status = 'done', updated_at = NOW()
    WHERE id = ${organizationId} AND onboarding_status IS DISTINCT FROM 'done'
    RETURNING id
  `;
  if (!rows[0]) throw new PlatformError('Esta organização já está liberada.');
  await recordAudit({
    organizationId,
    actorId,
    actorRole: 'platform_owner',
    action: 'organization.released',
    targetType: 'organization',
    targetId: organizationId,
  });
}
