import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { getLastBackup } from '@/lib/backup/service';
import { sql } from '@/lib/db';
import { getAccessById } from '@/lib/organization-access';
import { getSupportContact } from '@/lib/support-contact';

export const runtime = 'nodejs';

/** The organization's access level (full, read-only until a date, or download only). */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const [access, support] = await Promise.all([getAccessById(auth.organizationId), getSupportContact()]);
  if (!access) return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 });

  // What the locked page needs: why, what to pay and the copy of the data it can download.
  const locked = access.status === 'suspended' || access.status === 'canceled';
  const [organization] = await sql`SELECT status_reason, status_source FROM organizations WHERE id = ${auth.organizationId}`;
  const [charge] = locked
    ? await sql`
        SELECT value, due_date, invoice_url, description FROM billing_charges
        WHERE organization_id = ${auth.organizationId} AND status = 'OVERDUE'
        ORDER BY due_date ASC LIMIT 1
      `
    : [];
  const lastBackup = locked && auth.role === 'admin' ? await getLastBackup(auth.organizationId).catch(() => null) : null;

  return NextResponse.json({
    ...access,
    support,
    isAdmin: auth.role === 'admin',
    reason: (organization?.status_reason as string | null) ?? null,
    // Only a suspension for non-payment can be undone by paying.
    payment:
      charge && organization?.status_source === 'billing'
        ? { value: Number(charge.value), dueDate: new Date(charge.due_date as string).toISOString().slice(0, 10), invoiceUrl: (charge.invoice_url as string | null) ?? null, description: (charge.description as string | null) ?? null }
        : null,
    lastBackup: lastBackup ? { id: lastBackup.id, kind: lastBackup.kind, createdAt: lastBackup.createdAt } : null,
  });
}
