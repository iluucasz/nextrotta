import { NextRequest, NextResponse } from 'next/server';
import { createCase, listCases } from '@/lib/cases/store';
import { readJson, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The cases of the team. ?status=open|all|<status>&owner=me|none|all|<user id>&priority=&q= */
export async function GET(request: NextRequest) {
  return withPlatformStaff(request, async (staff) => {
    const params = request.nextUrl.searchParams;
    const cases = await listCases({ status: params.get('status'), owner: params.get('owner'), priority: params.get('priority'), q: params.get('q') }, staff.userId);
    return NextResponse.json({ cases });
  });
}

/** { conversationId?, subject?, description?, priority?, status?, ownerId?, organizationId?, contactName?, contactPhone?, note? } — a case from a conversation, or by hand. */
export async function POST(request: NextRequest) {
  return withPlatformStaff(request, async (staff) => {
    const created = await createCase(await readJson(request), { id: staff.userId, role: staff.role });
    return NextResponse.json({ case: created }, { status: 201 });
  });
}
