import { NextRequest, NextResponse } from 'next/server';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { updateTeamMember } from '@/lib/platform/team';

export const runtime = 'nodejs';

/** { name?, email?, status?: 'active' | 'inactive' } — a support user. Making them inactive ends their session on the next request. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    return NextResponse.json({ user: await updateTeamMember(id, await readJson(request), { id: owner.userId }) });
  });
}
