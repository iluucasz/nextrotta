import { NextRequest, NextResponse } from 'next/server';
import { getCase, getCaseConversations, getCaseEvents, updateCase } from '@/lib/cases/store';
import { readJson, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** A case with its history and the conversations gathered in it. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformStaff(request, async () => {
    const { id } = await context.params;
    const [found, events, conversations] = await Promise.all([getCase(id), getCaseEvents(id), getCaseConversations(id)]);
    return NextResponse.json({ case: found, events, conversations });
  });
}

/** { status?, priority?, ownerId? (null = nobody), subject?, description? } */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformStaff(request, async (staff) => {
    const { id } = await context.params;
    const updated = await updateCase(id, await readJson(request), { id: staff.userId, role: staff.role });
    return NextResponse.json({ case: updated, events: await getCaseEvents(id) });
  });
}
