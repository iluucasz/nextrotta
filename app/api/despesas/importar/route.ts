import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute, readJson } from '@/lib/expenses-api';
import { cents, isDateKey, parseEntryInput, type EntryInput } from '@/lib/expenses';
import { ExpenseError, importEntries } from '@/lib/expenses-store';

export const runtime = 'nodejs';

const MAX_ROWS = 1000;

function typeOf(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['payable', 'a pagar', 'pagar', 'despesa', 'saída', 'saida'].includes(text)) return 'payable';
  if (['receivable', 'a receber', 'receber', 'receita', 'entrada'].includes(text)) return 'receivable';
  return null;
}

const isPaid = (value: unknown) => ['paid', 'pago', 'paga', 'baixada', 'baixado', 'recebido', 'recebida'].includes(String(value ?? '').trim().toLowerCase());

/** Bills from a spreadsheet, one row each. Rows with a problem are rejected with the line and why; the rest go in. */
export async function POST(request: NextRequest) {
  return expensesRoute(request, async (actor) => {
    const body = await readJson(request);
    const raw = Array.isArray(body.entries) ? (body.entries as Array<Record<string, unknown>>) : [];
    if (!raw.length) throw new ExpenseError('Nenhuma linha para importar.');
    if (raw.length > MAX_ROWS) throw new ExpenseError(`Importe no máximo ${MAX_ROWS} linhas por vez.`);

    const items: Array<{ input: EntryInput; paid_amount: number; paid_at: string | null }> = [];
    const rejected: Array<{ line: number; reason: string }> = [];

    raw.forEach((row, index) => {
      const line = Number(row?.__line ?? index + 1);
      const type = typeOf(row?.type);
      if (!type) return void rejected.push({ line, reason: 'Tipo inválido (use "A pagar" ou "A receber").' });

      const parsed = parseEntryInput({ ...row, type, repeat: 'single', paid_at: null });
      if ('error' in parsed) return void rejected.push({ line, reason: parsed.error });

      const paidAt = String(row?.paid_at ?? '').trim();
      if (paidAt && !isDateKey(paidAt)) return void rejected.push({ line, reason: 'Data do pagamento inválida (use AAAA-MM-DD).' });

      const amount = parsed.entry.amount;
      const informed = row?.paid_amount === undefined || row?.paid_amount === null || row?.paid_amount === '' ? null : cents(row.paid_amount);
      const paid = Math.min(amount, Math.max(0, informed ?? (isPaid(row?.status) ? amount : 0)));
      items.push({ input: parsed.entry, paid_amount: paid, paid_at: paid > 0 ? paidAt || null : null });
    });

    if (!items.length) return NextResponse.json({ error: 'Nenhuma linha válida encontrada.', rejected }, { status: 400 });

    const imported = await importEntries(actor, items);
    return NextResponse.json({ imported, rejected }, { status: 201 });
  });
}
