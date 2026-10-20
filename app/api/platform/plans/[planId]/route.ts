import { NextRequest, NextResponse } from 'next/server';
import { updatePlan } from '@/lib/platform/plans';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ planId: string }> };

/**
 * Any of the plan fields, plus `archived: true|false` and, for a price change,
 * `applyPriceChange: "new_only" (default) | "next_cycle"` → { plan, affectedSubscriptions }.
 */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { planId } = await context.params;
    return NextResponse.json(await updatePlan(planId, await readJson(request), { id: owner.userId }));
  });
}
