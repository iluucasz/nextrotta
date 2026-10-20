import { NextRequest, NextResponse } from 'next/server';
import { getFeature, promoteFeature, setFeatureArchived, setFeatureOrganizations, updateFeature } from '@/lib/platform/features';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ key: string }> };

/** The feature with its plans, organizations and history. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json(await getFeature((await context.params).key)));
}

/** { name?, description? } or { archived: boolean, reason }. */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { key } = await context.params;
    const body = await readJson(request);
    const actor = { id: owner.userId };
    const feature =
      'archived' in body
        ? await setFeatureArchived(key, Boolean(body.archived), String(body.reason ?? ''), actor)
        : await updateFeature(key, body, actor);
    return NextResponse.json({ feature });
  });
}

/**
 * { action: "organizations", organizationIds: [] } — exactly who has the custom feature;
 * { action: "promote", planIds: [], reason } — makes it general, included in those plans.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { key } = await context.params;
    const body = await readJson(request);
    const actor = { id: owner.userId };
    const feature =
      body.action === 'promote'
        ? await promoteFeature(key, body.planIds, String(body.reason ?? ''), actor)
        : await setFeatureOrganizations(key, body.organizationIds, actor);
    return NextResponse.json({ feature });
  });
}
