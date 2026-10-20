import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { getVpsDisk } from '@/lib/platform/vps';

export const runtime = 'nodejs';

/** Disk usage: Docker (images, containers, volumes, build cache), known folders and the old cleanup log. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getVpsDisk()));
}
