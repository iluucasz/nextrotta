import { NextRequest, NextResponse } from 'next/server';
import { updatePrivacyRequest } from '@/lib/privacy/requests';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ requestId: string }> };

/** { status?: "received"|"in_progress"|"answered"|"rejected", organizationId?: uuid|null, responseNote?: "texto" } */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { requestId } = await context.params;
    return NextResponse.json({ request: await updatePrivacyRequest(requestId, await readJson(request), { id: owner.userId }) });
  });
}
