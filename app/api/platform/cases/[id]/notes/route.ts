import { NextRequest, NextResponse } from 'next/server';
import { addCaseNote } from '@/lib/cases/store';
import { readJson, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { text } — an internal note on the case (only the team sees it). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withPlatformStaff(request, async (staff) => {
    const { id } = await context.params;
    const body = await readJson(request);
    return NextResponse.json({ events: await addCaseNote(id, body.text, { id: staff.userId, role: staff.role }) }, { status: 201 });
  });
}
