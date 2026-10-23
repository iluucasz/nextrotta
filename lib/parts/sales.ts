import { randomUUID } from 'crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { formatPhoneInput, validatePhone } from '../whatsapp/phone';
import { getAccessToken, getAccountStatus } from '../mercadopago/accounts';
import {
  cancelOrder,
  createPaymentLink,
  createPixOrder,
  createPointOrder,
  getOrder,
  getPayment,
  MercadoPagoError,
  orderOutcome,
  searchPaymentsByReference,
  searchRecentApprovedPayments,
  type MercadoPagoOrder,
} from '../mercadopago/client';
import { fallbackPayerEmail, mercadoPagoNotificationUrl } from '../mercadopago/config';
import { getCompanyName, getPartsSettings } from './catalog';
import {
  currentMonth,
  isUuid,
  lockStock,
  money,
  parseQuantity,
  PartsError,
  requireTechnician,
  requireUnits,
  runStockTransaction,
  toIso,
  withNumberRetry,
  type PartsActor,
} from './common';
import { sendCustomerMessage, whatsappShareUrl, type CustomerMessageResult } from './notify';
import { getStock } from './stock';
import {
  isPaymentMethod,
  MERCADOPAGO_METHODS,
  parseAmount,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type PaymentMethod,
  type SaleStatus,
} from './types';

const PIX_EXPIRATION_MINUTES = 60;
const LINK_EXPIRATION_HOURS = 24;
/** How far back "Conferir pagamento" looks for a charge made in the Mercado Pago app. */
const APP_CHARGE_LOOKBACK_HOURS = 6;

export interface SaleItem {
  partId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  unitTechnicianPrice: number;
}

export interface Sale {
  id: string;
  number: number;
  technicianId: string;
  technicianName: string;
  customerName: string | null;
  customerPhone: string | null;
  orderCode: string | null;
  status: SaleStatus;
  statusLabel: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: string;
  totalAmount: number;
  totalTechnicianPrice: number;
  /** Organization only: what it paid for the parts. */
  totalCost?: number;
  paymentUrl: string | null;
  pixQrCode: string | null;
  pixQrBase64: string | null;
  paymentExpiresAt: string | null;
  paymentError: string | null;
  /** card_present with a Point device: the charge was sent to the device. */
  sentToTerminal: boolean;
  paidAt: string | null;
  paymentConfirmedBy: 'mercadopago' | 'technician' | null;
  mpPaymentId: string | null;
  paymentLinkSentAt: string | null;
  receiptSentAt: string | null;
  note: string | null;
  createdAt: string;
  canceledAt: string | null;
  cancelReason: string | null;
  items: SaleItem[];
}

function toSale(row: Record<string, unknown>, items: SaleItem[], includeCost: boolean): Sale {
  const status = row.status as SaleStatus;
  const method = row.payment_method as PaymentMethod;
  return {
    id: String(row.id),
    number: Number(row.number),
    technicianId: String(row.technician_id),
    technicianName: String(row.technician_name ?? ''),
    customerName: (row.customer_name as string | null) ?? null,
    customerPhone: (row.customer_phone as string | null) ?? null,
    orderCode: (row.order_code as string | null) ?? null,
    status,
    statusLabel: SALE_STATUS_LABELS[status],
    paymentMethod: method,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[method],
    totalAmount: money(row.total_amount),
    totalTechnicianPrice: money(row.total_technician_price),
    ...(includeCost ? { totalCost: money(row.total_cost) } : {}),
    paymentUrl: (row.payment_url as string | null) ?? null,
    pixQrCode: (row.pix_qr_code as string | null) ?? null,
    pixQrBase64: (row.pix_qr_base64 as string | null) ?? null,
    paymentExpiresAt: toIso(row.payment_expires_at),
    paymentError: (row.payment_error as string | null) ?? null,
    sentToTerminal: method === 'card_present' && Boolean(row.mp_order_id),
    paidAt: toIso(row.paid_at),
    paymentConfirmedBy: (row.payment_confirmed_by as 'mercadopago' | 'technician' | null) ?? null,
    mpPaymentId: (row.mp_payment_id as string | null) ?? null,
    paymentLinkSentAt: toIso(row.payment_link_sent_at),
    receiptSentAt: toIso(row.receipt_sent_at),
    note: (row.note as string | null) ?? null,
    createdAt: toIso(row.created_at)!,
    canceledAt: toIso(row.canceled_at),
    cancelReason: (row.cancel_reason as string | null) ?? null,
    items,
  };
}

