import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { createBugReport, listBugReports } from '@/lib/platform/bugs';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

function failure(error: unknown, label: string) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[${label}] error:`, error);
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
}

/** Problems reported in this organization: the admin sees all of them, everyone else their own. */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const bugs = await listBugReports({ organizationId: auth.organizationId, userId: auth.role === 'admin' ? null : auth.userId });
    return NextResponse.json({ bugs });
  } catch (error) {
    return failure(error, 'bug-reports');
  }
}

/** { title, description, pageUrl?, userAgent?, appVersion?, screenshot? (data URL) } */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const created = await createBugReport({ organizationId: auth.organizationId, userId: auth.userId }, body ?? {});
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return failure(error, 'bug-reports');
  }
}
