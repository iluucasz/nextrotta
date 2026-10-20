import { NextRequest, NextResponse } from 'next/server';
import { importParts, type ImportRow } from '@/lib/parts/catalog';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/** Rows already read from the spreadsheet by the screen (same columns as the template). */
export async function POST(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const body = await readJson(request);
    const rows = Array.isArray(body.rows) ? (body.rows as ImportRow[]) : [];
    return NextResponse.json({ result: await importParts(context.organizationId, rows, context.actor) });
  } catch (error) {
    return partsError(error, 'import parts');
  }
}
