import { NextRequest, NextResponse } from 'next/server';
import { undoImport } from '@/lib/parts/corrections';
import { partsContext, partsError } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Undoes one spreadsheet import (the parts it created go away for good, the ones it updated go back). */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    return NextResponse.json({ result: await undoImport(context.organizationId, id, context.actor) });
  } catch (error) {
    return partsError(error, 'undo import');
  }
}
