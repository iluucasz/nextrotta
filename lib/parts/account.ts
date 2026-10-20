import { randomUUID } from 'crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { addMonths, ACCOUNT_ENTRY_LABELS, isSettlementMethod, parseAmount, SETTLEMENT_METHOD_LABELS, type AccountEntryKind, type SettlementMethod } from './types';
import { currentMonth, isMonthKey, isUuid, money, PartsError, requireTechnician, toIso, withNumberRetry, type PartsActor } from './common';

/**
 * The technician's account with the organization (conta do técnico): every sale adds the technician
 * price of the parts sold, debts add their installments, payments subtract. Balance due in a month =
 * everything due up to that month. Append-only: corrections are new entries.
 */

// ---------------------------------------------------------------- debts

/** Splits a total in installments, cents going to the first ones so the sum is exact. */
export function splitInstallments(total: number, count: number) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

export async function createDebt(
  organizationId: string,
  input: { technicianId: unknown; description: unknown; totalAmount: unknown; installments: unknown; firstDueMonth: unknown; inventoryId?: string | null },
  actor: PartsActor,
) {
  const technician = await requireTechnician(organizationId, input.technicianId, true);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 1000) : '';
  if (!description) throw new PartsError('Descreva o débito (o que aconteceu e quais peças).');
  const total = parseAmount(input.totalAmount);
  if (total === null || total <= 0) throw new PartsError('Valor do débito inválido.');
  const installments = Number(input.installments ?? 1);
  if (!Number.isInteger(installments) || installments < 1 || installments > 48) throw new PartsError('Parcelas devem ser entre 1 e 48.');
  const firstDueMonth = isMonthKey(input.firstDueMonth) ? input.firstDueMonth : currentMonth();
  const values = splitInstallments(total, installments);

  return withNumberRetry(async () => {
    const id = randomUUID();
    await sql.transaction([
      sql`
        INSERT INTO part_debts (id, organization_id, number, technician_id, inventory_id, description, total_amount, installments, first_due_month, created_by)
        VALUES (
          ${id}, ${organizationId}, (SELECT COALESCE(MAX(number), 0) + 1 FROM part_debts WHERE organization_id = ${organizationId}),
          ${technician.id}, ${input.inventoryId ?? null}, ${description}, ${total}, ${installments}, ${firstDueMonth}, ${actor.id}
        )
      `,
      ...values.map(
        (value, index) => sql`
          INSERT INTO part_account_entries (organization_id, technician_id, kind, amount, due_month, debt_id, installment, description, created_by)
          VALUES (
            ${organizationId}, ${technician.id}, 'debt_installment', ${value}, ${addMonths(firstDueMonth, index)}, ${id}, ${index + 1},
            ${`Parcela ${index + 1}/${installments} — débito de peças`}, ${actor.id}
          )
        `,
      ),
    ]);
    await recordAudit({
      organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
      action: 'part.debt_created', targetType: 'part_debt', targetId: id,
      details: { technicianId: technician.id, total, installments, firstDueMonth, inventoryId: input.inventoryId ?? null },
    });
    return getDebt(organizationId, id);
  });
}

function toDebt(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    number: Number(row.number),
    technicianId: String(row.technician_id),
    technicianName: String(row.technician_name ?? ''),
    inventoryId: (row.inventory_id as string | null) ?? null,
    description: String(row.description),
    totalAmount: money(row.total_amount),
    installments: Number(row.installments),
    firstDueMonth: String(row.first_due_month),
    status: row.status as 'active' | 'canceled',
    createdAt: toIso(row.created_at)!,
    acknowledgedAt: toIso(row.acknowledged_at),
    canceledAt: toIso(row.canceled_at),
    cancelReason: (row.cancel_reason as string | null) ?? null,
  };
}

export async function getDebt(organizationId: string, debtId: unknown, technicianId?: string) {
  if (!isUuid(debtId)) throw new PartsError('Débito inválido.');
  const row = (
    await sql`
      SELECT d.*, t.name AS technician_name FROM part_debts d JOIN technicians t ON t.id = d.technician_id
      WHERE d.id = ${debtId} AND d.organization_id = ${organizationId}
        AND (${technicianId ?? null}::uuid IS NULL OR d.technician_id = ${technicianId ?? null}::uuid)
    `
  )[0];
  if (!row) throw new PartsError('Débito não encontrado.', 404);
  const entries = await sql`
    SELECT installment, amount, due_month, kind FROM part_account_entries
    WHERE debt_id = ${debtId} ORDER BY due_month, installment NULLS LAST
  `;
  return {
    ...toDebt(row),
    schedule: entries
      .filter((entry) => entry.kind === 'debt_installment')
      .map((entry) => ({ installment: Number(entry.installment), amount: money(entry.amount), dueMonth: String(entry.due_month) })),
    canceledAmount: money(-entries.filter((entry) => entry.kind === 'debt_canceled').reduce((sum, entry) => sum + Number(entry.amount), 0)),
  };
}

