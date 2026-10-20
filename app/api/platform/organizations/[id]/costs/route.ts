import { NextRequest, NextResponse } from 'next/server';
import { getOrganizationCosts } from '@/lib/platform/costs';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** ?month=AAAA-MM — the organization's usage, its part of each platform cost and what it pays. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
    const month =
      request.nextUrl.searchParams.get('month') ??
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
    return NextResponse.json(await getOrganizationCosts(id, month));
  });
}
