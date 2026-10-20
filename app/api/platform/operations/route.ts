import { NextRequest, NextResponse } from 'next/server';
import { getOperations } from '@/lib/platform/operations';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Worker health, recent runs, per-organization integrations and storage, database size. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getOperations()));
}
