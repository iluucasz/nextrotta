import { recordAudit } from '../audit';
import { sql } from '../db';
import { splitSetupFee } from '../plans';
import { PlatformError } from '../platform/errors';
import { getSubscription } from '../platform/plans';
import { brasiliaToday, nextMonthDueDate } from './billing';

/**
 * Test companies (is_test) have a payment dashboard like any other, but nothing goes to the gateway:
 * the instalments are made here, marked paid by hand and can be undone. They exist only to debug the screens.
 */
export const SIMULATED = 'SIMULATED';
const PAID = 'RECEIVED';

function addMonths(dateKey: string, months: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, 28))).toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The instalments a company would face: the setup fee in parcels, then the recurring charges (pure; tested). */
export function simulatedSchedule(input: { today: string; billingDay: number; value: number; cycle: 'monthly' | 'annual'; setupFee: number; setupInstallments: number }) {
  const firstRecurring = nextMonthDueDate(input.billingDay);
  const rows: Array<{ kind: 'setup' | 'subscription'; description: string; value: number; dueDate: string }> = [];

  if (input.setupFee > 0) {
    const count = Math.max(1, input.setupInstallments);
    splitSetupFee(input.setupFee, count).forEach((value, index) => {
      rows.push({
        kind: 'setup',
        description: count > 1 ? `NextRotta — implantação (parcela ${index + 1} de ${count})` : 'NextRotta — implantação',
        value,
        dueDate: index === 0 ? addDays(input.today, 3) : addMonths(firstRecurring, index - 1),
      });
    });
  }

  const recurring = input.cycle === 'annual' ? 3 : 12;
  for (let index = 0; index < recurring; index += 1) {
    rows.push({
      kind: 'subscription',
      description: input.cycle === 'annual' ? 'NextRotta — anuidade' : 'NextRotta — mensalidade',
      value: input.value,
      dueDate: addMonths(firstRecurring, index * (input.cycle === 'annual' ? 12 : 1)),
    });
  }
  return rows;
}

export async function isTestOrganization(organizationId: string) {
  const [row] = await sql`SELECT is_test FROM organizations WHERE id = ${organizationId} AND deleted_at IS NULL`;
  return Boolean(row?.is_test);
}

/** Makes the simulated instalments of a test company once (idempotent). */
export async function ensureSimulatedSchedule(organizationId: string) {
  if (!(await isTestOrganization(organizationId))) return;
  const [existing] = await sql`SELECT 1 FROM billing_charges WHERE organization_id = ${organizationId} AND billing_type = ${SIMULATED} LIMIT 1`;
  if (existing) return;

  const subscription = await getSubscription(organizationId);
  if (!subscription) return;
  const [row] = await sql`SELECT billing_day FROM subscriptions WHERE organization_id = ${organizationId}`;
  const schedule = simulatedSchedule({
    today: brasiliaToday(),
    billingDay: Number(row?.billing_day ?? 10),
    value: subscription.value,
    cycle: subscription.cycle,
    setupFee: subscription.setupFee,
    setupInstallments: subscription.setupInstallments,
  });

  for (const [index, charge] of schedule.entries()) {
    await sql`
      INSERT INTO billing_charges (organization_id, asaas_payment_id, kind, description, value, due_date, status, billing_type)
      VALUES (${organizationId}, ${`sim_${organizationId}_${index}`}, ${charge.kind}, ${charge.description}, ${charge.value}, ${charge.dueDate}, 'PENDING', ${SIMULATED})
      ON CONFLICT (asaas_payment_id) DO NOTHING
    `;
  }
  if (subscription.setupFee > 0 && subscription.setupFeeStatus === 'none') {
    await sql`UPDATE subscriptions SET setup_fee_status = 'pending', updated_at = NOW() WHERE organization_id = ${organizationId}`;
  }
}

