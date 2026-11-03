import { NextRequest, NextResponse } from 'next/server';
import { setLifetime } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/**
 * { enabled: boolean, reason?: string, cancelBilling?: boolean } — lifetime organizations use the platform
 * without paying: out of the revenue figures and of billing, still counted as cost. Turning it on needs a
 * reason, and `cancelBilling: true` when the gateway is charging the organization.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const body = await readJson(request);
    const organization = await setLifetime(id, body, { id: owner.userId });
    return NextResponse.json({ organization });
  });
}
