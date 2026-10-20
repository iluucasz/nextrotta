import { NextRequest, NextResponse } from 'next/server';
import { getNewsPost, updateNewsPost } from '@/lib/platform/news';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ newsId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json({ post: await getNewsPost((await context.params).newsId) }));
}

/** The post fields, or { archived: boolean }. */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json({ post: await updateNewsPost((await context.params).newsId, await readJson(request), { id: owner.userId }) }),
  );
}
