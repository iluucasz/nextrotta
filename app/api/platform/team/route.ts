import { NextRequest, NextResponse } from 'next/server';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { createTeamMember, listTeam } from '@/lib/platform/team';

export const runtime = 'nodejs';

/** The NextRotta's own team (the owner and the support users). Owner only. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ team: await listTeam() }));
}

/** { name, email } — a new support user ("atendente"); answers with the temporary password, shown only once. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await createTeamMember(await readJson(request), { id: owner.userId }), { status: 201 }));
}
