import { NextRequest, NextResponse } from 'next/server';
import { runBillingMaintenance } from '@/lib/billing/billing';
import { isCronAuthorized } from '@/lib/cron-secret';
import { trackRun } from '@/lib/worker-health';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The daily billing maintenance (a day-before backup for those about to be locked, then the suspension of those past
 * their grace period, each with a final backup first), scheduled by Vercel Cron a few minutes before the VPS worker's own
 * run at 06:00. Here the storage token is present, so the final backups are made; the worker then finds nothing left to do
 * (the suspension only touches companies still past due).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const suspended = await trackRun('billing', null, runBillingMaintenance);
    return NextResponse.json({ suspended });
  } catch (error) {
    console.error('[cron/billing] error:', error);
    return NextResponse.json({ error: 'A rotina de cobrança falhou.' }, { status: 500 });
  }
}
