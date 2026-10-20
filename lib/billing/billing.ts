import { recordAudit } from '../audit';
import { sql } from '../db';
import { calculateSubscriptionValue, type BillingCycle } from '../plans';
import { PlatformError, type Actor } from '../platform/errors';
import {
  AsaasError,
  cancelSubscription,
  createCustomer,
  createPayment,
  createSubscription,
  listCustomerPayments,
  updatePayment,
  updateSubscription,
  type AsaasPayment,
} from './asaas';

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

/** Today in Brasília as YYYY-MM-DD. */
export function brasiliaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateKey: string) {
  const [year, month, day] = dateKey.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function asaasCycle(cycle: BillingCycle) {
  return cycle === 'annual' ? 'YEARLY' : 'MONTHLY';
}

/** The gateway's message reaches the owner as a 4xx instead of a generic 500. */
function asPlatformError(error: unknown): never {
  if (error instanceof AsaasError) throw new PlatformError(`Asaas: ${error.message}`, error.status >= 500 ? 502 : 400);
  throw error;
}

async function loadContext(organizationId: string) {
  const rows = await sql`
    SELECT o.id, o.name, o.legal_name, o.document, o.email, o.phone, o.status, o.status_source,
           s.*, p.name AS plan_name,
           (SELECT COUNT(*)::int FROM technicians t
             WHERE t.organization_id = o.id AND t.deleted_at IS NULL AND t.status = 'active') AS active_technicians
    FROM organizations o
    LEFT JOIN subscriptions s ON s.organization_id = o.id
    LEFT JOIN plans p ON p.id = s.plan_id
    WHERE o.id = ${organizationId} AND o.deleted_at IS NULL
  `;
  if (!rows[0]) throw new PlatformError('Organização não encontrada.', 404);
  return rows[0];
}

function subscriptionValue(context: Record<string, unknown>) {
  return calculateSubscriptionValue(
    {
      cycle: context.cycle as BillingCycle,
      basePrice: Number(context.base_price),
      extraTechnicianPrice: Number(context.extra_technician_price),
      includedTechnicians: Number(context.included_technicians),
      discountPercent: Number(context.discount_percent),
      discountAmount: Number(context.discount_amount),
    },
    Number(context.active_technicians),
  ).value;
}

function subscriptionDescription(context: Record<string, unknown>) {
  return `NextRotta — plano ${context.plan_name} (${context.cycle === 'annual' ? 'anual' : 'mensal'})`;
}

// ---------------------------------------------------------------------------------------------
// Charges mirror
// ---------------------------------------------------------------------------------------------

function chargeKind(payment: AsaasPayment) {
  if (payment.subscription) return 'subscription';
  if (payment.externalReference?.endsWith(':setup')) return 'setup';
  if (payment.externalReference?.includes(':credits:')) return 'credits';
  return 'one_off';
}

/** "<organization>:credits:<package>" → the AI credit package bought. */
function creditPackageId(payment: AsaasPayment) {
  const id = payment.externalReference?.split(':credits:')[1];
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export async function upsertCharge(organizationId: string, payment: AsaasPayment) {
  const paidAt = payment.confirmedDate || payment.paymentDate || payment.clientPaymentDate || null;
  const kind = chargeKind(payment);
  const packageId = kind === 'credits' ? creditPackageId(payment) : null;
  const creditPackage = packageId ? (await sql`SELECT id, name, credits FROM ai_credit_packages WHERE id = ${packageId}`)[0] : null;

  const saved = await sql`
    INSERT INTO billing_charges (
      organization_id, asaas_payment_id, kind, description, value, due_date, status, billing_type, invoice_url, paid_at,
      credit_package_id, credits
    )
    VALUES (
      ${organizationId}, ${payment.id}, ${kind}, ${payment.description ?? null}, ${payment.value}, ${payment.dueDate},
      ${payment.status}, ${payment.billingType ?? null}, ${payment.invoiceUrl ?? null}, ${paidAt},
      ${creditPackage?.id ?? null}, ${creditPackage ? Number(creditPackage.credits) : null}
    )
    ON CONFLICT (asaas_payment_id) DO UPDATE
    SET status = EXCLUDED.status,
        value = EXCLUDED.value,
        due_date = EXCLUDED.due_date,
        description = EXCLUDED.description,
        billing_type = EXCLUDED.billing_type,
        invoice_url = EXCLUDED.invoice_url,
        paid_at = EXCLUDED.paid_at,
        updated_at = NOW()
    RETURNING id, credits
  `;

  // A paid credit package lands in the organization's credit ledger, once per charge.
  if (kind === 'credits' && PAID_STATUSES.includes(payment.status) && saved[0]?.credits) {
    await sql`
      INSERT INTO ai_credit_ledger (organization_id, kind, quantity, charge_id, description)
      VALUES (${organizationId}, 'purchase', ${Number(saved[0].credits)}, ${saved[0].id},
              ${`Compra de créditos${creditPackage ? ` — ${creditPackage.name}` : ''}`})
      ON CONFLICT (charge_id) WHERE charge_id IS NOT NULL DO NOTHING
    `;
  }

  if (kind === 'setup' && PAID_STATUSES.includes(payment.status)) {
    await sql`UPDATE subscriptions SET setup_fee_status = 'paid', updated_at = NOW() WHERE organization_id = ${organizationId}`;
    // Self-service signup: the setup fee paid starts the subscription (first charge next month).
    await startSubscriptionAfterSetup(organizationId);
  }
}

export async function listCharges(organizationId: string) {
  return sql`
    SELECT id, asaas_payment_id AS "paymentId", kind, description, value, due_date AS "dueDate", status,
           billing_type AS "billingType", invoice_url AS "invoiceUrl", paid_at AS "paidAt", created_at AS "createdAt"
    FROM billing_charges
    WHERE organization_id = ${organizationId}
    ORDER BY due_date DESC, created_at DESC
  `;
}

/** Pulls every charge of the organization's customer from the gateway. */
export async function refreshCharges(organizationId: string) {
  const context = await loadContext(organizationId);
  if (!context.asaas_customer_id) return 0;

  const payments = await listCustomerPayments(String(context.asaas_customer_id)).catch(asPlatformError);
  for (const payment of payments) await upsertCharge(organizationId, payment);
  await evaluateBillingStatus(organizationId);
  return payments.length;
}

// ---------------------------------------------------------------------------------------------
// Activation, value updates, cancellation
// ---------------------------------------------------------------------------------------------

/**
 * Starts charging the organization: customer, setup fee (if pending) and the recurring
 * subscription, all due on `firstDueDate`.
 */
export async function activateBilling(organizationId: string, input: { firstDueDate?: string | null }, actor: Actor) {
  const context = await loadContext(organizationId);
  if (!context.plan_id) throw new PlatformError('Escolha um plano antes de ativar a cobrança.');
  if (context.asaas_subscription_id) throw new PlatformError('A cobrança desta organização já está ativa.', 409);

  const today = brasiliaToday();
  const firstDueDate = input.firstDueDate || addDays(today, 7);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate) || firstDueDate < today) {
    throw new PlatformError('Informe um primeiro vencimento a partir de hoje.');
  }

  const value = subscriptionValue(context);
  if (value <= 0) throw new PlatformError('O valor da assinatura está zerado. Defina o preço antes de cobrar.');

  const cpfCnpj = String(context.document ?? '').replace(/\D/g, '');
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    throw new PlatformError('Cadastre o CNPJ (ou CPF) da empresa antes de ativar a cobrança.');
  }

  try {
    let customerId = context.asaas_customer_id as string | null;
    if (!customerId) {
      const customer = await createCustomer({
        name: String(context.legal_name || context.name),
        cpfCnpj,
        email: (context.email as string | null) ?? null,
        mobilePhone: String(context.phone ?? '').replace(/\D/g, '') || null,
        externalReference: organizationId,
      });
      customerId = customer.id;
      await sql`UPDATE subscriptions SET asaas_customer_id = ${customerId}, updated_at = NOW() WHERE organization_id = ${organizationId}`;
    }

    if (context.setup_fee_status === 'pending' && !context.asaas_setup_payment_id && Number(context.setup_fee) > 0) {
      const setup = await createPayment({
        customer: customerId,
        value: Number(context.setup_fee),
        dueDate: firstDueDate,
        description: 'NextRotta — implantação',
        externalReference: `${organizationId}:setup`,
      });
      await sql`UPDATE subscriptions SET asaas_setup_payment_id = ${setup.id}, updated_at = NOW() WHERE organization_id = ${organizationId}`;
      await upsertCharge(organizationId, setup);
    }

    const subscription = await createSubscription({
      customer: customerId,
      value,
      nextDueDate: firstDueDate,
      cycle: asaasCycle(context.cycle as BillingCycle),
      description: subscriptionDescription(context),
      externalReference: organizationId,
    });
    await sql`
      UPDATE subscriptions
      SET asaas_subscription_id = ${subscription.id}, next_due_date = ${firstDueDate}, updated_at = NOW()
      WHERE organization_id = ${organizationId}
    `;
  } catch (error) {
    asPlatformError(error);
  }

  await refreshCharges(organizationId);
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'billing.activated',
    targetType: 'subscription',
    targetId: organizationId,
    details: { firstDueDate, value },
  });
}

