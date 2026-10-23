import { sql } from '../db';
import { currentMonth, isMonthKey, isUuid, money } from './common';
import { addMonths } from './types';

/**
 * Financial view of Venda de Peças, for the organization.
 *
 * Criteria (also in docs/controle-de-pecas.md):
 * - Sales count by the month they were made (Brasília time) and leave out canceled ones.
 * - "Faturamento" is what the technicians owe the organization (their price), "vendido" is what the customers paid.
 * - "Custo" is the cost of the parts sold, copied into each sale item when it was made.
 * - "Recebido" is cash: payments registered in the technicians' accounts, by the day they were registered.
 * - "Compras" is cash out: units bought into the central stock × their unit cost.
 * - "Perdas" are the inventory shortages the organization absorbs (central stock, or technician shortages it
 *   chose not to charge), at the part's current cost.
 * - The open balance and the stock are positions (a photo), not period flows.
 * - Filtering by technicians narrows sales, payments, losses, balance and the technicians' stock. Purchases
 *   and the central stock belong to the whole company, so they drop out of a filtered view.
 */

export type FinanceMode = 'month' | 'year';

interface Flow {
  sales: number;
  units: number;
  sold: number;
  revenue: number;
  cost: number;
  received: number;
  purchases: number;
  losses: number;
}

const emptyFlow = (): Flow => ({ sales: 0, units: 0, sold: 0, revenue: 0, cost: 0, received: 0, purchases: 0, losses: 0 });