async function loadSaleRow(organizationId: string, saleId: unknown, technicianId?: string | null) {
  if (!isUuid(saleId)) throw new PartsError('Venda inválida.');
  const row = (
    await sql`
      SELECT s.*, t.name AS technician_name FROM part_sales s JOIN technicians t ON t.id = s.technician_id
      WHERE s.id = ${saleId} AND s.organization_id = ${organizationId}
        AND (${technicianId ?? null}::uuid IS NULL OR s.technician_id = ${technicianId ?? null}::uuid)
    `
  )[0];
  if (!row) throw new PartsError('Venda não encontrada.', 404);
  return row;
}

async function loadItems(saleIds: string[]) {
  if (!saleIds.length) return new Map<string, SaleItem[]>();
  const rows = await sql`
    SELECT sale_id, part_id, part_name, quantity, unit_price, unit_technician_price
    FROM part_sale_items WHERE sale_id = ANY(${saleIds}::uuid[]) ORDER BY part_name
  `;
  const map = new Map<string, SaleItem[]>();
  for (const row of rows) {
    const list = map.get(String(row.sale_id)) ?? [];
    list.push({
      partId: String(row.part_id),
      name: String(row.part_name),
      quantity: Number(row.quantity),
      unitPrice: money(row.unit_price),
      unitTechnicianPrice: money(row.unit_technician_price),
    });
    map.set(String(row.sale_id), list);
  }
  return map;
}

/** technicianId limits to that technician's own sales (and hides the cost). */
export async function getSale(organizationId: string, saleId: unknown, technicianId?: string | null) {
  const row = await loadSaleRow(organizationId, saleId, technicianId);
  const items = await loadItems([String(row.id)]);
  return toSale(row, items.get(String(row.id)) ?? [], !technicianId);
}

export async function listSales(
  organizationId: string,
  filters: { technicianId?: string | null; month?: string | null; status?: string | null; asTechnician?: boolean },
) {
  const status = filters.status && filters.status in SALE_STATUS_LABELS ? filters.status : null;
  const rows = await sql`
    SELECT s.*, t.name AS technician_name FROM part_sales s JOIN technicians t ON t.id = s.technician_id
    WHERE s.organization_id = ${organizationId}
      AND (${filters.technicianId ?? null}::uuid IS NULL OR s.technician_id = ${filters.technicianId ?? null}::uuid)
      AND (${filters.month ?? null}::text IS NULL OR to_char(s.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${filters.month ?? null})
      AND (${status}::text IS NULL OR s.status = ${status})
    ORDER BY s.created_at DESC
    LIMIT 500
  `;
  const items = await loadItems(rows.map((row) => String(row.id)));
  return rows.map((row) => toSale(row, items.get(String(row.id)) ?? [], !filters.asTechnician));
}

// ---------------------------------------------------------------- creating a sale

/**
 * The technician sells parts from their own stock. Stock leaves right away and the technician
 * starts owing the technician price (it is their sale; canceling gives both back). Then the
 * customer is charged by the chosen method.
 */
