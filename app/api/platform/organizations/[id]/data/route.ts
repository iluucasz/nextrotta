import { NextRequest, NextResponse } from 'next/server';
import { exportOrganizationData, listTrash, restoreFromTrash } from '@/lib/platform/data';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function organizationId(context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
  return id;
}

/** The organization's trash; ?export=1 downloads every record it owns as JSON instead. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const id = await organizationId(context);
    if (request.nextUrl.searchParams.get('export') !== '1') return NextResponse.json({ trash: await listTrash(id) });

    const data = await exportOrganizationData(id, { id: owner.userId, role: 'platform_owner' });
    const slug = String((data.organization as Record<string, unknown>).slug);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="nextrotta-${slug}-${data.exportedAt.slice(0, 10)}.json"`,
      },
    });
  });
}

/** { table, recordId } — restores an archived record. */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const id = await organizationId(context);
    const body = await readJson(request);
    await restoreFromTrash(id, body.table, body.recordId, { id: owner.userId, role: 'platform_owner' });
    return NextResponse.json({ trash: await listTrash(id) });
  });
}
