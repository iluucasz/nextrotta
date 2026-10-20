import { brasiliaToday } from '../billing/billing';
import { sql } from '../db';
import { calculateSubscriptionValue, type BillingCycle } from '../plans';
import { PlatformError } from './errors';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PAID = `('RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH')`;

/** Defaults to the whole current month (Brasília). */
export function parsePeriod(start: string | null, end: string | null) {
  const today = brasiliaToday();
  const [year, month] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const from = start ?? `${today.slice(0, 7)}-01`;
  const to = end ?? `${today.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) throw new PlatformError('Período inválido.');
  return { from, to };
}

/** Monthly recurring revenue: every active/past-due subscription's value, annual ones divided by 12. */
async function monthlyRecurringRevenue() {
  const rows = await sql`
    SELECT s.cycle, s.base_price, s.extra_technician_price, s.included_technicians, s.discount_percent, s.discount_amount,
      (SELECT COUNT(*)::int FROM technicians t
        WHERE t.organization_id = o.id AND t.deleted_at IS NULL AND t.status = 'active') AS active_technicians
    FROM subscriptions s
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.canceled_at IS NULL AND o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
  `;
  const total = rows.reduce((sum, row) => {
    const { value } = calculateSubscriptionValue(
      {
        cycle: row.cycle as BillingCycle,
        basePrice: Number(row.base_price),
        extraTechnicianPrice: Number(row.extra_technician_price),
        includedTechnicians: Number(row.included_technicians),
        discountPercent: Number(row.discount_percent),
        discountAmount: Number(row.discount_amount),
      },
      Number(row.active_technicians),
    );
    return sum + (row.cycle === 'annual' ? value / 12 : value);
  }, 0);
  return Math.round(total * 100) / 100;
}

export async function getOverview(period: { from: string; to: string }) {
  const today = brasiliaToday();
  const [statusRows, mrr, movement, overdue, revenueByKind, history, forecast, provisioningErrors, alerts, newLeads] = await Promise.all([
    sql`SELECT status, COUNT(*)::int AS total FROM organizations WHERE deleted_at IS NULL GROUP BY status`,
    monthlyRecurringRevenue(),
    sql`
      SELECT
        (SELECT COUNT(*)::int FROM organizations
          WHERE deleted_at IS NULL AND created_at::date BETWEEN ${period.from}::date AND ${period.to}::date) AS created,
        (SELECT COUNT(*)::int FROM organizations
          WHERE deleted_at IS NULL AND status = 'canceled'
            AND status_changed_at::date BETWEEN ${period.from}::date AND ${period.to}::date) AS canceled,
        (SELECT COUNT(*)::int FROM organizations WHERE deleted_at IS NULL AND status <> 'provisioning') AS total
    `,
    sql`
      SELECT COALESCE(SUM(value), 0)::float AS value, COUNT(DISTINCT organization_id)::int AS organizations
      FROM billing_charges WHERE status = 'OVERDUE'
    `,
    sql.query(
      `SELECT kind, COALESCE(SUM(value), 0)::float AS value FROM billing_charges
       WHERE status IN ${PAID} AND paid_at::date BETWEEN $1::date AND $2::date
       GROUP BY kind`,
      [period.from, period.to],
    ),
    sql.query(
      `SELECT to_char(date_trunc('month', paid_at AT TIME ZONE 'America/Sao_Paulo'), 'YYYY-MM') AS month,
              COALESCE(SUM(value), 0)::float AS value
       FROM billing_charges
       WHERE status IN ${PAID} AND paid_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
       GROUP BY 1 ORDER BY 1`,
      [],
    ),
    sql`
      SELECT
        COALESCE(SUM(value) FILTER (WHERE due_date <= ${today}::date + 30), 0)::float AS d30,
        COALESCE(SUM(value) FILTER (WHERE due_date <= ${today}::date + 60), 0)::float AS d60,
        COALESCE(SUM(value) FILTER (WHERE due_date <= ${today}::date + 90), 0)::float AS d90
      FROM billing_charges WHERE status = 'PENDING' AND due_date >= ${today}::date
    `,
    sql`SELECT COUNT(*)::int AS total FROM organization_provisioning WHERE steps @> '[{"status": "error"}]'::jsonb`,
    sql`
      SELECT o.id, o.name, o.status, o.status_reason, c.last_error
      FROM organizations o
      LEFT JOIN porto_config c ON c.organization_id = o.id
      WHERE o.deleted_at IS NULL
        AND (o.status IN ('past_due', 'suspended') OR (c.automation_enabled AND c.last_error IS NOT NULL))
      ORDER BY o.status_changed_at DESC NULLS LAST
      LIMIT 10
    `,
    sql`SELECT COUNT(*)::int AS total FROM leads WHERE status = 'new' AND deleted_at IS NULL`,
  ]);

  // Every month of the last year, including those without revenue.
  const months: Array<{ month: string; value: number }> = [];
  const cursor = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() - 11);
  for (let i = 0; i < 12; i += 1) {
    const key = cursor.toISOString().slice(0, 7);
    months.push({ month: key, value: Number(history.find((row) => row.month === key)?.value ?? 0) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return {
    period,
    organizationsByStatus: Object.fromEntries(statusRows.map((row) => [row.status, Number(row.total)])),
    mrr,
    arr: Math.round(mrr * 12 * 100) / 100,
    newOrganizations: Number(movement[0].created),
    canceledOrganizations: Number(movement[0].canceled),
    totalOrganizations: Number(movement[0].total),
    overdue: { value: Number(overdue[0].value), organizations: Number(overdue[0].organizations) },
    revenueByKind: Object.fromEntries(revenueByKind.map((row) => [row.kind, Number(row.value)])),
    revenueHistory: months,
    forecast: { days30: Number(forecast[0].d30), days60: Number(forecast[0].d60), days90: Number(forecast[0].d90) },
    provisioningErrors: Number(provisioningErrors[0].total),
    newLeads: Number(newLeads[0].total),
    alerts: alerts.map((row) => ({
      organizationId: String(row.id),
      organizationName: String(row.name),
      kind: row.status === 'past_due' ? 'past_due' : row.status === 'suspended' ? 'suspended' : 'porto_error',
      message:
        row.status === 'past_due'
          ? `${row.name} está com pagamento em atraso${row.status_reason ? ` (${row.status_reason})` : ''}.`
          : row.status === 'suspended'
            ? `${row.name} está suspensa${row.status_reason ? `: ${row.status_reason}` : ''}.`
            : `Automação Porto com falha em ${row.name}: ${row.last_error}`,
    })),
  };
}

/** Every organization's charges in the period (by due date), newest first, plus the overdue ones. */
export async function listAllCharges(period: { from: string; to: string }) {
  const today = brasiliaToday();
  return sql`
    SELECT c.id, c.organization_id AS "organizationId", o.name AS "organizationName", c.kind, c.description,
           c.value::float AS value, c.due_date AS "dueDate", c.status, c.invoice_url AS "invoiceUrl", c.paid_at AS "paidAt",
           GREATEST(0, ${today}::date - c.due_date) AS "daysLate"
    FROM billing_charges c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.due_date BETWEEN ${period.from}::date AND ${period.to}::date OR c.status = 'OVERDUE'
    ORDER BY c.due_date DESC, c.created_at DESC
  `;
}
