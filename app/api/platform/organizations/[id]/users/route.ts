import { NextRequest, NextResponse } from 'next/server';
import { createOrganizationAdmin, isUuid, listOrganizationUsers, PlatformError } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
    return NextResponse.json({ users: await listOrganizationUsers(id) });
  });
}

/** { name, email } → a new admin and its temporary password, shown once. */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const result = await createOrganizationAdmin(id, await readJson(request), { id: owner.userId });
    return NextResponse.json(result, { status: 201 });
  });
}
