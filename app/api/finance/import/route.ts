import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import type { FinancialEntryStatus, FinancialEntryType } from '@/lib/types';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

type ImportRow = {
  id: string;
  type: FinancialEntryType;
  description: string;
  category: string;
  amount: number;
  due_date: string;
  competence_month: string;
  status: FinancialEntryStatus;
  paid_amount: number;
  paid_at: string | null;
  series_id: string | null;
  installment_number: number;
  installment_total: number;
  is_recurring: boolean;
  notes: string | null;
};

function roundCurrency(value: number | string | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round((numericValue + Number.EPSILON) * 100) / 100;
}

function getTodayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime());
}

function parseType(value: unknown): FinancialEntryType | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'payable' || normalized === 'a pagar' || normalized === 'pagar' || normalized === 'despesa') return 'payable';
  if (normalized === 'receivable' || normalized === 'a receber' || normalized === 'receber' || normalized === 'receita') return 'receivable';
  return null;
}

function parseStatus(value: unknown): FinancialEntryStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'paid' || normalized === 'baixada' || normalized === 'baixado' || normalized === 'pago' || normalized === 'recebido') return 'paid';
  return 'pending';
}

async function requireAdmin(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  return auth?.role === 'admin' ? auth : null;
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
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];

    if (!rawEntries.length) {
      return NextResponse.json({ error: 'Nenhuma linha para importar.' }, { status: 400 });
    }

    const rows: ImportRow[] = [];
    const rejected: { line: number; reason: string }[] = [];

    rawEntries.forEach((raw: Record<string, unknown>, index: number) => {
      const line = Number(raw?.__line ?? index + 1);
      const type = parseType(raw?.type);
      const description = String(raw?.description ?? '').trim();
      const category = String(raw?.category ?? '').trim() || 'Geral';
      const amount = roundCurrency(raw?.amount as number | string | null | undefined);
      const dueDate = String(raw?.due_date ?? '').trim();
      const competenceMonth = String(raw?.competence_month ?? dueDate.slice(0, 7)).trim();
      const notes = String(raw?.notes ?? '').trim();
      const paidAtRaw = String(raw?.paid_at ?? '').trim();

      if (!type) {
        rejected.push({ line, reason: 'Tipo inválido (use "A pagar" ou "A receber").' });
        return;
      }
      if (!description) {
        rejected.push({ line, reason: 'Descrição obrigatória.' });
        return;
      }
      if (amount <= 0) {
        rejected.push({ line, reason: 'Valor deve ser maior que zero.' });
        return;
      }
      if (!isDateKey(dueDate)) {
        rejected.push({ line, reason: 'Vencimento inválido (use AAAA-MM-DD).' });
        return;
      }
      if (!/^\d{4}-\d{2}$/.test(competenceMonth)) {
        rejected.push({ line, reason: 'Competência inválida (use AAAA-MM).' });
        return;
      }
      if (paidAtRaw && !isDateKey(paidAtRaw)) {
        rejected.push({ line, reason: 'Data da baixa inválida (use AAAA-MM-DD).' });
        return;
      }

      const status = parseStatus(raw?.status);
      const rawPaidAmount = raw?.paid_amount === undefined || raw?.paid_amount === null || raw?.paid_amount === ''
        ? status === 'paid'
          ? amount
          : 0
        : roundCurrency(raw?.paid_amount as number | string | null | undefined);
      const paidAmount = roundCurrency(Math.min(amount, Math.max(0, rawPaidAmount)));
      const finalStatus: FinancialEntryStatus = paidAmount >= amount ? 'paid' : 'pending';

      rows.push({
        id: randomUUID(),
        type,
        description,
        category,
        amount,
        due_date: dueDate,
        competence_month: competenceMonth,
        status: finalStatus,
        paid_amount: finalStatus === 'paid' ? amount : paidAmount,
        paid_at: paidAmount > 0 || finalStatus === 'paid' ? paidAtRaw || getTodayKey() : null,
        series_id: null,
        installment_number: 1,
        installment_total: 1,
        is_recurring: false,
        notes: notes || null,
      });
    });

    if (!rows.length) {
      return NextResponse.json(
        { error: 'Nenhuma linha válida encontrada.', rejected },
        { status: 400 },
      );
    }

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

    return NextResponse.json({
      entries: result,
      imported: result.length,
      rejected,
    }, { status: 201 });
  } catch (error) {
    console.error('[finance/import] Import error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
