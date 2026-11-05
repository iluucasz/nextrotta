import { NextRequest, NextResponse } from 'next/server';
import { addBugMessage, getBugReport, updateBugReport } from '@/lib/platform/bugs';
import { readJson, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ bugId: string }> };

/** The report with the whole conversation, internal notes included. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformStaff(request, async () => NextResponse.json(await getBugReport((await context.params).bugId, { kind: 'owner' })));
}

/** { status?, priority? } */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformStaff(request, async (owner) =>
    NextResponse.json(await updateBugReport((await context.params).bugId, await readJson(request), { id: owner.userId, role: owner.role })),
  );
}

/** { text, internal?: boolean } — a reply the user sees, or an internal note (owner only). */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformStaff(request, async (owner) => {
    const body = await readJson(request);
    return NextResponse.json(
      await addBugMessage((await context.params).bugId, { userId: owner.userId, fromOwner: true }, { text: body.text, internal: body.internal }),
    );
  });
}
