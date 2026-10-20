import { NextRequest, NextResponse } from 'next/server';
import { archivePart, updatePart } from '@/lib/parts/catalog';
import { getPartDetail } from '@/lib/parts/detail';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/** Detail of one part: who holds it, how many were sold and what the sales produced. */
export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    return NextResponse.json(await getPartDetail(context.organizationId, id));
  } catch (error) {
    return partsError(error, 'part detail');
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const part = await updatePart(context.organizationId, id, await readJson(request), context.actor);
    return NextResponse.json({ part });
  } catch (error) {
    return partsError(error, 'update part');
  }
}

/** Archives the part (soft delete); refused while it has units anywhere. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    await archivePart(context.organizationId, id, context.actor);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return partsError(error, 'archive part');
  }
}