// ---------------------------------------------------------------------------------------------
// Self-service signup (the company subscribes from the marketing site)
// ---------------------------------------------------------------------------------------------

/** YYYY-MM-DD for `day` of next month (Brasília): the first monthly charge never falls in the signup month. */
export function nextMonthDueDate(day: number) {
  const [year, month] = brasiliaToday().split('-').map(Number);
  const next = new Date(Date.UTC(year, month, Math.min(Math.max(day, 1), 28)));
  return next.toISOString().slice(0, 10);
}

/** The setup-fee charge of a self-service signup (due in 3 days; Pix, boleto or card). */
export async function createSetupCharge(organizationId: string, customerId: string) {
  const context = await loadContext(organizationId);
  const value = Number(context.setup_fee);
  if (value <= 0) return null;
  const payment = await createPayment({
    customer: customerId,
    value,
    dueDate: addDays(brasiliaToday(), 3),
    description: 'NextRotta — implantação',
    externalReference: `${organizationId}:setup`,
  }).catch(asPlatformError);
  await sql`UPDATE subscriptions SET asaas_setup_payment_id = ${payment.id}, updated_at = NOW() WHERE organization_id = ${organizationId}`;
  await upsertCharge(organizationId, payment);
  return payment;
}

/**
 * After a self-service organization pays (or doesn't need to pay) the setup fee: creates the
 * recurring subscription with its first charge next month, on the day the customer chose, and
 * moves the organization to "setup" (the owner configures it, then releases it). Idempotent.
 */
