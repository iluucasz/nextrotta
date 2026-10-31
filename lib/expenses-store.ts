// Controle de despesas on the database. Every query filters by the organization; nothing is ever deleted (a bill
// removed is marked deleted and can be restored; a payment undone is marked deleted and the bill is recalculated).
import { randomUUID } from 'crypto';
import { recordAudit } from './audit';
import { sql } from './db';
import { brasiliaDateKey } from './formatters';
import { buildEntryRows, cents, isDateKey, isMonthKey, PAYMENT_METHODS, type EntryInput, type ExpenseEntry, type ExpensePayment } from './expenses';

export type Actor = { organizationId: string; userId: string; role: string; impersonationId?: string | null };

export class ExpenseError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const dateKey = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').slice(0, 10));

function toEntry(row: Record<string, unknown>, payments: ExpensePayment[]): ExpenseEntry {
  return {
    id: String(row.id),
    type: row.type === 'receivable' ? 'receivable' : 'payable',
    description: String(row.description ?? ''),
    category: String(row.category ?? 'Geral'),
    supplier: (row.supplier as string | null) ?? null,
    amount: cents(row.amount),
    paid_amount: cents(row.paid_amount),
    due_date: dateKey(row.due_date),
    competence_month: String(row.competence_month ?? '').slice(0, 7),
    status: row.status === 'paid' ? 'paid' : 'pending',
    paid_at: row.paid_at ? dateKey(row.paid_at) : null,
    payment_method: (row.payment_method as string | null) ?? null,
    payment_code: (row.payment_code as string | null) ?? null,
    nature: row.nature === 'fixed' ? 'fixed' : 'variable',
    series_id: (row.series_id as string | null) ?? null,
    installment_number: Number(row.installment_number ?? 1),
    installment_total: Number(row.installment_total ?? 1),
    is_recurring: Boolean(row.is_recurring),
    notes: (row.notes as string | null) ?? null,
    payments,
  };
}

const ENTRY_COLUMNS = `id, type, description, category, supplier, amount, due_date, competence_month, status, paid_amount, paid_at,
  payment_method, payment_code, nature, series_id, installment_number, installment_total, is_recurring, notes`;

async function withPayments(rows: Array<Record<string, unknown>>): Promise<ExpenseEntry[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.id));
  const payments = await sql.query(
    `SELECT id, entry_id, amount, paid_at, method, note FROM financial_payments
     WHERE entry_id = ANY($1::text[]) AND deleted_at IS NULL ORDER BY paid_at, created_at`,
    [ids],
  );
  const byEntry = new Map<string, ExpensePayment[]>();
  for (const payment of payments) {
    const list = byEntry.get(String(payment.entry_id)) ?? [];
    list.push({ id: String(payment.id), amount: cents(payment.amount), paid_at: dateKey(payment.paid_at), method: (payment.method as string | null) ?? null, note: (payment.note as string | null) ?? null });
    byEntry.set(String(payment.entry_id), list);
  }
  return rows.map((row) => toEntry(row, byEntry.get(String(row.id)) ?? []));
}

/** The bills due in [from, to], plus everything still open from before `from` (a late bill never drops off the screen). */
export async function listEntries(organizationId: string, from: string, to: string): Promise<ExpenseEntry[]> {
  if (!isDateKey(from) || !isDateKey(to)) throw new ExpenseError('Período inválido.');
  const rows = await sql.query(
    `SELECT ${ENTRY_COLUMNS} FROM financial_entries
     WHERE organization_id = $1 AND deleted_at IS NULL
       AND ((due_date BETWEEN $2 AND $3) OR (status = 'pending' AND due_date < $2))
     ORDER BY due_date, description`,
    [organizationId, from, to],
  );
  return withPayments(rows);
}

async function loadEntries(organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await sql.query(`SELECT ${ENTRY_COLUMNS} FROM financial_entries WHERE organization_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL ORDER BY due_date`, [organizationId, ids]);
  return withPayments(rows);
}

async function audit(actor: Actor, action: string, targetId: string, details: Record<string, unknown>) {
  await recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorRole: actor.impersonationId ? 'platform_owner' : actor.role,
    impersonationId: actor.impersonationId ?? null,
    action,
    targetType: 'financial_entry',
    targetId,
    details,
  });
}

type NewRow = ReturnType<typeof buildEntryRows>[number] & { id: string; series_id: string | null };

