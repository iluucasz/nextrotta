import { NextRequest, NextResponse } from 'next/server';
import { updateContainer } from '@/lib/platform/storage-containers';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** { name?, sizeGb?, reservePercent?, notes? } — never below what its organizations receive. */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    return NextResponse.json(await updateContainer(id, await readJson(request), { id: owner.userId }));
  });
}
