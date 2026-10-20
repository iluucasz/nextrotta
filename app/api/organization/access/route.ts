import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { getAccessById } from '@/lib/organization-access';
import { getSupportContact } from '@/lib/support-contact';

export const runtime = 'nodejs';

/** The organization's access level (full, read-only until a date, or download only). */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const [access, support] = await Promise.all([getAccessById(auth.organizationId), getSupportContact()]);
  if (!access) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });
  return NextResponse.json({ ...access, support, isAdmin: auth.role === 'admin' });
}
