import { NextRequest, NextResponse } from 'next/server';
import { setAllocation } from '@/lib/platform/allocation';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ organizationId: string }> };

/** { resource, mode: "value"|"plan"|"unlimited", value?, reason } — sets the organization's share. */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { organizationId } = await context.params;
    return NextResponse.json(await setAllocation(organizationId, await readJson(request), { id: owner.userId }));
  });
}
