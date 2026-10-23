import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { brasiliaDateKey } from '@/lib/formatters';
import type { FinancialEntryStatus, FinancialEntryType } from '@/lib/types';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

type NormalizedEntryPayload = {
  type: FinancialEntryType;
  status: FinancialEntryStatus;
  description: string;
  category: string;
  amount: number;
  due_date: string;
  competence_month: string;
  paid_amount: number;
  paid_at: string | null;
  notes: string | null;
  series_id?: string | null;
  installment_number?: number;
  installment_total?: number;
  is_recurring?: boolean;
};

function roundCurrency(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;

  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

function getTodayKey() {
  // Brasília, not the server's UTC clock: a payment entered at 22:00 must not get tomorrow's date.
  return brasiliaDateKey();
}

function normalizeDateValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value ?? '').slice(0, 10);
}

function normalizeEntryRow<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    amount: roundCurrency(row.amount as number | string | null | undefined),
    paid_amount: roundCurrency(row.paid_amount as number | string | null | undefined),
    due_date: normalizeDateValue(row.due_date),
    paid_at: row.paid_at ? normalizeDateValue(row.paid_at) : null,
    installment_number: Number(row.installment_number ?? 1),
    installment_total: Number(row.installment_total ?? 1),
    is_recurring: Boolean(row.is_recurring),
  };
}

function isEntryType(value: unknown): value is FinancialEntryType {
  return value === 'payable' || value === 'receivable';
}

function isEntryStatus(value: unknown): value is FinancialEntryStatus {
  return value === 'pending' || value === 'paid';
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function clampInteger(value: unknown, min: number, max: number) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue)) return min;
  return Math.min(max, Math.max(min, numericValue));
}

function createDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addMonths(dateKey: string, offset: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const targetMonthIndex = month - 1 + offset;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonthIndex + 1, 0).getDate();

  return createDateKey(targetYear, normalizedMonthIndex + 1, Math.min(day, lastDay));
}

function splitInstallmentAmounts(totalAmount: number, count: number) {
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;

  return Array.from({ length: count }, (_, index) => (baseCents + (index < remainder ? 1 : 0)) / 100);
}

function normalizePayload(payload: Record<string, unknown>) {
  const type = String(payload.type ?? '');
  const rawStatus = String(payload.status ?? 'pending');
  const description = String(payload.description ?? '').trim();
  const category = String(payload.category ?? '').trim() || 'Geral';
  const amount = roundCurrency(payload.amount as number | string | null | undefined);
  const dueDate = String(payload.due_date ?? '').trim();
  const competenceMonth = String(payload.competence_month ?? dueDate.slice(0, 7)).trim();
  const notes = String(payload.notes ?? '').trim();
  const paidAt = String(payload.paid_at ?? '').trim();
  const rawPaidAmount = payload.paid_amount === undefined || payload.paid_amount === null || payload.paid_amount === ''
    ? rawStatus === 'paid'
      ? amount
      : 0
    : roundCurrency(payload.paid_amount as number | string | null | undefined);

  if (!isEntryType(type)) {
    return { error: 'Tipo financeiro inválido.' };
  }

  if (!isEntryStatus(rawStatus)) {
    return { error: 'Status financeiro inválido.' };
  }

  if (!description) {
    return { error: 'Informe a descrição da conta.' };
  }

  if (amount <= 0) {
    return { error: 'Informe um valor maior que zero.' };
  }

  if (!isDateKey(dueDate)) {
    return { error: 'Informe uma data de vencimento válida.' };
  }

  if (!/^\d{4}-\d{2}$/.test(competenceMonth)) {
    return { error: 'Informe a competência no formato AAAA-MM.' };
  }

  if (paidAt && !isDateKey(paidAt)) {
    return { error: 'Informe uma data de baixa válida.' };
  }

  const paidAmount = roundCurrency(Math.min(amount, Math.max(0, rawPaidAmount)));
  const status: FinancialEntryStatus = paidAmount >= amount ? 'paid' : 'pending';

  return {
    entry: {
      type,
      status,
      description,
      category,
      amount,
      due_date: dueDate,
      competence_month: competenceMonth,
      paid_amount: status === 'paid' ? amount : paidAmount,
      paid_at: paidAmount > 0 || status === 'paid' ? paidAt || getTodayKey() : null,
      notes: notes || null,
      series_id: typeof payload.series_id === 'string' && payload.series_id ? payload.series_id : null,
      installment_number: clampInteger(payload.installment_number, 1, 999),
      installment_total: clampInteger(payload.installment_total, 1, 999),
      is_recurring: Boolean(payload.is_recurring),
    } satisfies NormalizedEntryPayload,
  };
}

