import { NextRequest, NextResponse } from 'next/server';
import { updateOrganizationUser } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string; userId: string }> };

/**
 * { role?: "admin" | "technician", status?: "active" | "inactive", resetPassword?: true }.
 * A password reset returns the new temporary password once.
 */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id, userId } = await context.params;
    return NextResponse.json(await updateOrganizationUser(id, userId, await readJson(request), { id: owner.userId }));
  });
}
