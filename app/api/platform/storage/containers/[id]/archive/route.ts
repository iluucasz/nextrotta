import { NextRequest, NextResponse } from 'next/server';
import { archiveContainer } from '@/lib/platform/storage-containers';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Archives an empty container (kept in the database). */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    return NextResponse.json(await archiveContainer(id, { id: owner.userId }));
  });
}
