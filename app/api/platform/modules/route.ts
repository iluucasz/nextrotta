import { NextRequest, NextResponse } from 'next/server';
import { listModulePrices } from '@/lib/platform/modules';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/**
 * The builder ("Monte o seu"): its base plan and every general feature with the price it is sold at
 * as a module (monthlyPrice null = only inside packages). Core and base features aren't sellable.
 */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await listModulePrices()));
}
