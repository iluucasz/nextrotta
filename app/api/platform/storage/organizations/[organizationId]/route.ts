import { NextRequest, NextResponse } from 'next/server';
import { assignOrganization } from '@/lib/platform/storage-containers';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ organizationId: string }> };

/** { containerId | null, reason } — puts the organization in a container (or takes it out). */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { organizationId } = await context.params;
    return NextResponse.json(await assignOrganization(organizationId, await readJson(request), { id: owner.userId }));
  });
}
