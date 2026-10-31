import { NextRequest, NextResponse } from 'next/server';
import { expensesRoute, readJson } from '@/lib/expenses-api';
import { isDateKey } from '@/lib/expenses';
import { ExpenseError, payMany, restoreEntries } from '@/lib/expenses-store';
import { recordAudit } from '@/lib/audit';
import { sql } from '@/lib/db';
import { brasiliaDateKey } from '@/lib/formatters';

export const runtime = 'nodejs';

const MAX_IDS = 200;

/** Actions on a selection: "pay" (what is left of each), "delete" (each one alone) and "restore" (the undo). */
export async function POST(request: NextRequest) {
  return expensesRoute(request, async (actor) => {
    const body = await readJson(request);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) throw new ExpenseError('Selecione ao menos uma conta.');
    if (ids.length > MAX_IDS) throw new ExpenseError(`Selecione no máximo ${MAX_IDS} contas por vez.`);

    if (body.action === 'pay') {
      const paidAt = String(body.paid_at ?? '').trim() || brasiliaDateKey();
      if (!isDateKey(paidAt)) throw new ExpenseError('Informe uma data válida.');
      const entries = await payMany(actor, ids, paidAt, body.method ? String(body.method) : null);
      return NextResponse.json({ entries });
    }

    if (body.action === 'delete') {
      const rows = await sql.query(
        `UPDATE financial_entries SET deleted_at = NOW(), deleted_by = $3, updated_at = NOW()
         WHERE organization_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL RETURNING id`,
        [actor.organizationId, ids, actor.userId],
      );
      if (rows.length) {
        await recordAudit({
          organizationId: actor.organizationId,
          actorId: actor.userId,
          actorRole: actor.impersonationId ? 'platform_owner' : actor.role,
          impersonationId: actor.impersonationId ?? null,
          action: 'expense.deleted',
          targetType: 'financial_entry',
          targetId: String(rows[0].id),
          details: { scope: 'selection', count: rows.length },
        });
      }
      return NextResponse.json({ ids: rows.map((row) => String(row.id)) });
    }

    if (body.action === 'restore') {
      return NextResponse.json({ entries: await restoreEntries(actor, ids) });
    }

    throw new ExpenseError('Ação inválida.');
  });
}
