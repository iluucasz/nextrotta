import { NextRequest, NextResponse } from 'next/server';
import { purgeParts } from '@/lib/parts/corrections';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/**
 * Permanent delete of parts that have no history (the admin asked for it: nothing here goes to the trash).
 * Body: { ids, dryRun? }. With dryRun it only says which ones can go and which are blocked, and why.
 */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    return NextResponse.json(await purgeParts(context.organizationId, body.ids, { dryRun: body.dryRun === true }, context.actor));
  } catch (error) {
    return partsError(error, 'purge parts');
  }
}
