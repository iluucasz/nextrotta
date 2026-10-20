import { sql } from '../db';
import { money } from './common';

/** Numbers of the admin's "Visão geral" of Controle de Peças, for one month (YYYY-MM). */
export async function partsOverview(organizationId: string, month: string) {
  const [stock, sales, account, lowStock, pending] = await Promise.all([
    sql`
      SELECT
        COALESCE(SUM(s.quantity) FILTER (WHERE s.technician_id IS NULL), 0)::int AS central_units,
        COALESCE(SUM(s.quantity * p.cost_price) FILTER (WHERE s.technician_id IS NULL), 0) AS central_cost,
        COALESCE(SUM(s.quantity) FILTER (WHERE s.technician_id IS NOT NULL), 0)::int AS technician_units,
        COALESCE(SUM(s.quantity * p.cost_price) FILTER (WHERE s.technician_id IS NOT NULL), 0) AS technician_cost,
        COALESCE(SUM(s.quantity * p.technician_price) FILTER (WHERE s.technician_id IS NOT NULL), 0) AS technician_value
      FROM (
        SELECT part_id, technician_id, SUM(quantity) AS quantity FROM part_movements
        WHERE organization_id = ${organizationId} GROUP BY part_id, technician_id
      ) s JOIN parts p ON p.id = s.part_id
    `,
    sql`
      SELECT COUNT(*)::int AS count,
        COALESCE(SUM(total_amount), 0) AS sold,
        COALESCE(SUM(total_technician_price), 0) AS owed,
        COALESCE(SUM(total_cost), 0) AS cost
      FROM part_sales
      WHERE organization_id = ${organizationId} AND status <> 'canceled'
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${month}
    `,
    sql`
      SELECT COALESCE(SUM(amount) FILTER (WHERE due_month <= ${month}), 0) AS due,
        COALESCE(-SUM(amount) FILTER (WHERE due_month = ${month} AND kind = 'payment'), 0) AS paid
      FROM part_account_entries WHERE organization_id = ${organizationId}
    `,
    sql`
      SELECT COUNT(*)::int AS count FROM parts p
      WHERE p.organization_id = ${organizationId} AND p.deleted_at IS NULL AND p.active AND p.min_stock IS NOT NULL
        AND COALESCE((SELECT SUM(quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NULL), 0) <= p.min_stock
    `,
    sql`SELECT COUNT(*)::int AS count FROM part_sales WHERE organization_id = ${organizationId} AND status = 'awaiting_payment'`,
  ]);

  return {
    month,
    centralUnits: Number(stock[0].central_units),
    centralCost: money(stock[0].central_cost),
    technicianUnits: Number(stock[0].technician_units),
    technicianCost: money(stock[0].technician_cost),
    technicianValue: money(stock[0].technician_value),
    salesCount: Number(sales[0].count),
    salesTotal: money(sales[0].sold),
    salesOwed: money(sales[0].owed),
    salesCost: money(sales[0].cost),
    /** What the organization earns on the month's sales: technician price − cost. */
    salesMargin: money(Number(sales[0].owed) - Number(sales[0].cost)),
    balanceDue: money(account[0].due),
    paidInMonth: money(account[0].paid),
    lowStockParts: Number(lowStock[0].count),
    awaitingPayment: Number(pending[0].count),
  };
}
