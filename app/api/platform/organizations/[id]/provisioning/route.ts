import { NextRequest, NextResponse } from 'next/server';
import { getProvisioning, isUuid, PlatformError, runProvisioning } from '@/lib/platform/organizations';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Current state of each step — polled by the progress screen while a run is going. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    const provisioning = isUuid(id) ? await getProvisioning(id) : null;
    if (!provisioning) throw new PlatformError('Provisionamento não encontrado.', 404);
    return NextResponse.json({ provisioning });
  });
}

/**
 * Runs (or resumes from the failed step) the provisioning. The response carries the admin's
 * temporary password only when this run created the admin — it is not stored anywhere readable.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    return NextResponse.json(await runProvisioning(id, { id: owner.userId }));
  });
}
