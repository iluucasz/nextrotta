import { NextRequest, NextResponse } from 'next/server';
import { createCoupon, listCoupons } from '@/lib/platform/coupons';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ coupons: await listCoupons() }));
}

/** { code, kind: "percent"|"fixed", value, durationCycles, expiresOn?, planKeys?, maxUses? } */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json(await createCoupon(await readJson(request), { id: owner.userId }), { status: 201 }),
  );
}
