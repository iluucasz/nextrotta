import { NextRequest, NextResponse } from 'next/server';
import { getCreditPackage, updateCreditPackage } from '@/lib/platform/ai-credits';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ packageId: string }> };

/** The package and its sales. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json(await getCreditPackage((await context.params).packageId)));
}

/** { name, credits, price, reason? } or { archived: boolean }. */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json(await updateCreditPackage((await context.params).packageId, await readJson(request), { id: owner.userId })),
  );
}
