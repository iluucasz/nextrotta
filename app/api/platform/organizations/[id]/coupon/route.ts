import { NextRequest, NextResponse } from 'next/server';
import { applyCoupon, getActiveRedemption, removeCoupon } from '@/lib/platform/coupons';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function organizationId(context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
  return id;
}

/** The coupon currently applied, or null. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json({ coupon: await getActiveRedemption(await organizationId(context)) }));
}

/** { code } — applies the coupon to the subscription. */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const body = await readJson(request);
    return NextResponse.json({ coupon: await applyCoupon(await organizationId(context), body.code, { id: owner.userId }) });
  });
}

/** Removes the coupon; the previous discount comes back. */
export async function DELETE(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    await removeCoupon(await organizationId(context), { id: owner.userId });
    return NextResponse.json({ coupon: null });
  });
}
