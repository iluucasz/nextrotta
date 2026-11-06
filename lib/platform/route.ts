import { NextResponse } from 'next/server';
import { verifyPlatformOwner, verifyPlatformStaff, type TokenPayload } from '../auth';
import { PlatformError } from './errors';

/**
 * Wraps a platform-owner API handler: only the owner's own session (never an impersonation) gets
 * in, and a PlatformError becomes a 4xx with its message instead of a 500.
 */
export async function withPlatformOwner(
  request: Request,
  handler: (owner: TokenPayload) => Promise<Response>,
): Promise<Response> {
  const owner = await verifyPlatformOwner(request);
  if (!owner) {
    // A support user is signed in but not allowed here: 403 (not 401, which would send them to the login page).
    const staff = await verifyPlatformStaff(request);
    return NextResponse.json({ error: 'Acesso exclusivo dos admins da plataforma.' }, { status: staff ? 403 : 401 });
  }

  try {
    return await handler(owner);
  } catch (error) {
    if (error instanceof PlatformError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[platform] unexpected error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

/**
 * Wraps a handler open to the NextRotta's own people: the owner and the support users ("atendentes"). Everything not wrapped
 * in this stays owner-only. A handler that must be the owner's for some of its methods calls `requireOwnerRole`.
 */
export async function withPlatformStaff(request: Request, handler: (staff: TokenPayload) => Promise<Response>): Promise<Response> {
  const staff = await verifyPlatformStaff(request);
  if (!staff) return NextResponse.json({ error: 'Acesso restrito à equipe da NextRotta.' }, { status: 401 });
  try {
    return await handler(staff);
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[platform] unexpected error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

export function requireOwnerRole(staff: TokenPayload) {
  if (staff.role !== 'platform_owner') throw new PlatformError('Esta ação é exclusiva dos admins da plataforma.', 403);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PlatformError('Corpo da requisição inválido.');
  }
  return body as Record<string, unknown>;
}
