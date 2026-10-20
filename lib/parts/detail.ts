import { sql } from '../db';
import { money, toIso } from './common';
import { getPart } from './catalog';

export interface PartHolder {
  /** null = central stock. */
  technicianId: string | null;
  name: string;
  active: boolean;
  /** Units in this stock right now. */
  stock: number;
  /** Units the technician received from the company (remessas minus devoluções). */
  received: number;
  /** Units sold (cancellations discounted). */
  sold: number;
  /** Units missing in inventories. */
  missing: number;
}

export interface PartDetail {
  part: Awaited<ReturnType<typeof getPart>>;
  holders: PartHolder[];
  totals: {
    purchased: number;
    sold: number;
    soldPaid: number;
    soldAwaiting: number;
    sales: number;
    revenue: number;
    owedToCompany: number;
    companyProfit: number;
    technicianProfit: number;
    missing: number;
    averagePrice: number | null;
    firstSaleAt: string | null;
    lastSaleAt: string | null;
  };
  recentSales: Array<{
    id: string;
    number: number;
    createdAt: string;
    technicianName: string;
    quantity: number;
    unitPrice: number;
    status: 'awaiting_payment' | 'paid' | 'canceled';
  }>;
}

/** Where a part is, how many were sold and what the sales produced (admin's detail view). */
export async function getPartDetail(organizationId: string, partId: unknown): Promise<PartDetail> {
  const part = await getPart(organizationId, partId);
  const id = part.id;

  const [movementRows, saleRows, recentRows] = await Promise.all([
    sql`
      SELECT m.technician_id, t.name AS technician_name, (t.status = 'active') AS technician_active,
        SUM(m.quantity)::int AS stock,
        COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'transfer'), 0)::int AS received,
        COALESCE(-SUM(m.quantity) FILTER (WHERE m.kind IN ('sale', 'sale_canceled')), 0)::int AS sold,
        COALESCE(-SUM(m.quantity) FILTER (WHERE m.kind = 'inventory_shortage'), 0)::int AS missing,
        COALESCE(SUM(m.quantity) FILTER (WHERE m.kind = 'purchase'), 0)::int AS purchased
      FROM part_movements m
      LEFT JOIN technicians t ON t.id = m.technician_id
      WHERE m.organization_id = ${organizationId} AND m.part_id = ${id}
      GROUP BY m.technician_id, t.name, t.status
    `,
    sql`
      SELECT s.status,
        COUNT(DISTINCT s.id)::int AS sales,
        SUM(i.quantity)::int AS units,
        SUM(i.quantity * i.unit_price) AS revenue,
        SUM(i.quantity * i.unit_technician_price) AS owed,
        SUM(i.quantity * i.unit_cost) AS cost,
        MIN(s.created_at) AS first_at,
        MAX(s.created_at) AS last_at
      FROM part_sale_items i
      JOIN part_sales s ON s.id = i.sale_id
      WHERE i.organization_id = ${organizationId} AND i.part_id = ${id} AND s.status <> 'canceled'
      GROUP BY s.status
    `,
    sql`
      SELECT s.id, s.number, s.status, s.created_at, t.name AS technician_name, i.quantity, i.unit_price
      FROM part_sale_items i
      JOIN part_sales s ON s.id = i.sale_id
      JOIN technicians t ON t.id = s.technician_id
      WHERE i.organization_id = ${organizationId} AND i.part_id = ${id}
      ORDER BY s.created_at DESC
      LIMIT 8
    `,
  ]);

  const holders: PartHolder[] = movementRows
    .map((row) => ({
      technicianId: (row.technician_id as string | null) ?? null,
      name: row.technician_id ? String(row.technician_name ?? 'Técnico') : 'Estoque central',
      active: row.technician_id ? Boolean(row.technician_active) : true,
      stock: Number(row.stock),
      received: Number(row.received),
      sold: Number(row.sold),
      missing: Number(row.missing),
    }))
    // Central first, then who holds the most; technicians that never had the part don't appear.
    .sort((a, b) => Number(b.technicianId === null) - Number(a.technicianId === null) || b.stock - a.stock || a.name.localeCompare(b.name, 'pt-BR'));

  let units = 0;
  let paidUnits = 0;
  let awaitingUnits = 0;
  let sales = 0;
  let revenue = 0;
  let owed = 0;
  let cost = 0;
  let firstAt: Date | null = null;
  let lastAt: Date | null = null;
  for (const row of saleRows) {
    const rowUnits = Number(row.units);
    units += rowUnits;
    if (row.status === 'paid') paidUnits += rowUnits;
    else awaitingUnits += rowUnits;
    sales += Number(row.sales);
    revenue += Number(row.revenue);
    owed += Number(row.owed);
    cost += Number(row.cost);
    const first = row.first_at ? new Date(row.first_at) : null;
    const last = row.last_at ? new Date(row.last_at) : null;
    if (first && (!firstAt || first < firstAt)) firstAt = first;
    if (last && (!lastAt || last > lastAt)) lastAt = last;
  }

  return {
    part,
    holders,
    totals: {
      purchased: movementRows.reduce((sum, row) => sum + Number(row.purchased), 0),
      sold: units,
      soldPaid: paidUnits,
      soldAwaiting: awaitingUnits,
      sales,
      revenue: money(revenue),
      owedToCompany: money(owed),
      companyProfit: money(owed - cost),
      technicianProfit: money(revenue - owed),
      missing: holders.reduce((sum, holder) => sum + holder.missing, 0),
      averagePrice: units > 0 ? money(revenue / units) : null,
      firstSaleAt: toIso(firstAt),
      lastSaleAt: toIso(lastAt),
    },
    recentSales: recentRows.map((row) => ({
      id: String(row.id),
      number: Number(row.number),
      createdAt: toIso(row.created_at)!,
      technicianName: String(row.technician_name),
      quantity: Number(row.quantity),
      unitPrice: money(row.unit_price),
      status: row.status as PartDetail['recentSales'][number]['status'],
    })),
  };
}
