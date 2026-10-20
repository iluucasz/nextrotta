import { NextRequest, NextResponse } from 'next/server';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { addInfraCost, INFRA_COST_CATEGORIES, listInfraCosts } from '@/lib/platform/vps';

export const runtime = 'nodejs';

/** Infrastructure costs (optionally of one month, `?month=AAAA-MM`) and the categories. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () =>
    NextResponse.json({
      costs: await listInfraCosts(request.nextUrl.searchParams.get('month') ?? undefined),
      categories: INFRA_COST_CATEGORIES,
    }),
  );
}

/** `{ month, category, description?, amount }`. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const id = await addInfraCost(await readJson(request), { id: owner.userId });
    return NextResponse.json({ id }, { status: 201 });
  });
}