async function insertRows(organizationId: string, rows: NewRow[]) {
  await sql.query(
    `INSERT INTO financial_entries (
       organization_id, id, type, description, category, supplier, amount, due_date, competence_month, status, paid_amount,
       payment_method, payment_code, nature, series_id, installment_number, installment_total, is_recurring, notes
     )
     SELECT $2, id, type, description, category, supplier, amount, due_date, competence_month, 'pending', 0,
            payment_method, payment_code, nature, series_id, installment_number, installment_total, is_recurring, notes
     FROM jsonb_to_recordset($1::jsonb) AS item(
       id text, type varchar(16), description text, category text, supplier text, amount numeric, due_date date,
       competence_month varchar(7), payment_method text, payment_code text, nature varchar(16), series_id text,
       installment_number integer, installment_total integer, is_recurring boolean, notes text
     )`,
    [JSON.stringify(rows), organizationId],
  );
}

export async function createEntries(actor: Actor, input: EntryInput): Promise<ExpenseEntry[]> {
  const seriesId = input.repeat === 'single' ? null : randomUUID();
  const rows = buildEntryRows(input).map((row) => ({ ...row, id: randomUUID(), series_id: seriesId }));
  await insertRows(actor.organizationId, rows);

  await audit(actor, 'expense.created', rows[0].id, { description: input.description, amount: input.amount, count: rows.length, repeat: input.repeat });

  // "Já foi paga": the single bill is born paid, with its payment on record.
  if (input.paid_at && rows.length === 1) {
    await addPayment(actor, rows[0].id, { amount: rows[0].amount, paid_at: input.paid_at, method: input.payment_method, note: null });
  }
  return loadEntries(actor.organizationId, rows.map((row) => row.id));
}

/** A spreadsheet's worth of bills at once; the ones that came with an amount paid get that payment on record. */
export async function importEntries(actor: Actor, items: Array<{ input: EntryInput; paid_amount: number; paid_at: string | null }>) {
  if (!items.length) return 0;
  const rows = items.map((item) => ({ ...buildEntryRows({ ...item.input, repeat: 'single', repeat_count: 1 })[0], id: randomUUID(), series_id: null }));
  await insertRows(actor.organizationId, rows);

  const payments = items.flatMap((item, index) =>
    item.paid_amount > 0 ? [{ entry_id: rows[index].id, amount: Math.min(cents(item.paid_amount), rows[index].amount), paid_at: item.paid_at ?? brasiliaDateKey(), method: item.input.payment_method }] : [],
  );
  if (payments.length) {
    await sql.query(
      `INSERT INTO financial_payments (organization_id, entry_id, amount, paid_at, method, created_by)
       SELECT $2, entry_id, amount, paid_at, method, $3 FROM jsonb_to_recordset($1::jsonb) AS item(entry_id text, amount numeric, paid_at date, method text)`,
      [JSON.stringify(payments), actor.organizationId, actor.userId],
    );
    await recalculate(actor.organizationId, payments.map((payment) => payment.entry_id));
  }

  await audit(actor, 'expense.imported', rows[0].id, { count: rows.length });
  return rows.length;
}

export type EntryPatch = Partial<Pick<EntryInput, 'description' | 'category' | 'supplier' | 'amount' | 'due_date' | 'competence_month' | 'payment_method' | 'payment_code' | 'nature' | 'notes'>>;
export type SeriesScope = 'this' | 'following' | 'all';

/** Re-reads a bill's payments and rewrites what the bill caches from them (paid amount, status, last date and method). */
async function recalculate(organizationId: string, ids: string[]) {
  const live = `FROM financial_payments p WHERE p.entry_id = e.id AND p.deleted_at IS NULL`;
  await sql.query(
    `UPDATE financial_entries e
     SET paid_amount = COALESCE((SELECT SUM(p.amount) ${live}), 0),
         status = CASE WHEN COALESCE((SELECT SUM(p.amount) ${live}), 0) >= e.amount THEN 'paid' ELSE 'pending' END,
         paid_at = (SELECT MAX(p.paid_at) ${live}),
         payment_method = COALESCE((SELECT p.method ${live} AND p.method IS NOT NULL ORDER BY p.paid_at DESC, p.created_at DESC LIMIT 1), e.payment_method),
         updated_at = NOW()
     WHERE e.organization_id = $1 AND e.id = ANY($2::text[])`,
    [organizationId, ids],
  );
}

async function scopeIds(organizationId: string, id: string, scope: SeriesScope): Promise<{ base: ExpenseEntry; ids: string[] }> {
  const [base] = await loadEntries(organizationId, [id]);
  if (!base) throw new ExpenseError('Conta não encontrada.', 404);
  if (scope === 'this' || !base.series_id) return { base, ids: [id] };

  const rows = await sql.query(
    `SELECT id FROM financial_entries
     WHERE organization_id = $1 AND series_id = $2 AND deleted_at IS NULL AND ($3::boolean OR installment_number >= $4)`,
    [organizationId, base.series_id, scope === 'all', base.installment_number],
  );
  return { base, ids: rows.map((row) => String(row.id)) };
}