export async function createSale(
  organizationId: string,
  technicianId: string,
  input: Record<string, unknown>,
  actor: PartsActor,
) {
  const technician = await requireTechnician(organizationId, technicianId);
  const settings = await getPartsSettings(organizationId);
  if (!isPaymentMethod(input.paymentMethod) || !settings.paymentMethods.includes(input.paymentMethod)) {
    throw new PartsError('Escolha uma forma de pagamento válida.');
  }
  const paymentMethod = input.paymentMethod;

  const phone = validatePhone(String(input.customerPhone ?? ''));
  if (phone.status !== 'valid') throw new PartsError('Informe o WhatsApp do cliente (com DDD) para enviar o pagamento e o recibo.');
  const customerName = typeof input.customerName === 'string' && input.customerName.trim() ? input.customerName.trim().slice(0, 120) : null;
  const orderCode = typeof input.orderCode === 'string' && input.orderCode.trim() ? input.orderCode.trim().slice(0, 60) : null;
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;

  if (!Array.isArray(input.items) || !input.items.length) throw new PartsError('Adicione ao menos uma peça.');
  const requested = new Map<string, { quantity: number; unitPrice: number }>();
  for (const item of input.items as Array<Record<string, unknown>>) {
    if (!isUuid(item?.partId)) throw new PartsError('Peça inválida na venda.');
    const quantity = parseQuantity(item.quantity);
    const unitPrice = parseAmount(item.unitPrice);
    // The screen already asks for a price per part; a zero would register a free sale that still charges the technician.
    if (unitPrice === null || unitPrice <= 0) throw new PartsError('Informe o valor cobrado de cada peça (maior que zero).');
    const previous = requested.get(item.partId);
    if (previous && previous.unitPrice !== unitPrice) throw new PartsError('A mesma peça aparece com dois preços diferentes.');
    requested.set(item.partId, { quantity: (previous?.quantity ?? 0) + quantity, unitPrice });
  }
  const partIds = Array.from(requested.keys());
  const parts = await sql`
    SELECT id, name, cost_price, technician_price FROM parts
    WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND id = ANY(${partIds}::uuid[])
  `;
  if (parts.length !== partIds.length) throw new PartsError('Uma das peças não foi encontrada.', 404);
  const stock = await getStock(organizationId, technician.id, partIds);
  const short = parts.filter((part) => (stock.get(String(part.id)) ?? 0) < requested.get(String(part.id))!.quantity);
  if (short.length) {
    throw new PartsError(
      `Você não tem essa quantidade no estoque: ${short.map((part) => `${part.name} (tem ${stock.get(String(part.id)) ?? 0})`).join(', ')}.`,
      409,
    );
  }

  const items = parts.map((part) => {
    const { quantity, unitPrice } = requested.get(String(part.id))!;
    return { part, quantity, unitPrice, technicianPrice: money(part.technician_price), cost: money(part.cost_price) };
  });
  const totalAmount = money(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const totalTechnician = money(items.reduce((sum, item) => sum + item.quantity * item.technicianPrice, 0));
  const totalCost = money(items.reduce((sum, item) => sum + item.quantity * item.cost, 0));
  // Every sale, whatever the method, requires the technician's connected Mercado Pago account.
  if (!(await getAccountStatus(organizationId, technician.id)).connected) {
    throw new PartsError('Conecte sua conta do Mercado Pago para registrar vendas.', 409);
  }
  if (MERCADOPAGO_METHODS.includes(paymentMethod)) {
    if (totalAmount < 1) throw new PartsError('Para cobrar pelo Mercado Pago o total precisa ser de pelo menos R$ 1,00.');
    // Fails early (and clearly) when the token can't be used (expired authorization, platform not configured).
    await getAccessToken(organizationId, technician.id);
  }

  const id = randomUUID();
  const month = currentMonth();
  // The stock is locked and re-checked inside the transaction, so a double tap on "Cobrar" (or two
  // devices) can never sell the same unit twice.
  await withNumberRetry(() =>
    runStockTransaction([
      lockStock(organizationId, technician.id),
      ...items.map((item) => requireUnits(organizationId, technician.id, String(item.part.id), item.quantity)),
      sql`
        INSERT INTO part_sales (
          id, organization_id, number, technician_id, customer_name, customer_phone, order_code, payment_method,
          total_amount, total_technician_price, total_cost, note, created_by
        )
        VALUES (
          ${id}, ${organizationId}, (SELECT COALESCE(MAX(number), 0) + 1 FROM part_sales WHERE organization_id = ${organizationId}),
          ${technician.id}, ${customerName}, ${phone.e164}, ${orderCode}, ${paymentMethod},
          ${totalAmount}, ${totalTechnician}, ${totalCost}, ${note}, ${actor.id}
        )
      `,
      ...items.flatMap(({ part, quantity, unitPrice, technicianPrice, cost }) => [
        sql`
          INSERT INTO part_sale_items (organization_id, sale_id, part_id, part_name, quantity, unit_price, unit_technician_price, unit_cost)
          VALUES (${organizationId}, ${id}, ${part.id}, ${part.name}, ${quantity}, ${unitPrice}, ${technicianPrice}, ${cost})
        `,
        sql`
          INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, sale_id, created_by)
          VALUES (${organizationId}, ${part.id}, ${technician.id}, ${-quantity}, 'sale', ${cost}, ${technicianPrice}, ${id}, ${actor.id})
        `,
      ]),
      sql`
        INSERT INTO part_account_entries (organization_id, technician_id, kind, amount, due_month, sale_id, description, created_by)
        SELECT ${organizationId}, ${technician.id}, 'sale', ${totalTechnician}, ${month}, ${id}, 'Venda nº ' || number, ${actor.id}
        FROM part_sales WHERE id = ${id} AND ${totalTechnician}::numeric <> 0
      `,
    ]),
  );

  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.sale_created', targetType: 'part_sale', targetId: id,
    details: { technicianId: technician.id, totalAmount, totalTechnician, paymentMethod },
  });

  if (MERCADOPAGO_METHODS.includes(paymentMethod)) {
    try {
      await startPayment(organizationId, id, technician.id, actor);
    } catch (error) {
      // The sale stays; the screen shows the error with "tentar de novo" or another method.
      const message = paymentFailureMessage(error, paymentMethod);
      await sql`UPDATE part_sales SET payment_error = ${message} WHERE id = ${id}`;
    }
  }
  return getSale(organizationId, id, technician.id);
}

