import type { NextRequest } from 'next/server';
import { verifyAuth } from './auth';

/**
 * Resolves who may trigger a Porto job route and for which organization. Only an admin session
 * qualifies: the unattended daily runs live on the VPS worker's own schedule, which iterates every
 * organization itself, so there is no secret-based path here (it couldn't name an organization).
 * Runs from here are always manual — forced into dry-run by the caller unless explicitly asked to
 * write.
 */
export async function resolveCronCaller(
  request: NextRequest,
): Promise<{ authorized: false } | { authorized: true; manual: true; organizationId: string }> {
  const auth = await verifyAuth(request);
  if (auth?.role === 'admin' && auth.organizationId) {
    return { authorized: true, manual: true, organizationId: auth.organizationId };
  }

  return { authorized: false };
}
