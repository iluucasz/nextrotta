import { NextRequest, NextResponse } from 'next/server';
import { importParts, type ImportRow } from '@/lib/parts/catalog';
import { listImports } from '@/lib/parts/corrections';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

/** The latest imports, so one can be undone. */
export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    return NextResponse.json({ imports: await listImports(context.organizationId) });
  } catch (error) {
    return partsError(error, 'list imports');
  }
}

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
