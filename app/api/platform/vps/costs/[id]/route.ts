import { NextRequest, NextResponse } from 'next/server';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';
import { archiveInfraCost } from '@/lib/platform/vps';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Archives a wrong entry (it stays in the database, out of the totals). */
export async function DELETE(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Lançamento inválido.', 404);
    await archiveInfraCost(id, { id: owner.userId });
    return NextResponse.json({ ok: true });
  });
}
