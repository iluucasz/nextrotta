import { NextRequest, NextResponse } from 'next/server';
import { createNewsPost, listNewsPosts } from '@/lib/platform/news';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ posts: await listNewsPosts() }));
}

/** { title, publishedOn, category, body, imageUrl?, destination: "site"|"system"|"both", status: "draft"|"published" } */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json({ post: await createNewsPost(await readJson(request), { id: owner.userId }) }, { status: 201 }),
  );
}
