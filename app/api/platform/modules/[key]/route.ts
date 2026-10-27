import { NextRequest, NextResponse } from 'next/server';
import { setModulePrice } from '@/lib/platform/modules';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ key: string }> };

/**
 * { monthlyPrice: number | null, setupFee?: number } — sets the module's monthly price and setup fee;
 * null takes it off sale. Applies to new subscriptions only: companies keep the prices they chose.
 */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { key } = await context.params;
    return NextResponse.json(await setModulePrice(key, await readJson(request), { id: owner.userId }));
  });
}
