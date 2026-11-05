import { createNotification, notifyOrganization, resolveNotifications } from '../notifications';
import { sql } from '../db';
import { organizationHasFeature } from '../billing/entitlements';

// What Venda de Peças tells the admin through the bell: a sale concluded, a payment that went wrong, stock under the
// minimum and sales waiting for payment. Sending never breaks the sale itself (notifyOrganization swallows errors).

const brl = (value: unknown) => Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function loadSale(organizationId: string, saleId: string) {
  const rows = await sql`
    SELECT s.number, s.total_amount, t.name AS technician_name
    FROM part_sales s JOIN technicians t ON t.id = s.technician_id
    WHERE s.id = ${saleId} AND s.organization_id = ${organizationId}
  `;
  return rows[0] ?? null;
}

/** A sale was paid: concluded. */
export async function notifySalePaid(organizationId: string, saleId: string) {
  const sale = await loadSale(organizationId, saleId).catch(() => null);
  if (!sale) return;
  // Paid after a payment problem: the problem is over.
  await resolveNotifications(organizationId, `parts:sale-problem:${saleId}`).catch(() => undefined);
  await notifyOrganization(organizationId, {
    kind: 'parts',
    severity: 'success',
    title: `Venda #${sale.number} concluída`,
    body: `${sale.technician_name} recebeu ${brl(sale.total_amount)}.`,
    href: '/admin/pecas#sales',
    dedupeKey: `parts:sale-paid:${saleId}`,
  });
}

/** The payment could not be started or retried (Mercado Pago refused, account not connected...). */
export async function notifySaleProblem(organizationId: string, saleId: string, message: string) {
  const sale = await loadSale(organizationId, saleId).catch(() => null);
  if (!sale) return;
  await notifyOrganization(organizationId, {
    kind: 'parts',
    severity: 'warning',
    title: `Venda #${sale.number} com problema no pagamento`,
    body: `${sale.technician_name}: ${message}`.slice(0, 300),
    href: '/admin/pecas#sales',
    dedupeKey: `parts:sale-problem:${saleId}`,
  });
}

/** Parts under their minimum stock, and sales waiting for payment for over a day: once a day while they last. */
export async function checkParts(organizationId: string, today: string) {
  if (!(await organizationHasFeature(organizationId, 'parts'))) return;

  const [low] = await sql`
    SELECT COUNT(*)::int AS total, (array_agg(p.name ORDER BY p.name))[1:3] AS names
    FROM parts p
    WHERE p.organization_id = ${organizationId} AND p.deleted_at IS NULL AND p.active AND p.min_stock IS NOT NULL
      AND COALESCE((SELECT SUM(quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NULL), 0) <= p.min_stock
  `;
  const lowTotal = Number(low?.total ?? 0);
  if (lowTotal > 0) {
    const names = (low.names as string[] | null) ?? [];
    await createNotification({
      organizationId,
      kind: 'parts',
      severity: 'warning',
      title: lowTotal === 1 ? '1 peça com estoque baixo' : `${lowTotal} peças com estoque baixo`,
      body: `${names.join(', ')}${lowTotal > names.length ? ' e mais' : ''} chegou ao estoque mínimo. Hora de repor.`,
      href: '/admin/pecas#catalog',
      dedupeKey: `parts:low:${today}`,
    });
  } else {
    await resolveNotifications(organizationId, 'parts:low:');
  }

  const [waiting] = await sql`
    SELECT COUNT(*)::int AS total FROM part_sales
    WHERE organization_id = ${organizationId} AND status = 'awaiting_payment' AND created_at < NOW() - INTERVAL '24 hours'
  `;
  const waitingTotal = Number(waiting?.total ?? 0);
  if (waitingTotal > 0) {
    await createNotification({
      organizationId,
      kind: 'parts',
      severity: 'warning',
      title: waitingTotal === 1 ? '1 venda esperando pagamento há mais de um dia' : `${waitingTotal} vendas esperando pagamento há mais de um dia`,
      body: 'Confira se o cliente pagou ou cancele a venda para devolver as peças ao estoque do técnico.',
      href: '/admin/pecas#sales',
      dedupeKey: `parts:waiting:${today}`,
    });
  } else {
    await resolveNotifications(organizationId, 'parts:waiting:');
  }
}
