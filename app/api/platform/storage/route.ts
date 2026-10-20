import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/platform/storage-containers';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Storage containers, the organizations in each (or in none), totals and the Vercel account state. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getStorage()));
}
