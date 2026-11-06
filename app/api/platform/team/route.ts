import { NextRequest, NextResponse } from 'next/server';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { createTeamMember, listTeam } from '@/lib/platform/team';

export const runtime = 'nodejs';

/** The NextRotta's own team (admins and support users). Admins only. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json({ team: await listTeam(owner.userId) }));
}

/** { name, email, role?: 'platform_support' | 'platform_owner' } — a new support user ("atendente", the default) or admin; answers with the temporary password, shown only once. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await createTeamMember(await readJson(request), { id: owner.userId }), { status: 201 }));
}
