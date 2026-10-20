import { NextRequest, NextResponse } from 'next/server';
import { getCapacity } from '@/lib/platform/capacity';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** What the platform has against what the plans promised each organization (Operação → Capacidade). */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getCapacity()));
}
