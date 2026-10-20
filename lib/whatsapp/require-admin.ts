import type { NextRequest } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';

/**
 * Every WhatsApp route is admin-only. A preview token never passes (its role is `technician`), so
 * an admin previewing a technician can't reach these through the preview session either.
 */
export async function requireWhatsAppAdmin(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  return auth?.role === 'admin' && !auth.preview ? auth : null;
}
