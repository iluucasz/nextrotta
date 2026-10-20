import { NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '../auth';
import { PlatformError } from '../platform/errors';
import type { AssistantUser } from './assistant';

/** The organization's admin (or the owner inside it): the assistant reads company-wide data. */
export async function assistantUser(request: Request): Promise<AssistantUser | null> {
  const auth = await verifyOrganizationAuth(request);
  if (!auth || auth.role !== 'admin') return null;
  return { organizationId: auth.organizationId, userId: auth.userId, impersonating: Boolean(auth.impersonationId) };
}

export function assistantFailure(error: unknown) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[assistant] error:', error);
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
}