// ---------------------------------------------------------------- charging the customer

function describeSale(row: Record<string, unknown>, companyName: string) {
  return `Venda nº ${row.number}${companyName ? ` — ${companyName}` : ''}`;
}

/** Creates the charge in the technician's Mercado Pago account for the sale's method. */
export async function startPayment(organizationId: string, saleId: string, technicianId: string, actor: PartsActor) {
  const row = await loadSaleRow(organizationId, saleId, technicianId);
  if (row.status !== 'awaiting_payment') throw new PartsError('Esta venda não está aguardando pagamento.', 409);
  const method = row.payment_method as PaymentMethod;
  if (!MERCADOPAGO_METHODS.includes(method)) return;

  const { token, terminalId } = await getAccessToken(organizationId, technicianId);
  const attempt = Number(row.payment_attempts) + 1;
  const reference = `${row.id}`;
  const name = await getCompanyName(organizationId);
  const amount = money(row.total_amount);

  if (method === 'pix') {
    const order = await createPixOrder(token, {
      reference,
      amount,
      description: describeSale(row, name),
      payerEmail: fallbackPayerEmail(),
      // Pix orders sent without a payer name came back as "processing_error" while named ones worked; the customer often has no name.
      payerFirstName: (row.customer_name as string | null)?.trim() || 'Cliente',
      expirationMinutes: PIX_EXPIRATION_MINUTES,
      attempt,
    });
    const payment = order.transactions?.payments?.[0];
    const expiresAt = payment?.date_of_expiration ? new Date(payment.date_of_expiration) : new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000);
    await sql`
      UPDATE part_sales SET
        mp_order_id = ${order.id}, mp_preference_id = NULL, mp_status = ${order.status ?? null},
        payment_url = ${payment?.payment_method?.ticket_url ?? null},
        pix_qr_code = ${payment?.payment_method?.qr_code ?? null},
        pix_qr_base64 = ${payment?.payment_method?.qr_code_base64 ?? null},
        payment_expires_at = ${expiresAt}, payment_attempts = ${attempt}, payment_error = NULL
      WHERE id = ${row.id}
    `;
  } else if (method === 'card_link') {
    const items = (await loadItems([String(row.id)])).get(String(row.id)) ?? [];
    const expiresAt = new Date(Date.now() + LINK_EXPIRATION_HOURS * 3_600_000);
    const preference = await createPaymentLink(token, {
      reference,
      items: items.map((item) => ({ id: item.partId, title: item.name, quantity: item.quantity, unitPrice: item.unitPrice })),
      notificationUrl: mercadoPagoNotificationUrl(),
      expiresAt,
      attempt,
    });
    await sql`
      UPDATE part_sales SET
        mp_preference_id = ${preference.id}, mp_order_id = NULL, payment_url = ${preference.init_point},
        pix_qr_code = NULL, pix_qr_base64 = NULL, payment_expires_at = ${expiresAt},
        payment_attempts = ${attempt}, payment_error = NULL
      WHERE id = ${row.id}
    `;
  } else if (method === 'card_present') {
    if (terminalId) {
      const order = await createPointOrder(token, { reference, amount, description: describeSale(row, name), terminalId, attempt });
      await sql`
        UPDATE part_sales SET mp_order_id = ${order.id}, mp_status = ${order.status ?? null},
          payment_expires_at = NOW() + INTERVAL '15 minutes', payment_attempts = ${attempt}, payment_error = NULL
        WHERE id = ${row.id}
      `;
    } else {
      // No device linked: the technician charges with Point Tap in the Mercado Pago app and then
      // taps "Conferir pagamento", which finds the charge in their account.
      await sql`UPDATE part_sales SET payment_attempts = ${attempt}, payment_error = NULL WHERE id = ${row.id}`;
    }
  }

  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.sale_charge_created', targetType: 'part_sale', targetId: String(row.id), details: { method, attempt },
  });
}

