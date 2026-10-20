import { NextRequest, NextResponse } from 'next/server';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { getSiteEditorState, publishSite, saveSiteDraft } from '@/lib/site/store';

export const runtime = 'nodejs';

/** Draft and published versions of the marketing site's content. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getSiteEditorState()));
}

/** Saves the draft; the public site doesn't change. */
export async function PUT(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await saveSiteDraft(await readJson(request), { id: owner.userId })));
}

/** Publishes the given content. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json(await publishSite(await readJson(request), { id: owner.userId })));
}