function createSeriesEntries(baseEntry: NormalizedEntryPayload, payload: Record<string, unknown>) {
  const billingMode = String(payload.billing_mode ?? 'single');
  const isInstallmentMode = billingMode === 'installments';
  const isRecurringMode = billingMode === 'recurring';
  const count = isInstallmentMode
    ? clampInteger(payload.installments_count, 2, 120)
    : isRecurringMode
      ? clampInteger(payload.recurring_months, 2, 120)
      : 1;
  const seriesId = count > 1 ? randomUUID() : null;
  const amounts = isInstallmentMode ? splitInstallmentAmounts(baseEntry.amount, count) : Array.from({ length: count }, () => baseEntry.amount);

  if (count === 1) {
    return [{
      ...baseEntry,
      id: randomUUID(),
      series_id: baseEntry.series_id ?? null,
      installment_number: 1,
      installment_total: 1,
      is_recurring: false,
    }];
  }

  return Array.from({ length: count }, (_, index) => {
    const dueDate = addMonths(baseEntry.due_date, index);

    return {
      ...baseEntry,
      id: randomUUID(),
      amount: roundCurrency(amounts[index]),
      status: 'pending' as FinancialEntryStatus,
      paid_amount: 0,
      paid_at: null,
      due_date: dueDate,
      competence_month: dueDate.slice(0, 7),
      series_id: seriesId,
      installment_number: index + 1,
      installment_total: count,
      is_recurring: isRecurringMode,
    };
  });
}

async function requireAdmin(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  return auth?.role === 'admin' ? auth : null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'finance');
    if (featureBlocked) return featureBlocked;

    const { searchParams } = new URL(request.url);
    const competenceMonth = searchParams.get('competenceMonth');
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    let query = `
      SELECT id, type, description, category, amount, due_date, competence_month,
             status, paid_amount, paid_at, series_id, installment_number,
             installment_total, is_recurring, notes, created_at, updated_at
      FROM financial_entries
    `;
    const params: string[] = [auth.organizationId];
    const conditions: string[] = ['organization_id = $1', 'deleted_at IS NULL'];

    if (competenceMonth && /^\d{4}-\d{2}$/.test(competenceMonth)) {
      params.push(competenceMonth);
      conditions.push(`competence_month = $${params.length}`);
    }

    if (isEntryType(type)) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    if (isEntryStatus(status)) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    query += ` WHERE ${conditions.join(' AND ')}`;

    query += `
      ORDER BY
        CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
        due_date ASC,
        created_at DESC
    `;

    const entries = await sql.query(query, params);
    return NextResponse.json({ entries: entries.map((row) => normalizeEntryRow(row as Record<string, unknown>)) });
  } catch (error) {
    console.error('[finance] Get entries error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'finance');
    if (featureBlocked) return featureBlocked;

    const payload = await request.json();
    const parsed = normalizePayload(payload);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const rows = createSeriesEntries(parsed.entry, payload);
    const result = await sql.query(
      `
        INSERT INTO financial_entries (
          organization_id, id, type, description, category, amount, due_date,
          competence_month, status, paid_amount, paid_at, series_id,
          installment_number, installment_total, is_recurring, notes
        )
        SELECT $2, id, type, description, category, amount, due_date,
               competence_month, status, paid_amount, paid_at, series_id,
               installment_number, installment_total, is_recurring, notes
        FROM jsonb_to_recordset($1::jsonb) AS item(
          id text,
          type varchar(16),
          description text,
          category text,
          amount numeric,
          due_date date,
          competence_month varchar(7),
          status varchar(16),
          paid_amount numeric,
          paid_at date,
          series_id text,
          installment_number integer,
          installment_total integer,
          is_recurring boolean,
          notes text
        )
        RETURNING *
      `,
      [JSON.stringify(rows), auth.organizationId],
    );
    const entries = result.map((row) => normalizeEntryRow(row as Record<string, unknown>));

    if (entries.length === 1) {
      return NextResponse.json(entries[0], { status: 201 });
    }

    return NextResponse.json({ entries }, { status: 201 });
  } catch (error) {
    console.error('[finance] Create entry error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'finance');
    if (featureBlocked) return featureBlocked;

    const payload = await request.json();
    const id = String(payload.id ?? '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Financial entry id is required' }, { status: 400 });
    }

    const parsed = normalizePayload(payload);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const entry = parsed.entry;
    const result = await sql`
      UPDATE financial_entries
      SET type = ${entry.type},
          description = ${entry.description},
          category = ${entry.category},
          amount = ${entry.amount},
          due_date = ${entry.due_date},
          competence_month = ${entry.competence_month},
          status = ${entry.status},
          paid_amount = ${entry.paid_amount},
          paid_at = ${entry.paid_at},
          series_id = ${entry.series_id},
          installment_number = ${entry.installment_number},
          installment_total = ${entry.installment_total},
          is_recurring = ${entry.is_recurring},
          notes = ${entry.notes},
          updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      RETURNING *
    `;

    if (!result.length) {
      return NextResponse.json({ error: 'Financial entry not found' }, { status: 404 });
    }

    return NextResponse.json(normalizeEntryRow(result[0] as Record<string, unknown>));
  } catch (error) {
    console.error('[finance] Update entry error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'finance');
    if (featureBlocked) return featureBlocked;

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Financial entry id is required' }, { status: 400 });
    }

    const result = await sql`
      UPDATE financial_entries
      SET deleted_at = NOW(), deleted_by = ${auth.userId}, updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      RETURNING id
    `;

    if (!result.length) {
      return NextResponse.json({ error: 'Financial entry not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error('[finance] Delete entry error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