/** Retries the charge, optionally with another method (only while awaiting payment). */
export async function retryPayment(organizationId: string, saleId: unknown, technicianId: string, input: { paymentMethod?: unknown }, actor: PartsActor) {
  const row = await loadSaleRow(organizationId, saleId, technicianId);
  if (row.status !== 'awaiting_payment') throw new PartsError('Esta venda não está aguardando pagamento.', 409);
  if (input.paymentMethod !== undefined && input.paymentMethod !== row.payment_method) {
    const settings = await getPartsSettings(organizationId);
    if (!isPaymentMethod(input.paymentMethod) || !settings.paymentMethods.includes(input.paymentMethod)) {
      throw new PartsError('Forma de pagamento inválida.');
    }
    await cancelOpenOrder(organizationId, row);
    await sql`
      UPDATE part_sales SET payment_method = ${input.paymentMethod}, mp_order_id = NULL, mp_preference_id = NULL, payment_url = NULL,
        pix_qr_code = NULL, pix_qr_base64 = NULL, payment_expires_at = NULL, payment_error = NULL, payment_link_sent_at = NULL
      WHERE id = ${row.id}
    `;
  } else {
    await cancelOpenOrder(organizationId, row);
  }
  try {
    await startPayment(organizationId, String(row.id), technicianId, actor);
  } catch (error) {
    const currentMethod = isPaymentMethod(input.paymentMethod) ? input.paymentMethod : (row.payment_method as PaymentMethod);
    const message = paymentFailureMessage(error, currentMethod);
    await sql`UPDATE part_sales SET payment_error = ${message} WHERE id = ${row.id}`;
    throw message === (error instanceof Error ? error.message : String(error)) ? error : new PartsError(message, 502);
  }
  return getSale(organizationId, row.id, technicianId);
}

/**
 * What the technician sees when the charge can't be created. A Pix refused with "processing_error"
 * is, in practice, a Mercado Pago account without a Pix key; the raw answer stays in the server logs.
 */
function paymentFailureMessage(error: unknown, method: PaymentMethod) {
  const message = error instanceof Error ? error.message : String(error);
  if (method === 'pix' && error instanceof MercadoPagoError && /processing_error/i.test(message)) {
    return 'O Mercado Pago não conseguiu gerar o Pix. O motivo mais comum é a conta não ter uma chave Pix: abra o app do Mercado Pago, vá em Pix > Minhas chaves e cadastre uma. Depois toque em "Tentar de novo". Se já tem chave, aguarde um pouco e tente de novo.';
  }
  return message;
}

async function cancelOpenOrder(organizationId: string, row: Record<string, unknown>) {
  if (!row.mp_order_id) return;
  try {
    const { token } = await getAccessToken(organizationId, String(row.technician_id));
    await cancelOrder(token, String(row.mp_order_id));
  } catch (error) {
    // Expired or already finished orders can't be canceled: nothing left to charge.
    console.warn('[parts] cancel Mercado Pago order:', error instanceof Error ? error.message : error);
  }
}

/**
 * Asks Mercado Pago whether the customer paid. Called by the screens (polling), by the webhook and
 * by "Conferir pagamento". Marks the sale paid and sends the receipt when it did.
 */
export async function checkPayment(organizationId: string, saleId: unknown, technicianId?: string | null) {
  const row = await loadSaleRow(organizationId, saleId, technicianId);
  if (row.status !== 'awaiting_payment') return { sale: await getSale(organizationId, row.id, technicianId), found: row.status === 'paid' };
  const method = row.payment_method as PaymentMethod;
  if (!MERCADOPAGO_METHODS.includes(method)) return { sale: await getSale(organizationId, row.id, technicianId), found: false };

  const { token } = await getAccessToken(organizationId, String(row.technician_id));
  let paidPaymentId: string | null = null;
  let mpStatus: string | null = null;

  if (row.mp_order_id) {
    const order: MercadoPagoOrder = await getOrder(token, String(row.mp_order_id));
    mpStatus = order.status ?? null;
    if (orderOutcome(order) === 'paid') paidPaymentId = order.transactions?.payments?.[0]?.id ?? String(order.id);
  } else if (method === 'card_link') {
    const payments = await searchPaymentsByReference(token, String(row.id));
    const approved = payments.find((payment) => payment.status === 'approved');
    mpStatus = payments[0]?.status ?? null;
    if (approved) paidPaymentId = String(approved.id);
  } else if (method === 'card_present') {
    // Charged in the Mercado Pago app (Point Tap): the approved payment of the same amount made
    // since the sale, not already tied to another sale.
    const createdAt = new Date(String(row.created_at)).getTime() - 10 * 60_000;
    const payments = await searchRecentApprovedPayments(token, APP_CHARGE_LOOKBACK_HOURS);
    const candidates = payments
      .filter((payment) => Math.abs(Number(payment.transaction_amount) - money(row.total_amount)) < 0.005)
      .filter((payment) => new Date(payment.date_approved ?? payment.date_created ?? 0).getTime() >= createdAt);
    if (candidates.length) {
      const taken = await sql`
        SELECT mp_payment_id FROM part_sales WHERE mp_payment_id = ANY(${candidates.map((payment) => String(payment.id))})
      `;
      const takenIds = new Set(taken.map((item) => String(item.mp_payment_id)));
      const free = candidates
        .filter((payment) => !takenIds.has(String(payment.id)))
        .sort((a, b) => new Date(a.date_created ?? 0).getTime() - new Date(b.date_created ?? 0).getTime());
      if (free[0]) paidPaymentId = String(free[0].id);
    }
  }

  if (mpStatus) await sql`UPDATE part_sales SET mp_status = ${mpStatus} WHERE id = ${row.id}`;
  if (!paidPaymentId) return { sale: await getSale(organizationId, row.id, technicianId), found: false };

  const marked = await markPaid(organizationId, String(row.id), { by: 'mercadopago', mpPaymentId: paidPaymentId });
  return { sale: await getSale(organizationId, row.id, technicianId), found: marked };
}

