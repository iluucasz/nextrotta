import { NextRequest, NextResponse } from 'next/server';
import { createContainer } from '@/lib/platform/storage-containers';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { name, sizeGb, reservePercent, notes? } — opens a storage container. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await createContainer(await readJson(request), { id: owner.userId })));
}