export async function startSubscriptionAfterSetup(organizationId: string) {
  const [organization] = await sql`SELECT onboarding_status FROM organizations WHERE id = ${organizationId}`;
  if (organization?.onboarding_status !== 'awaiting_payment') return;

  const context = await loadContext(organizationId);
  if (!context.asaas_subscription_id && context.asaas_customer_id) {
    const nextDueDate = nextMonthDueDate(Number(context.billing_day ?? 10));
    const subscription = await createSubscription({
      customer: String(context.asaas_customer_id),
      value: subscriptionValue(context),
      nextDueDate,
      cycle: asaasCycle(context.cycle as BillingCycle),
      description: subscriptionDescription(context),
      externalReference: organizationId,
    }).catch(asPlatformError);
    // The gateway generates the first charge right away and answers with the one after it as
    // `nextDueDate`: the next charge the customer actually faces is the first one.
    await sql`
      UPDATE subscriptions
      SET asaas_subscription_id = ${subscription.id}, next_due_date = ${nextDueDate}, updated_at = NOW()
      WHERE organization_id = ${organizationId}
    `;
  }

  await sql`UPDATE organizations SET onboarding_status = 'setup', updated_at = NOW() WHERE id = ${organizationId} AND onboarding_status = 'awaiting_payment'`;
  await recordAudit({ organizationId, actorId: null, actorRole: 'system', action: 'organization.setup_paid', targetType: 'organization', targetId: organizationId });
  // Mirror the first recurring charge now (after leaving awaiting_payment, so this can't re-enter).
  await refreshCharges(organizationId).catch((error) => console.error('[billing] refresh after setup failed:', organizationId, error));
}

/**
 * The organization's admin buys an AI credit package: a one-off charge in the gateway; the credits
 * arrive when it's paid (webhook). Needs billing active (a gateway customer).
 */
export async function buyCreditPackage(organizationId: string, packageId: string, userId: string) {
  const context = await loadContext(organizationId);
  if (!context.asaas_customer_id) {
    throw new PlatformError('A cobrança da sua assinatura ainda não foi ativada. Fale com o suporte para comprar créditos.');
  }
  const rows = await sql`SELECT * FROM ai_credit_packages WHERE id = ${packageId} AND archived_at IS NULL`;
  const creditPackage = rows[0];
  if (!creditPackage) throw new PlatformError('Pacote de créditos indisponível.', 404);

  const payment = await createPayment({
    customer: String(context.asaas_customer_id),
    value: Number(creditPackage.price),
    dueDate: addDays(brasiliaToday(), 3),
    description: `NextRotta — ${creditPackage.name} (${creditPackage.credits} créditos de IA)`,
    externalReference: `${organizationId}:credits:${creditPackage.id}`,
  }).catch(asPlatformError);
  await upsertCharge(organizationId, payment);

  await recordAudit({
    organizationId,
    actorId: userId,
    actorRole: 'admin',
    action: 'ai_credits.purchase_requested',
    targetType: 'ai_credit_package',
    targetId: String(creditPackage.id),
    details: { name: creditPackage.name, credits: creditPackage.credits, value: Number(creditPackage.price) },
  });
  return { invoiceUrl: payment.invoiceUrl ?? null };
}

