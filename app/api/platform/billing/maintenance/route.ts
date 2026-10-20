import { NextRequest, NextResponse } from 'next/server';
import { runBillingMaintenance } from '@/lib/billing/billing';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/**
 * Runs the daily delinquency check now (the worker also runs it every morning): suspends past-due
 * organizations whose grace period is over.
 */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const suspended = await runBillingMaintenance();
    return NextResponse.json({ suspended });
  });
}
