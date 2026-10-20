import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { getVpsImages } from '@/lib/platform/vps';

export const runtime = 'nodejs';

/** Docker images: size, age, which containers use them and who owns them. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ images: await getVpsImages() }));
}
