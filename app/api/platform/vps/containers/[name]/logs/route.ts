import { NextRequest, NextResponse } from 'next/server';
import { withPlatformOwner } from '@/lib/platform/route';
import { getVpsContainerLogs } from '@/lib/platform/vps';

export const runtime = 'nodejs';

type Context = { params: Promise<{ name: string }> };

/** The last log lines of a container (read only, any owner). */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { name } = await context.params;
    const tail = Number(request.nextUrl.searchParams.get('tail') ?? 200);
    return NextResponse.json(await getVpsContainerLogs(name, Number.isFinite(tail) ? tail : 200));
  });
}