/**
 * Pushes the current value (and cycle) to the gateway — after technicians come and go, or the plan,
 * cycle or discounts change. Pending charges are updated too. No-op without an active subscription.
 */
export async function syncSubscriptionValue(organizationId: string) {
  const context = await loadContext(organizationId);
  if (!context.asaas_subscription_id) return null;

  const value = subscriptionValue(context);
  await updateSubscription(String(context.asaas_subscription_id), {
    value,
    cycle: asaasCycle(context.cycle as BillingCycle),
    description: subscriptionDescription(context),
  }).catch(asPlatformError);
  return value;
}

/**
 * After an upgrade: the new value only reaches charges due from next month on. Charges due this
 * month keep the old value; the subscription and the pending charges of later months get the new
 * one. Returns the due date of the first charge with the new value (null without billing).
 */
export async function applyNewValueFromNextMonth(organizationId: string) {
  const context = await loadContext(organizationId);
  if (!context.asaas_subscription_id) return null;

  const value = subscriptionValue(context);
  await updateSubscription(String(context.asaas_subscription_id), {
    value,
    cycle: asaasCycle(context.cycle as BillingCycle),
    description: subscriptionDescription(context),
    updatePendingPayments: false,
  }).catch(asPlatformError);

  await refreshCharges(organizationId);
  const nextMonthStart = `${nextMonthDueDate(1).slice(0, 7)}-01`;
  const pending = await sql`
    SELECT asaas_payment_id FROM billing_charges
    WHERE organization_id = ${organizationId} AND kind = 'subscription' AND status = 'PENDING' AND due_date >= ${nextMonthStart}
  `;
  for (const charge of pending) {
    const payment = await updatePayment(String(charge.asaas_payment_id), { value, description: subscriptionDescription(context) }).catch(asPlatformError);
    await upsertCharge(organizationId, payment);
  }

  const [first] = await sql`
    SELECT due_date::text AS due FROM billing_charges
    WHERE organization_id = ${organizationId} AND kind = 'subscription' AND status = 'PENDING' AND due_date >= ${nextMonthStart}
    ORDER BY due_date LIMIT 1
  `;
  return first ? String(first.due) : null;
}

/** Fire-and-forget variant for request handlers: a gateway hiccup must not fail the user's action. */
export async function syncSubscriptionValueQuietly(organizationId: string) {
  try {
    await syncSubscriptionValue(organizationId);
  } catch (error) {
    console.error('[billing] subscription value sync failed:', organizationId, error);
  }
}

/** Stops future charges in the gateway. The plan and the charge history stay. */
export async function cancelBilling(organizationId: string, actor: Actor) {
  const context = await loadContext(organizationId);
  if (!context.asaas_subscription_id) return;

  await cancelSubscription(String(context.asaas_subscription_id)).catch(asPlatformError);
  await sql`
    UPDATE subscriptions SET asaas_subscription_id = NULL, next_due_date = NULL, updated_at = NOW()
    WHERE organization_id = ${organizationId}
  `;
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'billing.canceled',
    targetType: 'subscription',
    targetId: organizationId,
    details: { asaasSubscriptionId: context.asaas_subscription_id },
  });
}

// ---------------------------------------------------------------------------------------------
// Delinquency
// ---------------------------------------------------------------------------------------------

/**
 * Moves the organization between active and past due from its charges. Billing only undoes what
 * billing did: a suspension applied by the owner is never lifted by a payment.
 */