export async function listDebts(organizationId: string, technicianId?: string | null) {
  const rows = await sql`
    SELECT d.*, t.name AS technician_name FROM part_debts d JOIN technicians t ON t.id = d.technician_id
    WHERE d.organization_id = ${organizationId}
      AND (${technicianId ?? null}::uuid IS NULL OR d.technician_id = ${technicianId ?? null}::uuid)
    ORDER BY d.created_at DESC
    LIMIT 300
  `;
  return rows.map(toDebt);
}

/**
 * Cancels the installments from `fromMonth` on (default: this month) — e.g. the technician brought
 * a police report. Installments of past months stay due.
 */
export async function cancelDebt(organizationId: string, debtId: unknown, input: { reason?: unknown; fromMonth?: unknown }, actor: PartsActor) {
  const debt = await getDebt(organizationId, debtId);
  if (debt.status === 'canceled') throw new PartsError('Este débito já foi cancelado.', 409);
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 500) : '';
  if (!reason) throw new PartsError('Informe o motivo do cancelamento.');
  const fromMonth = isMonthKey(input.fromMonth) ? input.fromMonth : currentMonth();
  const forgiven = debt.schedule.filter((item) => item.dueMonth >= fromMonth);

  await sql.transaction([
    sql`
      UPDATE part_debts SET status = 'canceled', canceled_at = NOW(), canceled_by = ${actor.id}, cancel_reason = ${reason}
      WHERE id = ${debt.id}
    `,
    ...forgiven.map(
      (item) => sql`
        INSERT INTO part_account_entries (organization_id, technician_id, kind, amount, due_month, debt_id, installment, description, created_by)
        VALUES (
          ${organizationId}, ${debt.technicianId}, 'debt_canceled', ${-item.amount}, ${item.dueMonth}, ${debt.id}, ${item.installment},
          ${`Parcela ${item.installment}/${debt.installments} cancelada: ${reason}`}, ${actor.id}
        )
      `,
    ),
  ]);
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.debt_canceled', targetType: 'part_debt', targetId: debt.id,
    details: { reason, fromMonth, forgiven: money(forgiven.reduce((sum, item) => sum + item.amount, 0)) },
  });
  return getDebt(organizationId, debt.id);
}

/** The technician acknowledges the debt and its installments in the app (the contract's trail). */
export async function acknowledgeDebt(organizationId: string, debtId: unknown, technicianId: string, actor: PartsActor, ip: string | null) {
  const debt = await getDebt(organizationId, debtId, technicianId);
  if (!debt.acknowledgedAt) {
    await sql`
      UPDATE part_debts SET acknowledged_at = NOW(), acknowledged_by = ${actor.id}, acknowledged_ip = ${ip}
      WHERE id = ${debt.id} AND acknowledged_at IS NULL
    `;
    await recordAudit({
      organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
      action: 'part.debt_acknowledged', targetType: 'part_debt', targetId: debt.id, details: { ip },
    });
  }
  return getDebt(organizationId, debt.id, technicianId);
}

// ---------------------------------------------------------------- account entries

export async function registerPayment(
  organizationId: string,
  input: { technicianId: unknown; amount: unknown; method: unknown; description?: unknown; month?: unknown },
  actor: PartsActor,
) {
  const technician = await requireTechnician(organizationId, input.technicianId, true);
  const amount = parseAmount(input.amount);
  if (amount === null || amount <= 0) throw new PartsError('Valor do pagamento inválido.');
  if (!isSettlementMethod(input.method)) throw new PartsError('Forma de pagamento inválida.');
  const method: SettlementMethod = input.method;
  const month = isMonthKey(input.month) ? input.month : currentMonth();
  const description =
    (typeof input.description === 'string' && input.description.trim().slice(0, 300)) || `Pagamento — ${SETTLEMENT_METHOD_LABELS[method]}`;
  const id = randomUUID();
  await sql`
    INSERT INTO part_account_entries (id, organization_id, technician_id, kind, amount, due_month, payment_method, description, created_by)
    VALUES (${id}, ${organizationId}, ${technician.id}, 'payment', ${-amount}, ${month}, ${method}, ${description}, ${actor.id})
  `;
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.payment_registered', targetType: 'technician', targetId: technician.id, details: { amount, method, month },
  });
}

/** Manual correction: positive = the technician owes more; negative = credit. */
export async function registerAdjustment(
  organizationId: string,
  input: { technicianId: unknown; amount: unknown; description: unknown; month?: unknown },
  actor: PartsActor,
) {
  const technician = await requireTechnician(organizationId, input.technicianId, true);
  const amount = Number(String(input.amount ?? '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount === 0) throw new PartsError('Informe o valor do ajuste (positivo = deve, negativo = crédito).');
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 300) : '';
  if (!description) throw new PartsError('Informe o motivo do ajuste.');
  const month = isMonthKey(input.month) ? input.month : currentMonth();
  await sql`
    INSERT INTO part_account_entries (organization_id, technician_id, kind, amount, due_month, description, created_by)
    VALUES (${organizationId}, ${technician.id}, 'adjustment', ${money(amount)}, ${month}, ${description}, ${actor.id})
  `;
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.account_adjusted', targetType: 'technician', targetId: technician.id, details: { amount: money(amount), month, description },
  });
}

