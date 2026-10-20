import { NextRequest, NextResponse } from 'next/server';
import { setContainerDefaults } from '@/lib/platform/storage-containers';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { sizeGb | null, reservePercent } — size of the containers opened automatically (null = never open one). */
export async function PUT(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await setContainerDefaults(await readJson(request), { id: owner.userId })));
}
