import { NextRequest, NextResponse } from 'next/server';
import { listAuditEvents } from '@/lib/audit';
import { isUuid, PlatformError } from '@/lib/platform/organizations';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?organizationId=…&action=prefix&before=ISO&limit=50 — newest first. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const params = request.nextUrl.searchParams;
    const organizationId = params.get('organizationId');
    if (organizationId && !isUuid(organizationId)) throw new PlatformError('Organização inválida.');

    const events = await listAuditEvents({
      organizationId,
      action: params.get('action'),
      before: params.get('before'),
      limit: Number(params.get('limit')) || 50,
    });
    return NextResponse.json({ events });
  });
}