export interface AccountSummaryRow {
  technicianId: string;
  technicianName: string;
  technicianStatus: string;
  /** Owed before the month (carried over). */
  previousBalance: number;
  /** Technician price of the parts sold in the month (net of cancellations). */
  salesInMonth: number;
  installmentsInMonth: number;
  adjustmentsInMonth: number;
  paidInMonth: number;
  /** Everything due up to the end of the month, minus everything paid. */
  balanceDue: number;
  /** Installments of future months, not yet due. */
  futureInstallments: number;
  /** Units the technician has right now and their value at the technician price. */
  stockUnits: number;
  stockValue: number;
}

/** One row per technician with stock or any account activity. */
export async function accountSummary(organizationId: string, month: string, technicianId?: string | null): Promise<AccountSummaryRow[]> {
  const rows = await sql`
    WITH entries AS (
      SELECT technician_id,
        SUM(amount) FILTER (WHERE due_month < ${month}) AS previous_balance,
        SUM(amount) FILTER (WHERE due_month = ${month} AND kind IN ('sale', 'sale_canceled')) AS sales,
        SUM(amount) FILTER (WHERE due_month = ${month} AND kind IN ('debt_installment', 'debt_canceled')) AS installments,
        SUM(amount) FILTER (WHERE due_month = ${month} AND kind = 'adjustment') AS adjustments,
        -SUM(amount) FILTER (WHERE due_month = ${month} AND kind = 'payment') AS paid,
        SUM(amount) FILTER (WHERE due_month <= ${month}) AS balance_due,
        SUM(amount) FILTER (WHERE due_month > ${month} AND kind IN ('debt_installment', 'debt_canceled')) AS future
      FROM part_account_entries
      WHERE organization_id = ${organizationId}
      GROUP BY technician_id
    ),
    stock AS (
      SELECT m.technician_id, SUM(m.quantity)::int AS units
      FROM part_movements m
      WHERE m.organization_id = ${organizationId} AND m.technician_id IS NOT NULL
      GROUP BY m.technician_id
    ),
    stock_value AS (
      SELECT s.technician_id, SUM(s.quantity * p.technician_price) AS value
      FROM (
        SELECT technician_id, part_id, SUM(quantity) AS quantity FROM part_movements
        WHERE organization_id = ${organizationId} AND technician_id IS NOT NULL
        GROUP BY technician_id, part_id
      ) s JOIN parts p ON p.id = s.part_id
      GROUP BY s.technician_id
    )
    SELECT t.id, t.name, t.status, e.*, COALESCE(st.units, 0) AS units, COALESCE(sv.value, 0) AS value
    FROM technicians t
    LEFT JOIN entries e ON e.technician_id = t.id
    LEFT JOIN stock st ON st.technician_id = t.id
    LEFT JOIN stock_value sv ON sv.technician_id = t.id
    WHERE t.organization_id = ${organizationId} AND t.deleted_at IS NULL
      AND (${technicianId ?? null}::uuid IS NULL OR t.id = ${technicianId ?? null}::uuid)
      AND (${technicianId ?? null}::uuid IS NOT NULL OR e.technician_id IS NOT NULL OR COALESCE(st.units, 0) <> 0 OR t.status = 'active')
    ORDER BY lower(t.name)
  `;
  return rows.map((row) => ({
    technicianId: String(row.id),
    technicianName: String(row.name),
    technicianStatus: String(row.status),
    previousBalance: money(row.previous_balance),
    salesInMonth: money(row.sales),
    installmentsInMonth: money(row.installments),
    adjustmentsInMonth: money(row.adjustments),
    paidInMonth: money(row.paid),
    balanceDue: money(row.balance_due),
    futureInstallments: money(row.future),
    stockUnits: Number(row.units),
    stockValue: money(row.value),
  }));
}

/** The entries of one month of a technician's account (the statement). */
export async function accountStatement(organizationId: string, technicianId: string, month: string) {
  const rows = await sql`
    SELECT e.*, s.number AS sale_number, d.number AS debt_number, u.name AS created_by_name
    FROM part_account_entries e
    LEFT JOIN part_sales s ON s.id = e.sale_id
    LEFT JOIN part_debts d ON d.id = e.debt_id
    LEFT JOIN users u ON u.id = e.created_by
    WHERE e.organization_id = ${organizationId} AND e.technician_id = ${technicianId} AND e.due_month = ${month}
    ORDER BY e.created_at
  `;
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as AccountEntryKind,
    kindLabel: ACCOUNT_ENTRY_LABELS[row.kind as AccountEntryKind] ?? String(row.kind),
    amount: money(row.amount),
    description: String(row.description),
    saleId: (row.sale_id as string | null) ?? null,
    saleNumber: row.sale_number === null ? null : Number(row.sale_number),
    debtId: (row.debt_id as string | null) ?? null,
    debtNumber: row.debt_number === null ? null : Number(row.debt_number),
    paymentMethod: (row.payment_method as SettlementMethod | null) ?? null,
    createdAt: toIso(row.created_at)!,
    createdByName: (row.created_by_name as string | null) ?? null,
  }));
}
