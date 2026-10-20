import { NextRequest, NextResponse } from 'next/server';
import { transferAllocation } from '@/lib/platform/allocation';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { resource, from, to, amount, reason } — moves part of one organization's share to another. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    return NextResponse.json(await transferAllocation(await readJson(request), { id: owner.userId }));
  });
}