export async function evaluateBillingStatus(organizationId: string) {
  const [organization] = await sql`SELECT status, status_source FROM organizations WHERE id = ${organizationId}`;
  if (!organization) return;

  const [overdue] = await sql`
    SELECT COUNT(*)::int AS total, MIN(due_date) AS oldest
    FROM billing_charges WHERE organization_id = ${organizationId} AND status = 'OVERDUE'
  `;
  const hasOverdue = Number(overdue.total) > 0;

  if (hasOverdue && organization.status === 'active') {
    const oldest = new Date(overdue.oldest).toISOString().slice(0, 10);
    await sql`
      UPDATE organizations
      SET status = 'past_due', status_source = 'billing', status_reason = ${`Cobrança vencida em ${formatDate(oldest)}`},
          status_changed_at = NOW(), updated_at = NOW()
      WHERE id = ${organizationId}
    `;
    await recordAudit({ organizationId, actorId: null, actorRole: 'system', action: 'organization.past_due' });
    return;
  }

  const billingHold =
    organization.status === 'past_due' || (organization.status === 'suspended' && organization.status_source === 'billing');
  if (!hasOverdue && billingHold) {
    await sql`
      UPDATE organizations
      SET status = 'active', status_source = 'billing', status_reason = NULL, status_changed_at = NOW(), updated_at = NOW()
      WHERE id = ${organizationId}
    `;
    await recordAudit({ organizationId, actorId: null, actorRole: 'system', action: 'organization.billing_regularized' });
  }
}

/**
 * Daily: suspends (read-only) every past-due organization whose oldest overdue charge is older than
 * its grace period. Returns the suspended organizations.
 */
export async function runBillingMaintenance() {
  const today = brasiliaToday();
  const rows = await sql`
    SELECT o.id, MIN(c.due_date) AS oldest
    FROM organizations o
    JOIN subscriptions s ON s.organization_id = o.id
    JOIN billing_charges c ON c.organization_id = o.id AND c.status = 'OVERDUE'
    WHERE o.status = 'past_due' AND o.deleted_at IS NULL
    GROUP BY o.id, s.grace_days
    HAVING MIN(c.due_date) + s.grace_days < ${today}::date
  `;

  for (const row of rows) {
    const oldest = new Date(row.oldest).toISOString().slice(0, 10);
    await sql`
      UPDATE organizations
      SET status = 'suspended', status_source = 'billing',
          status_reason = ${`Inadimplência: cobrança vencida desde ${formatDate(oldest)}`},
          status_changed_at = NOW(), updated_at = NOW()
      WHERE id = ${row.id} AND status = 'past_due'
    `;
    await recordAudit({
      organizationId: String(row.id),
      actorId: null,
      actorRole: 'system',
      action: 'organization.suspended_for_nonpayment',
      details: { oldestOverdue: oldest },
    });
  }

  return rows.map((row) => String(row.id));
}

// ---------------------------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------------------------

async function findOrganizationForPayment(payment: AsaasPayment) {
  if (payment.subscription) {
    const rows = await sql`SELECT organization_id FROM subscriptions WHERE asaas_subscription_id = ${payment.subscription}`;
    if (rows[0]) return String(rows[0].organization_id);
  }

  const reference = payment.externalReference?.split(':')[0];
  if (reference && /^[0-9a-f-]{36}$/i.test(reference)) {
    const rows = await sql`SELECT id FROM organizations WHERE id = ${reference}`;
    if (rows[0]) return String(rows[0].id);
  }

  const rows = await sql`SELECT organization_id FROM subscriptions WHERE asaas_customer_id = ${payment.customer}`;
  return rows[0] ? String(rows[0].organization_id) : null;
}

/**
 * Processes one gateway event at most once (keyed by its id); a delivery whose processing failed
 * is retried on the next delivery. Payment events update the charge
 * mirror and then the organization's billing status.
 */
export async function handleAsaasEvent(event: { id?: string; event?: string; payment?: AsaasPayment }) {
  const eventId = event.id || `${event.event}:${event.payment?.id}:${event.payment?.status}`;
  const inserted = await sql`
    INSERT INTO billing_webhook_events (id, event, payment_id, payload)
    VALUES (${eventId}, ${event.event ?? 'unknown'}, ${event.payment?.id ?? null}, ${JSON.stringify(event)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, error = NULL
      WHERE billing_webhook_events.processed_at IS NULL
    RETURNING id
  `;
  // Nothing returned: this event was already processed successfully.
  if (!inserted[0]) return { duplicate: true };

  try {
    if (event.payment && event.event?.startsWith('PAYMENT_')) {
      const organizationId = await findOrganizationForPayment(event.payment);
      if (organizationId) {
        await upsertCharge(organizationId, event.payment);
        await evaluateBillingStatus(organizationId);
      }
    }
    await sql`UPDATE billing_webhook_events SET processed_at = NOW() WHERE id = ${eventId}`;
    return { duplicate: false };
  } catch (error) {
    await sql`
      UPDATE billing_webhook_events SET error = ${error instanceof Error ? error.message : String(error)} WHERE id = ${eventId}
    `;
    throw error;
  }
}