/** Returns false when the sale was not awaiting payment, or the Mercado Pago payment already settled another sale. */
async function markPaid(organizationId: string, saleId: string, input: { by: 'mercadopago' | 'technician'; mpPaymentId?: string | null; actorId?: string | null }) {
  let updated;
  try {
    updated = await sql`
      UPDATE part_sales SET status = 'paid', paid_at = NOW(), payment_confirmed_by = ${input.by},
        mp_payment_id = COALESCE(${input.mpPaymentId ?? null}, mp_payment_id), payment_error = NULL
      WHERE id = ${saleId} AND organization_id = ${organizationId} AND status = 'awaiting_payment'
      RETURNING id, technician_id
    `;
  } catch (error) {
    // part_sales_mp_payment_idx: that payment is already tied to another sale.
    if ((error as { code?: string })?.code === '23505') return false;
    throw error;
  }
  if (!updated.length) return false;
  await recordAudit({
    organizationId,
    actorId: input.actorId ?? null,
    actorRole: input.by === 'mercadopago' ? 'system' : 'technician',
    action: 'part.sale_paid',
    targetType: 'part_sale',
    targetId: saleId,
    details: { by: input.by, mpPaymentId: input.mpPaymentId ?? null },
  });
  await sendReceipt(organizationId, saleId, null).catch((error) => console.error('[parts] receipt:', error));
  return true;
}

/** Cash, or a charge made outside the system: the technician states they received it. */
export async function confirmReceived(organizationId: string, saleId: unknown, technicianId: string, actor: PartsActor) {
  const row = await loadSaleRow(organizationId, saleId, technicianId);
  if (row.status !== 'awaiting_payment') throw new PartsError('Esta venda não está aguardando pagamento.', 409);
  await cancelOpenOrder(organizationId, row);
  await markPaid(organizationId, String(row.id), { by: 'technician', actorId: actor.id });
  return getSale(organizationId, row.id, technicianId);
}

/**
 * Cancels a sale: the parts go back to the technician's stock and the technician price leaves their
 * account. A technician cancels only unpaid sales; a paid one (refund made in Mercado Pago) only the admin.
 */
