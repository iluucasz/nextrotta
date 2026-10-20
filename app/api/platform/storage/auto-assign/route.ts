import { NextRequest, NextResponse } from 'next/server';
import { autoAssign, getStorage } from '@/lib/platform/storage-containers';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Places every organization without a container in the first one with room (opening new ones as needed). */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const result = await autoAssign({ id: owner.userId });
    return NextResponse.json({ ...result, storage: await getStorage() });
  });
}
