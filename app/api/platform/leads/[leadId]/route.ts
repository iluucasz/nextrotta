import { NextRequest, NextResponse } from 'next/server';
import { getLead, updateLead } from '@/lib/platform/leads';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ leadId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { leadId } = await context.params;
    return NextResponse.json({ lead: await getLead(leadId) });
  });
}

/** { status?: "new"|"contacted"|"proposal"|"won"|"lost", note?: "texto" } */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { leadId } = await context.params;
    return NextResponse.json({ lead: await updateLead(leadId, await readJson(request), { id: owner.userId }) });
  });
}
