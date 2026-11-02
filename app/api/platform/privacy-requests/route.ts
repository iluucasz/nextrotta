import { NextRequest, NextResponse } from 'next/server';
import { listPrivacyRequests } from '@/lib/privacy/requests';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Data-subject requests, open ones first by deadline. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ requests: await listPrivacyRequests() }));
}
