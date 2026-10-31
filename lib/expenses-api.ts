import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from './auth';
import { blockUnlessFeature } from './billing/require-feature';
import { ExpenseError, type Actor } from './expenses-store';

/**
 * Every Controle de despesas route: admin only, the plan must include the feature, and an ExpenseError becomes a
 * response with its own message and status (anything else is logged and answered as a generic error).
 */
export async function expensesRoute(request: NextRequest, run: (actor: Actor) => Promise<NextResponse>) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const blocked = await blockUnlessFeature(auth.organizationId, 'finance');
    if (blocked) return blocked;

    return await run({ organizationId: auth.organizationId, userId: auth.userId, role: auth.role, impersonationId: auth.impersonationId ?? null });
  } catch (error) {
    if (error instanceof ExpenseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[despesas] error:', error);
    return NextResponse.json({ error: 'Não foi possível concluir. Tente de novo.' }, { status: 500 });
  }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ExpenseError('Pedido inválido.');
  return body as Record<string, unknown>;
}
