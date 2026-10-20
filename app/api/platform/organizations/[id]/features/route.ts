import { NextRequest, NextResponse } from 'next/server';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { listOrganizationFeatures, setOrganizationFeature } from '@/lib/platform/features';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function organizationId(context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
  return id;
}

/** Custom features granted to this organization. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json({ features: await listOrganizationFeatures(await organizationId(context)) }));
}

/** { key, enabled } */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const body = await readJson(request);
    const features = await setOrganizationFeature(await organizationId(context), String(body.key ?? ''), Boolean(body.enabled), { id: owner.userId });
    return NextResponse.json({ features });
  });
}
