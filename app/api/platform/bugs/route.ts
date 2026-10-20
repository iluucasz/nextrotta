import { NextRequest, NextResponse } from 'next/server';
import { listBugReports } from '@/lib/platform/bugs';
import { isUuid } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?organizationId= — the inbox of reported problems, newest first. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const organizationId = request.nextUrl.searchParams.get('organizationId');
    return NextResponse.json({ bugs: await listBugReports({ organizationId: isUuid(organizationId) ? organizationId : null }) });
  });
}
