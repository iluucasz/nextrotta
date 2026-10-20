import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { addBugMessage, getBugReport } from '@/lib/platform/bugs';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

type Context = { params: Promise<{ bugId: string }> };

function failure(error: unknown, label: string) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`[${label}] error:`, error);
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
}

async function visibleReport(request: NextRequest, context: Context) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) return null;
  const { bugId } = await context.params;
  const report = await getBugReport(bugId, { kind: 'organization', organizationId: auth.organizationId });
  // Only the admin sees reports from other users of the organization.
  if (auth.role !== 'admin' && report.report.userId !== auth.userId) throw new PlatformError('Relato não encontrado.', 404);
  return { auth, bugId, report };
}

/** The report and its conversation (without the owner's internal notes). */
export async function GET(request: NextRequest, context: Context) {
  try {
    const found = await visibleReport(request, context);
    if (!found) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    return NextResponse.json(found.report);
  } catch (error) {
    return failure(error, 'bug-reports');
  }
}

/** { text } — writes back to the platform's team. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const found = await visibleReport(request, context);
    if (!found) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const result = await addBugMessage(
      found.bugId,
      { userId: found.auth.userId, fromOwner: false, organizationId: found.auth.organizationId },
      { text: body?.text },
    );
    return NextResponse.json(result);
  } catch (error) {
    return failure(error, 'bug-reports');
  }
}
