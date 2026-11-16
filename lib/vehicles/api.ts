import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { VehicleError, type Actor } from './store';

/** Every Carros route: admin only; a VehicleError becomes a response with its own message and status. */
export async function vehiclesRoute(request: NextRequest, run: (actor: Actor) => Promise<NextResponse>) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    return await run({ organizationId: auth.organizationId, userId: auth.userId, role: auth.role, impersonationId: auth.impersonationId ?? null });
  } catch (error) {
    if (error instanceof VehicleError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[carros] error:', error);
    return NextResponse.json({ error: 'Não foi possível concluir. Tente de novo.' }, { status: 500 });
  }
}

export async function readJson(request: NextRequest): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new VehicleError('Pedido inválido.');
  return body as Record<string, unknown>;
}

/** "technicianId" from the body: absent -> undefined (leave as is), empty/null -> null (take the car back), else the id. */
export function technicianFrom(body: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, 'technicianId')) return undefined;
  const value = String(body.technicianId ?? '').trim();
  return value ? value : null;
}
