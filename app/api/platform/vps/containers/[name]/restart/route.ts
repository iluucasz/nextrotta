import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { restartVpsContainer } from '@/lib/platform/vps';

export const runtime = 'nodejs';

type Context = { params: Promise<{ name: string }> };

/**
 * Restarts a NextRotta container. A shared one (the WhatsApp server, also used by the production
 * system) needs `confirmShared: true`; production and unknown containers are refused by the agent.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { name } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    return NextResponse.json(await restartVpsContainer(name, body?.confirmShared === true, { id: owner.userId }));
  });
}