export async function cancelSale(organizationId: string, saleId: unknown, input: { reason?: unknown; technicianId?: string | null }, actor: PartsActor) {
  const row = await loadSaleRow(organizationId, saleId, input.technicianId);
  if (row.status === 'canceled') throw new PartsError('Esta venda já foi cancelada.', 409);
  if (row.status === 'paid' && input.technicianId) {
    throw new PartsError('Venda já paga: peça ao administrador para cancelar (e faça o estorno no Mercado Pago).', 403);
  }
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 300) : null;
  if (!reason) throw new PartsError('Informe o motivo do cancelamento.');

  // The customer may have paid since the screen last looked: ask Mercado Pago first, so a technician never
  // cancels (and gets the parts back for) a sale whose money has already arrived. Only for charges tied to an
  // order or a link; "cartão presencial" is matched by amount and could pair with an unrelated payment.
  if (input.technicianId && row.status === 'awaiting_payment' && (row.mp_order_id || row.payment_method === 'card_link')) {
    let paidMeanwhile = false;
    try {
      paidMeanwhile = (await checkPayment(organizationId, row.id, input.technicianId)).sale.status === 'paid';
    } catch (error) {
      // Mercado Pago unreachable (or the charge never existed): cancel anyway, as before.
      console.warn('[parts] check before cancel:', error instanceof Error ? error.message : error);
    }
    if (paidMeanwhile) {
      throw new PartsError('O cliente acabou de pagar esta venda. Se precisar cancelar, peça ao administrador (e faça o estorno no Mercado Pago).', 409);
    }
  }
  await cancelOpenOrder(organizationId, row);

  const items = await sql`SELECT part_id, quantity, unit_cost, unit_technician_price FROM part_sale_items WHERE sale_id = ${row.id}`;
  try {
    // One transaction: status, stock and account change together or not at all. The unique indexes
    // on part_movements/part_account_entries (migration 0024) make a concurrent second cancel fail here.
    await sql.transaction([
      sql`
        UPDATE part_sales SET status = 'canceled', canceled_at = NOW(), canceled_by = ${actor.id}, cancel_reason = ${reason}
        WHERE id = ${row.id} AND organization_id = ${organizationId} AND status <> 'canceled'
      `,
      ...items.map(
        (item) => sql`
          INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, sale_id, note, created_by)
          VALUES (${organizationId}, ${item.part_id}, ${row.technician_id}, ${Number(item.quantity)}, 'sale_canceled', ${item.unit_cost},
                  ${item.unit_technician_price}, ${row.id}, ${reason}, ${actor.id})
        `,
      ),
      sql`
        INSERT INTO part_account_entries (organization_id, technician_id, kind, amount, due_month, sale_id, description, created_by)
        SELECT ${organizationId}, technician_id, 'sale_canceled', -amount, ${currentMonth()}, sale_id, ${`Venda nº ${row.number} cancelada: ${reason}`}, ${actor.id}
        FROM part_account_entries WHERE sale_id = ${row.id} AND kind = 'sale'
      `,
    ]);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new PartsError('Esta venda já foi cancelada.', 409);
    throw error;
  }
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.sale_canceled', targetType: 'part_sale', targetId: String(row.id), details: { reason, wasPaid: row.status === 'paid' },
  });
  return getSale(organizationId, row.id, input.technicianId);
}

// ---------------------------------------------------------------- messages to the customer

const formatBRL = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function greeting(name: string | null) {
  return name ? `Olá, ${name.split(' ')[0]}!` : 'Olá!';
}

export function paymentMessage(sale: Sale, company: string) {
  const lines = [
    `${greeting(sale.customerName)} Segue o pagamento das peças${company ? ` (${company})` : ''}.`,
    '',
    ...sale.items.map((item) => `${item.quantity}× ${item.name} — ${formatBRL(item.unitPrice * item.quantity)}`),
    `*Total: ${formatBRL(sale.totalAmount)}*`,
    '',
  ];
  if (sale.paymentMethod === 'pix') {
    lines.push(sale.paymentUrl ? `Pague com Pix por este link: ${sale.paymentUrl}` : 'Pague com o Pix copia e cola da próxima mensagem.');
  } else if (sale.paymentUrl) {
    lines.push(`Pague com cartão por este link: ${sale.paymentUrl}`);
  }
  lines.push(`Técnico: ${sale.technicianName}`);
  return lines.join('\n');
}

export function receiptMessage(sale: Sale, company: string, footer: string) {
  const paidAt = sale.paidAt ? new Date(sale.paidAt) : new Date();
  const lines = [
    `*Recibo de venda nº ${sale.number}*`,
    ...(company ? [company] : []),
    `Data: ${paidAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}`,
    `Vendedor: ${sale.technicianName}`,
    ...(sale.customerName ? [`Cliente: ${sale.customerName}`] : []),
    '',
    ...sale.items.map((item) => `${item.quantity}× ${item.name} (${formatBRL(item.unitPrice)}) = ${formatBRL(item.unitPrice * item.quantity)}`),
    `*Total pago: ${formatBRL(sale.totalAmount)}*`,
    `Pagamento: ${sale.paymentMethodLabel}`,
  ];
  if (footer.trim()) lines.push('', footer.trim());
  return lines.join('\n');
}

