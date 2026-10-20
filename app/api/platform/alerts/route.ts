import { NextRequest, NextResponse } from 'next/server';
import { listOwnerAlerts } from '@/lib/platform/alerts';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Alerts sent to the owner (Porto screens changed, stuck run, late queue, VPS), newest first. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () =>
    NextResponse.json({ alerts: await listOwnerAlerts(Number(request.nextUrl.searchParams.get('limit') ?? 50) || 50) }),
  );
}
