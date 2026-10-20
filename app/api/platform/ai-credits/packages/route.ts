import { NextRequest, NextResponse } from 'next/server';
import { createCreditPackage } from '@/lib/platform/ai-credits';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { name, credits, price, reason? } */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json(await createCreditPackage(await readJson(request), { id: owner.userId }), { status: 201 }),
  );
}