/** Sends the payment link (and the Pix code on its own message, easy to copy) to the customer. */
export async function sendPaymentLink(organizationId: string, saleId: unknown, technicianId: string | null, actorId: string | null) {
  const sale = await getSale(organizationId, saleId, technicianId);
  if (sale.status !== 'awaiting_payment') throw new PartsError('Esta venda não está aguardando pagamento.', 409);
  if (!sale.paymentUrl && !sale.pixQrCode) throw new PartsError('Esta venda não tem link de pagamento para enviar.');
  const company = await getCompanyName(organizationId);
  const text = paymentMessage(sale, company);
  const attempt = (await sql`SELECT payment_attempts FROM part_sales WHERE id = ${sale.id}`)[0]?.payment_attempts ?? 0;
  const base = { phone: sale.customerPhone, technicianId: sale.technicianId, technicianName: sale.technicianName, createdBy: actorId };

  const first = await sendCustomerMessage(organizationId, { ...base, text, dedupeKey: `parts-link-${sale.id}-${attempt}-${Date.now()}` });
  let codeResult: CustomerMessageResult | null = null;
  if (first.status === 'sent' && sale.paymentMethod === 'pix' && sale.pixQrCode) {
    codeResult = await sendCustomerMessage(organizationId, { ...base, text: sale.pixQrCode, dedupeKey: `parts-pix-${sale.id}-${attempt}-${Date.now()}` });
  }
  if (first.status === 'sent') await sql`UPDATE part_sales SET payment_link_sent_at = NOW() WHERE id = ${sale.id}`;
  return {
    whatsapp: first,
    pixCode: codeResult,
    shareUrl: whatsappShareUrl(sale.customerPhone, sale.paymentMethod === 'pix' && sale.pixQrCode ? `${text}\n\nPix copia e cola:\n${sale.pixQrCode}` : text),
  };
}

/** Sends the receipt once per sale (or again on request with `force`). */
export async function sendReceipt(organizationId: string, saleId: unknown, technicianId: string | null, options: { force?: boolean; actorId?: string | null } = {}) {
  const sale = await getSale(organizationId, saleId, technicianId);
  if (sale.status !== 'paid') throw new PartsError('O recibo só sai depois do pagamento.', 409);
  const settings = await getPartsSettings(organizationId);
  const text = receiptMessage(sale, await getCompanyName(organizationId, settings), settings.receiptFooter);
  if (sale.receiptSentAt && !options.force) return { whatsapp: null, shareUrl: whatsappShareUrl(sale.customerPhone, text) };

  const result = await sendCustomerMessage(organizationId, {
    phone: sale.customerPhone,
    text,
    technicianId: sale.technicianId,
    technicianName: sale.technicianName,
    dedupeKey: options.force ? `parts-receipt-${sale.id}-${Date.now()}` : `parts-receipt-${sale.id}`,
    createdBy: options.actorId ?? null,
  });
  if (result.status === 'sent') await sql`UPDATE part_sales SET receipt_sent_at = NOW() WHERE id = ${sale.id}`;
  return { whatsapp: result, shareUrl: result.shareUrl };
}

/** Customer phone as typed in the forms, e.g. "(11) 97971-3590". */
export function displayPhone(phone: string | null) {
  return phone ? formatPhoneInput(phone.replace(/^55/, '')) : '';
}

// ---------------------------------------------------------------- webhook

/**
 * A Mercado Pago notification: finds the sale it is about (by order id, or by the payment's
 * external reference = sale id) and checks it. Returns the sale id handled, if any.
 */
export async function handleMercadoPagoNotification(input: { type: string | null; dataId: string | null; mpUserId: string | null }) {
  if (!input.dataId) return null;
  const type = (input.type ?? '').toLowerCase();

  if (type === 'order' || type.startsWith('order')) {
    const sale = (await sql`SELECT id, organization_id FROM part_sales WHERE mp_order_id = ${input.dataId} LIMIT 1`)[0];
    if (!sale) return null;
    await checkPayment(String(sale.organization_id), String(sale.id));
    return String(sale.id);
  }

  if (type === 'payment') {
    if (!input.mpUserId) return null;
    const account = (
      await sql`SELECT organization_id, technician_id FROM mercadopago_accounts WHERE mp_user_id = ${input.mpUserId} AND disconnected_at IS NULL LIMIT 1`
    )[0];
    if (!account) return null;
    const { token } = await getAccessToken(String(account.organization_id), String(account.technician_id));
    const payment = await getPayment(token, input.dataId).catch((error) => {
      if (error instanceof MercadoPagoError) return null;
      throw error;
    });
    const reference = payment?.external_reference;
    if (!reference || !isUuid(reference)) return null;
    const sale = (
      await sql`SELECT id FROM part_sales WHERE id = ${reference} AND organization_id = ${account.organization_id}`
    )[0];
    if (!sale) return null;
    await checkPayment(String(account.organization_id), String(sale.id));
    return String(sale.id);
  }
  return null;
}
