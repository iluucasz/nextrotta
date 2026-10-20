import { NextRequest, NextResponse } from 'next/server';
import { applyTargetMargin } from '@/lib/platform/ai-credits';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { reason } — sets every active credit package to the price of the target margin (new purchases only). */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await applyTargetMargin(await readJson(request), { id: owner.userId })));
}