function monthsBetween(from: string, to: string) {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

function periodOf(mode: FinanceMode, value: string) {
  if (mode === 'year') {
    const year = Number(value);
    return { from: `${year}-01`, to: `${year}-12`, previous: { from: `${year - 1}-01`, to: `${year - 1}-12` }, series: { from: `${year}-01`, to: `${year}-12` } };
  }
  return { from: value, to: value, previous: { from: addMonths(value, -1), to: addMonths(value, -1) }, series: { from: addMonths(value, -11), to: value } };
}

function sumFlows(byMonth: Map<string, Flow>, from: string, to: string) {
  const total = emptyFlow();
  for (const month of monthsBetween(from, to)) {
    const flow = byMonth.get(month);
    if (!flow) continue;
    for (const key of Object.keys(total) as Array<keyof Flow>) total[key] += flow[key];
  }
  return total;
}

function derived(flow: Flow) {
  const profit = flow.revenue - flow.cost;
  return {
    sales: flow.sales,
    units: flow.units,
    sold: money(flow.sold),
    revenue: money(flow.revenue),
    cost: money(flow.cost),
    profit: money(profit),
    margin: flow.revenue > 0 ? profit / flow.revenue : null,
    technicianGain: money(flow.sold - flow.revenue),
    averageTicket: flow.sales > 0 ? money(flow.sold / flow.sales) : 0,
    received: money(flow.received),
    purchases: money(flow.purchases),
    cashResult: money(flow.received - flow.purchases),
    losses: money(flow.losses),
    /** Gross profit minus what the organization lost on missing parts. */
    netResult: money(profit - flow.losses),
  };
}

function parseIds(value: unknown) {
  if (typeof value !== 'string') return null;
  const ids = value
    .split(',')
    .map((item) => item.trim())
    .filter(isUuid)
    .slice(0, 100);
  return ids.length ? ids : null;
}

export async function partsFinance(organizationId: string, input: { mode?: unknown; month?: unknown; year?: unknown; technicianIds?: unknown }) {
  const mode: FinanceMode = input.mode === 'year' ? 'year' : 'month';
  const now = currentMonth();
  const value =
    mode === 'year'
      ? /^\d{4}$/.test(String(input.year)) ? String(input.year) : now.slice(0, 4)
      : isMonthKey(input.month) ? input.month : now;
  const period = periodOf(mode, value);
  const ids = parseIds(input.technicianIds);

  const start = [period.previous.from, period.series.from].sort()[0];
  const end = period.to;
  // The open balance is as of the end of the period, but never counts installments of months still to come.
  const asOf = period.to < now ? period.to : now;

  const [salesRows, unitRows, paymentRows, purchaseRows, lossRows, technicianRows, partRows, recentRows, stockRows, awaitingRows] = await Promise.all([
    sql`
      SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COUNT(*)::int AS sales, COALESCE(SUM(total_amount), 0) AS sold,
        COALESCE(SUM(total_technician_price), 0) AS revenue, COALESCE(SUM(total_cost), 0) AS cost
      FROM part_sales
      WHERE organization_id = ${organizationId} AND status <> 'canceled'
        AND (${ids}::uuid[] IS NULL OR technician_id = ANY(${ids}::uuid[]))
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      SELECT to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month, COALESCE(SUM(i.quantity), 0)::int AS units
      FROM part_sale_items i JOIN part_sales s ON s.id = i.sale_id
      WHERE s.organization_id = ${organizationId} AND s.status <> 'canceled'
        AND (${ids}::uuid[] IS NULL OR s.technician_id = ANY(${ids}::uuid[]))
        AND to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      SELECT to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(payment_method, 'other') AS method, COALESCE(-SUM(amount), 0) AS amount
      FROM part_account_entries
      WHERE organization_id = ${organizationId} AND kind = 'payment'
        AND (${ids}::uuid[] IS NULL OR technician_id = ANY(${ids}::uuid[]))
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1, 2
    `,
    sql`
      SELECT to_char(m.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(SUM(m.quantity * COALESCE(m.unit_cost, p.cost_price)), 0) AS amount
      FROM part_movements m JOIN parts p ON p.id = m.part_id
      WHERE m.organization_id = ${organizationId} AND m.kind = 'purchase' AND ${ids}::uuid[] IS NULL
        AND to_char(m.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      SELECT to_char(i.closed_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') AS month,
        COALESCE(SUM(GREATEST(ii.expected - ii.counted, 0) * p.cost_price), 0) AS amount
      FROM part_inventory_items ii
      JOIN part_inventories i ON i.id = ii.inventory_id
      JOIN parts p ON p.id = ii.part_id
      WHERE i.organization_id = ${organizationId} AND i.status = 'closed' AND (i.technician_id IS NULL OR ii.resolution = 'absorb')
        AND (${ids}::uuid[] IS NULL OR i.technician_id = ANY(${ids}::uuid[]))
        AND to_char(i.closed_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${start} AND ${end}
      GROUP BY 1
    `,
    sql`
      WITH sales AS (
        SELECT technician_id, COUNT(*)::int AS sales, SUM(total_technician_price) AS revenue, SUM(total_amount) AS sold, SUM(total_cost) AS cost
        FROM part_sales
        WHERE organization_id = ${organizationId} AND status <> 'canceled'
          AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
        GROUP BY technician_id
      ), pay AS (
        SELECT technician_id, -SUM(amount) AS received
        FROM part_account_entries
        WHERE organization_id = ${organizationId} AND kind = 'payment'
          AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
        GROUP BY technician_id
      ), bal AS (
        SELECT technician_id, SUM(amount) AS due FROM part_account_entries WHERE organization_id = ${organizationId} AND due_month <= ${asOf} GROUP BY technician_id
      )
      SELECT t.id::text AS id, t.name, COALESCE(sales.sales, 0) AS sales_count,
        COALESCE(sales.revenue, 0) AS revenue, COALESCE(sales.sold, 0) AS sold, COALESCE(sales.cost, 0) AS cost,
        COALESCE(pay.received, 0) AS received, COALESCE(bal.due, 0) AS due
      FROM technicians t
      LEFT JOIN sales ON sales.technician_id = t.id
      LEFT JOIN pay ON pay.technician_id = t.id
      LEFT JOIN bal ON bal.technician_id = t.id
      WHERE t.organization_id = ${organizationId}
        AND (sales.technician_id IS NOT NULL OR pay.technician_id IS NOT NULL OR COALESCE(bal.due, 0) <> 0)
        AND (${ids}::uuid[] IS NULL OR t.id = ANY(${ids}::uuid[]))
      ORDER BY COALESCE(sales.revenue, 0) DESC, t.name
    `,
    sql`
      SELECT i.part_id::text AS id, MAX(i.part_name) AS name, SUM(i.quantity)::int AS units,
        SUM(i.quantity * i.unit_technician_price) AS revenue,
        SUM(i.quantity * i.unit_cost) AS cost,
        SUM(i.quantity * (i.unit_technician_price - i.unit_cost)) AS profit
      FROM part_sale_items i JOIN part_sales s ON s.id = i.sale_id
      WHERE s.organization_id = ${organizationId} AND s.status <> 'canceled'
        AND (${ids}::uuid[] IS NULL OR s.technician_id = ANY(${ids}::uuid[]))
        AND to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
      GROUP BY i.part_id
      ORDER BY profit DESC
      LIMIT 200
    `,
    sql`
      SELECT e.id::text AS id, t.name, -e.amount AS amount, COALESCE(e.payment_method, 'other') AS method, e.created_at, e.description
      FROM part_account_entries e LEFT JOIN technicians t ON t.id = e.technician_id
      WHERE e.organization_id = ${organizationId} AND e.kind = 'payment'
        AND (${ids}::uuid[] IS NULL OR e.technician_id = ANY(${ids}::uuid[]))
        AND to_char(e.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') BETWEEN ${period.from} AND ${period.to}
      ORDER BY e.created_at DESC
      LIMIT 15
    `,
    sql`
      SELECT
        COALESCE(SUM(s.quantity) FILTER (WHERE s.technician_id IS NULL), 0)::int AS central_units,
        COALESCE(SUM(s.quantity * p.cost_price) FILTER (WHERE s.technician_id IS NULL), 0) AS central_cost,
        COALESCE(SUM(s.quantity) FILTER (WHERE s.technician_id IS NOT NULL AND (${ids}::uuid[] IS NULL OR s.technician_id = ANY(${ids}::uuid[]))), 0)::int AS technician_units,
        COALESCE(SUM(s.quantity * p.cost_price) FILTER (WHERE s.technician_id IS NOT NULL AND (${ids}::uuid[] IS NULL OR s.technician_id = ANY(${ids}::uuid[]))), 0) AS technician_cost,
        COALESCE(SUM(s.quantity * p.technician_price) FILTER (WHERE s.technician_id IS NOT NULL AND (${ids}::uuid[] IS NULL OR s.technician_id = ANY(${ids}::uuid[]))), 0) AS technician_value
      FROM (
        SELECT part_id, technician_id, SUM(quantity) AS quantity FROM part_movements
        WHERE organization_id = ${organizationId} GROUP BY part_id, technician_id
      ) s JOIN parts p ON p.id = s.part_id
    `,
    sql`
      SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0) AS amount
      FROM part_sales
      WHERE organization_id = ${organizationId} AND status = 'awaiting_payment' AND (${ids}::uuid[] IS NULL OR technician_id = ANY(${ids}::uuid[]))
    `,
  ]);

  const byMonth = new Map<string, Flow>();
  const flowOf = (month: string) => {
    let flow = byMonth.get(month);
    if (!flow) byMonth.set(month, (flow = emptyFlow()));
    return flow;
  };
  for (const row of salesRows) {
    const flow = flowOf(String(row.month));
    flow.sales += Number(row.sales);
    flow.sold += Number(row.sold);
    flow.revenue += Number(row.revenue);
    flow.cost += Number(row.cost);
  }
  for (const row of unitRows) flowOf(String(row.month)).units += Number(row.units);
  for (const row of paymentRows) flowOf(String(row.month)).received += Number(row.amount);
  for (const row of purchaseRows) flowOf(String(row.month)).purchases += Number(row.amount);
  for (const row of lossRows) flowOf(String(row.month)).losses += Number(row.amount);

  // How the organization was paid in the period: Pix, cash, transfer, and everything else together.
  const methodTotals = new Map<string, number>();
  for (const row of paymentRows) {
    const month = String(row.month);
    if (month < period.from || month > period.to) continue;
    methodTotals.set(normalizeMethod(row.method), (methodTotals.get(normalizeMethod(row.method)) ?? 0) + Number(row.amount));
  }

  const technicians = technicianRows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sales: Number(row.sales_count),
    revenue: money(row.revenue),
    sold: money(row.sold),
    profit: money(Number(row.revenue) - Number(row.cost)),
    received: money(row.received),
    balanceDue: money(row.due),
  }));
  const stock = stockRows[0];

  return {
    mode,
    value,
    filtered: ids !== null,
    generatedAt: new Date().toISOString(),
    period: { from: period.from, to: period.to },
    previousPeriod: period.previous,
    asOf,
    current: derived(sumFlows(byMonth, period.from, period.to)),
    previous: derived(sumFlows(byMonth, period.previous.from, period.previous.to)),
    position: {
      balanceDue: money(technicians.reduce((sum, technician) => sum + Math.max(0, technician.balanceDue), 0)),
      debtors: technicians.filter((technician) => technician.balanceDue > 0).length,
      awaitingCount: Number(awaitingRows[0].count),
      awaitingAmount: money(awaitingRows[0].amount),
      centralUnits: Number(stock.central_units),
      centralCost: money(stock.central_cost),
      technicianUnits: Number(stock.technician_units),
      technicianCost: money(stock.technician_cost),
      technicianValue: money(stock.technician_value),
    },
    series: monthsBetween(period.series.from, period.series.to).map((month) => {
      const flow = byMonth.get(month) ?? emptyFlow();
      return {
        month,
        sold: money(flow.sold),
        revenue: money(flow.revenue),
        cost: money(flow.cost),
        profit: money(flow.revenue - flow.cost),
        received: money(flow.received),
        purchases: money(flow.purchases),
      };
    }),
    technicians,
    parts: partRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      units: Number(row.units),
      revenue: money(row.revenue),
      cost: money(row.cost),
      profit: money(row.profit),
    })),
    recentPayments: recentRows.map((row) => ({
      id: String(row.id),
      technicianName: (row.name as string | null) ?? 'Técnico removido',
      amount: money(row.amount),
      method: normalizeMethod(row.method),
      createdAt: new Date(row.created_at as string).toISOString(),
      description: String(row.description ?? ''),
    })),
    receivedByMethod: (['pix', 'cash', 'transfer', 'other'] as const)
      .map((method) => ({ method, amount: money(methodTotals.get(method) ?? 0) }))
      .filter((item) => item.amount > 0),
  };
}

function normalizeMethod(method: unknown): 'pix' | 'cash' | 'transfer' | 'other' {
  return ['pix', 'cash', 'transfer'].includes(String(method)) ? (String(method) as 'pix' | 'cash' | 'transfer') : 'other';
}

export type FinanceReport = Awaited<ReturnType<typeof partsFinance>>;
