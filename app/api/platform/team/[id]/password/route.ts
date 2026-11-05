import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { resetTeamPassword } from '@/lib/platform/team';

export const runtime = 'nodejs';

/** A new temporary password for a support user, shown only once; they choose their own at the next access. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    return NextResponse.json(await resetTeamPassword(id, { id: owner.userId }));
  });
}