export async function updateEntry(actor: Actor, id: string, patch: EntryPatch, scope: SeriesScope): Promise<ExpenseEntry[]> {
  const { base, ids } = await scopeIds(actor.organizationId, id, scope);

  const next = {
    description: patch.description?.trim() || base.description,
    category: patch.category?.trim() || base.category,
    supplier: patch.supplier === undefined ? base.supplier : patch.supplier?.trim() || null,
    amount: patch.amount === undefined ? base.amount : cents(patch.amount),
    due_date: patch.due_date ?? base.due_date,
    competence_month: patch.competence_month ?? (patch.due_date ? patch.due_date.slice(0, 7) : base.competence_month),
    payment_method: patch.payment_method === undefined ? base.payment_method : patch.payment_method,
    payment_code: patch.payment_code === undefined ? base.payment_code : patch.payment_code,
    nature: patch.nature ?? base.nature,
    notes: patch.notes === undefined ? base.notes : patch.notes,
  };

  if (!(next.amount > 0)) throw new ExpenseError('Informe um valor maior que zero.');
  if (!isDateKey(next.due_date)) throw new ExpenseError('Informe uma data de vencimento válida.');
  if (!isMonthKey(next.competence_month)) throw new ExpenseError('A competência precisa ser um mês válido (AAAA-MM).');
  if (next.amount < base.paid_amount) {
    throw new ExpenseError(`O valor não pode ser menor que o já pago (R$ ${base.paid_amount.toFixed(2).replace('.', ',')}). Desfaça um pagamento antes.`);
  }
  if (next.payment_method && !PAYMENT_METHODS.some((item) => item.value === next.payment_method)) next.payment_method = null;

  // The bill being edited takes every field; the rest of the series only the shared ones (never its own date or code),
  // and an amount only where it does not drop below what that installment already paid.
  await sql`
    UPDATE financial_entries
    SET description = ${next.description}, category = ${next.category}, supplier = ${next.supplier}, amount = ${next.amount},
        due_date = ${next.due_date}, competence_month = ${next.competence_month}, payment_method = ${next.payment_method},
        payment_code = ${next.payment_code}, nature = ${next.nature}, notes = ${next.notes},
        status = CASE WHEN paid_amount >= ${next.amount} THEN 'paid' ELSE 'pending' END, updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${actor.organizationId} AND deleted_at IS NULL
  `;
  const others = ids.filter((other) => other !== id);
  if (others.length) {
    await sql.query(
      `UPDATE financial_entries
       SET description = $3, category = $4, supplier = $5, payment_method = $6, nature = $7, notes = $8,
           amount = CASE WHEN paid_amount <= $9::numeric THEN $9::numeric ELSE amount END,
           status = CASE WHEN paid_amount >= (CASE WHEN paid_amount <= $9::numeric THEN $9::numeric ELSE amount END) THEN 'paid' ELSE 'pending' END,
           updated_at = NOW()
       WHERE organization_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
      [actor.organizationId, others, next.description, next.category, next.supplier, next.payment_method, next.nature, next.notes, next.amount],
    );
  }

  await audit(actor, 'expense.updated', id, { scope, count: ids.length, description: next.description });
  return loadEntries(actor.organizationId, ids);
}

export async function deleteEntries(actor: Actor, id: string, scope: SeriesScope): Promise<string[]> {
  const { ids } = await scopeIds(actor.organizationId, id, scope);
  await sql.query(
    `UPDATE financial_entries SET deleted_at = NOW(), deleted_by = $3, updated_at = NOW()
     WHERE organization_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL`,
    [actor.organizationId, ids, actor.userId],
  );
  await audit(actor, 'expense.deleted', id, { scope, count: ids.length });
  return ids;
}

export async function restoreEntries(actor: Actor, ids: string[]): Promise<ExpenseEntry[]> {
  await sql.query(
    `UPDATE financial_entries SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
     WHERE organization_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NOT NULL`,
    [actor.organizationId, ids],
  );
  if (ids.length) await audit(actor, 'expense.restored', ids[0], { count: ids.length });
  return loadEntries(actor.organizationId, ids);
}

export type PaymentInput = { amount: number; paid_at: string; method: string | null; note: string | null };

/** Records a payment (or a receipt) on a bill. It never takes more than what is still open. */
export async function addPayment(actor: Actor, entryId: string, input: PaymentInput): Promise<ExpenseEntry> {
  const amount = cents(input.amount);
  if (!(amount > 0)) throw new ExpenseError('Informe um valor maior que zero.');
  if (!isDateKey(input.paid_at)) throw new ExpenseError('Informe uma data válida.');
  const method = PAYMENT_METHODS.some((item) => item.value === input.method) ? input.method : null;

  // One statement checks the open balance and inserts, so two people paying at once cannot overpay.
  const inserted = await sql`
    INSERT INTO financial_payments (organization_id, entry_id, amount, paid_at, method, note, created_by)
    SELECT ${actor.organizationId}, e.id, ${amount}, ${input.paid_at}, ${method}, ${input.note?.trim().slice(0, 300) || null}, ${actor.userId}
    FROM financial_entries e
    WHERE e.id = ${entryId} AND e.organization_id = ${actor.organizationId} AND e.deleted_at IS NULL
      AND e.amount - COALESCE((SELECT SUM(p.amount) FROM financial_payments p WHERE p.entry_id = e.id AND p.deleted_at IS NULL), 0) >= ${amount}
    RETURNING id
  `;

  if (!inserted.length) {
    const [entry] = await loadEntries(actor.organizationId, [entryId]);
    if (!entry) throw new ExpenseError('Conta não encontrada.', 404);
    const open = cents(entry.amount - entry.paid_amount);
    throw new ExpenseError(open <= 0 ? 'Esta conta já está paga.' : `O valor passa do que falta (R$ ${open.toFixed(2).replace('.', ',')}).`, 409);
  }

  await recalculate(actor.organizationId, [entryId]);
  await audit(actor, 'expense.paid', entryId, { amount, paid_at: input.paid_at, method });
  const [entry] = await loadEntries(actor.organizationId, [entryId]);
  return entry;
}

/** Undoes one payment: it is marked deleted and the bill goes back to what the remaining payments say. */
export async function undoPayment(actor: Actor, paymentId: string): Promise<ExpenseEntry> {
  const rows = await sql`
    UPDATE financial_payments SET deleted_at = NOW(), deleted_by = ${actor.userId}
    WHERE id = ${paymentId} AND organization_id = ${actor.organizationId} AND deleted_at IS NULL
    RETURNING entry_id, amount
  `;
  if (!rows.length) throw new ExpenseError('Pagamento não encontrado.', 404);

  const entryId = String(rows[0].entry_id);
  await recalculate(actor.organizationId, [entryId]);
  await audit(actor, 'expense.payment_undone', entryId, { amount: cents(rows[0].amount) });
  const [entry] = await loadEntries(actor.organizationId, [entryId]);
  return entry;
}

/** Pays what is left of each bill, today or on the given date (the "mark as paid" of a selection). */
export async function payMany(actor: Actor, ids: string[], paidAt: string, method: string | null): Promise<ExpenseEntry[]> {
  const entries = await loadEntries(actor.organizationId, ids);
  const done: string[] = [];
  for (const entry of entries) {
    const open = cents(entry.amount - entry.paid_amount);
    if (open <= 0) continue;
    try {
      await addPayment(actor, entry.id, { amount: open, paid_at: paidAt, method: method ?? entry.payment_method, note: null });
      done.push(entry.id);
    } catch (error) {
      if (!(error instanceof ExpenseError)) throw error;
    }
  }
  return loadEntries(actor.organizationId, done);
}

export async function listBudgets(organizationId: string): Promise<Array<{ category: string; amount: number }>> {
  const rows = await sql`SELECT category, amount FROM finance_budgets WHERE organization_id = ${organizationId} ORDER BY category`;
  return rows.map((row) => ({ category: String(row.category), amount: cents(row.amount) }));
}

export async function saveBudgets(actor: Actor, budgets: Array<{ category: string; amount: number }>) {
  const clean = budgets
    .map((item) => ({ category: String(item.category ?? '').trim().slice(0, 60), amount: cents(item.amount) }))
    .filter((item) => item.category && item.amount >= 0 && item.amount < 1e10);
  if (!clean.length) return listBudgets(actor.organizationId);

  await sql.query(
    `INSERT INTO finance_budgets (organization_id, category, amount, updated_at, updated_by)
     SELECT $2, category, amount, NOW(), $3 FROM jsonb_to_recordset($1::jsonb) AS item(category text, amount numeric)
     ON CONFLICT (organization_id, category) DO UPDATE SET amount = EXCLUDED.amount, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(clean), actor.organizationId, actor.userId],
  );
  await audit(actor, 'expense.budget_saved', 'budget', { categories: clean.length });
  return listBudgets(actor.organizationId);
}
