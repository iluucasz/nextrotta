import { NextResponse } from 'next/server';
import { verifyOrganizationAuth, type OrganizationAuth } from '../auth';
import { blockUnlessFeature } from '../billing/require-feature';
import { MercadoPagoError } from '../mercadopago/client';
import { PartsError, type PartsActor } from './common';

export type PartsContext = {
  auth: OrganizationAuth;
  actor: PartsActor;
  organizationId: string;
  isAdmin: boolean;
  /** Set for technicians: everything they do is limited to their own stock and sales. */
  technicianId: string | null;
};

/**
 * Session + plan check for every Controle de Peças route. `who` says which roles may call it.
 * Returns a response to send back when the request can't go on.
 */
export async function partsContext(request: Request, who: 'admin' | 'technician' | 'any'): Promise<PartsContext | NextResponse> {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || (auth.role !== 'admin' && auth.role !== 'technician')) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }
  const blocked = await blockUnlessFeature(auth.organizationId, 'parts');
  if (blocked) return blocked;

  const isAdmin = auth.role === 'admin';
  if (who === 'admin' && !isAdmin) return NextResponse.json({ error: 'Apenas o administrador.' }, { status: 403 });
  if (who === 'technician' && (isAdmin || !auth.technicianId)) {
    return NextResponse.json({ error: 'Disponível apenas para técnicos.' }, { status: 403 });
  }

  return {
    auth,
    organizationId: auth.organizationId,
    isAdmin,
    technicianId: isAdmin ? null : auth.technicianId ?? null,
    actor: { id: auth.userId, role: auth.impersonationId ? 'platform_owner' : auth.role, impersonationId: auth.impersonationId ?? null },
  };
}

export function partsError(error: unknown, label: string) {
  if (error instanceof PartsError || error instanceof MercadoPagoError) {
    return NextResponse.json({ error: error.message }, { status: error.status >= 400 && error.status < 600 ? error.status : 400 });
  }
  console.error(`[parts] ${label}:`, error);
  return NextResponse.json({ error: 'Erro interno. Tente de novo em instantes.' }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function requestIp(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
}