/** Marks one simulated instalment as paid, or puts it back to pending. Only test companies, only simulated charges. */
export async function setSimulatedPayment(organizationId: string, chargeId: string, paid: boolean, actorId: string | null) {
  if (!(await isTestOrganization(organizationId))) throw new PlatformError('O pagamento simulado só existe em conta de teste.', 409);
  const [charge] = await sql`
    SELECT id, kind, status FROM billing_charges
    WHERE id = ${chargeId} AND organization_id = ${organizationId} AND billing_type = ${SIMULATED}
  `;
  if (!charge) throw new PlatformError('Cobrança não encontrada.', 404);

  if (paid) {
    await sql`UPDATE billing_charges SET status = ${PAID}, paid_at = NOW(), updated_at = NOW() WHERE id = ${chargeId}`;
  } else {
    await sql`UPDATE billing_charges SET status = 'PENDING', paid_at = NULL, updated_at = NOW() WHERE id = ${chargeId}`;
  }

  // The setup fee is "paid" when every parcel is; undoing one brings it back to pending.
  if (charge.kind === 'setup') {
    const [open] = await sql`SELECT 1 FROM billing_charges WHERE organization_id = ${organizationId} AND kind = 'setup' AND billing_type = ${SIMULATED} AND status <> ${PAID} LIMIT 1`;
    await sql`UPDATE subscriptions SET setup_fee_status = ${open ? 'pending' : 'paid'}, updated_at = NOW() WHERE organization_id = ${organizationId}`;
  }

  await recordAudit({
    organizationId,
    actorId,
    actorRole: 'admin',
    action: paid ? 'billing.simulated_paid' : 'billing.simulated_undone',
    targetType: 'billing_charge',
    targetId: chargeId,
  });
}

/**
 * The owner "makes a link" in a test company: a simulated charge (setup or one-off) is made, with no link and nothing sent to the gateway;
 * the company pays it (simulated) in its Assinatura. Setup defaults to what is still missing of the fee.
 */
export async function createSimulatedCharge(
  organizationId: string,
  input: { kind: 'setup' | 'one_off'; value?: number | null; dueDate?: string | null; description?: string | null },
  actorId: string | null,
) {
  if (!(await isTestOrganization(organizationId))) throw new PlatformError('A cobrança simulada só existe em conta de teste.', 409);
  await ensureSimulatedSchedule(organizationId);

  const today = brasiliaToday();
  const dueDate = input.dueDate || addDays(today, 3);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today) throw new PlatformError('Informe um vencimento a partir de hoje.');

  let value = Number(input.value ?? 0);
  let description = String(input.description ?? '').trim();
  if (input.kind === 'setup') {
    const subscription = await getSubscription(organizationId);
    const [charged] = await sql`
      SELECT COALESCE(SUM(value), 0)::float AS total FROM billing_charges
      WHERE organization_id = ${organizationId} AND kind = 'setup' AND status NOT IN ('DELETED', 'CANCELED', 'REFUNDED')
    `;
    if (!(value > 0)) value = Math.round(((subscription?.setupFee ?? 0) - Number(charged.total)) * 100) / 100;
    if (!(value > 0)) throw new PlatformError('A implantação já está toda cobrada. Informe um valor se quiser outra cobrança.');
    description ||= 'NextRotta — implantação';
  } else {
    if (!(value > 0)) throw new PlatformError('Informe o valor da cobrança.');
    description ||= 'NextRotta — cobrança avulsa';
  }
  if (value > 1_000_000) throw new PlatformError('Valor alto demais. Confira.');

  const id = `sim_${organizationId}_${Date.now()}`;
  await sql`
    INSERT INTO billing_charges (organization_id, asaas_payment_id, kind, description, value, due_date, status, billing_type)
    VALUES (${organizationId}, ${id}, ${input.kind}, ${description}, ${value}, ${dueDate}, 'PENDING', ${SIMULATED})
  `;
  if (input.kind === 'setup') {
    await sql`UPDATE subscriptions SET setup_fee_status = 'pending', updated_at = NOW() WHERE organization_id = ${organizationId} AND setup_fee_status IN ('none', 'paid')`;
  }
  await recordAudit({ organizationId, actorId, actorRole: 'platform_owner', action: 'billing.simulated_charge_created', targetType: 'billing_charge', targetId: id, details: { kind: input.kind, value, dueDate } });
  return { invoiceUrl: null, value, dueDate, simulated: true };
}
