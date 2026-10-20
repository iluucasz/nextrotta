import { NextResponse } from 'next/server';
import { verifyPlatformOwner, type TokenPayload } from '../auth';
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
    return NextResponse.json({ error: 'Acesso exclusivo do dono da plataforma.' }, { status: 401 });
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

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PlatformError('Corpo da requisição inválido.');
  }
  return body as Record<string, unknown>;
}
