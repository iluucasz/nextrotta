import { NextRequest, NextResponse } from 'next/server';
import { changeOrganizationStatus } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** { action: "suspend" | "reactivate" | "cancel", reason } — suspend and cancel need a reason. Nothing is deleted. */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const body = await readJson(request);
    const organization = await changeOrganizationStatus(
      id,
      String(body.action ?? ''),
      typeof body.reason === 'string' ? body.reason : '',
      { id: owner.userId },
    );
    return NextResponse.json({ organization });
  });
}
