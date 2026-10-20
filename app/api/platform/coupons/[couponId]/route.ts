import { NextRequest, NextResponse } from 'next/server';
import { getCoupon, updateCoupon } from '@/lib/platform/coupons';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ couponId: string }> };

/** The coupon and every organization that received it. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json(await getCoupon((await context.params).couponId)));
}

/** The coupon fields, or { archived: boolean, reason? }. */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json(await updateCoupon((await context.params).couponId, await readJson(request), { id: owner.userId })),
  );
}
