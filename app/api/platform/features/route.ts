import { NextRequest, NextResponse } from 'next/server';
import { createFeature, listFeatures } from '@/lib/platform/features';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/**
 * The feature catalog: built-in and promoted features (general, unlocked by plans) and custom ones
 * (unlocked only for the organizations they were granted to). Core features are in every plan.
 */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ features: await listFeatures() }));
}

/** { key, name, description? } — a new custom feature. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json({ feature: await createFeature(await readJson(request), { id: owner.userId }) }, { status: 201 }),
  );
}
