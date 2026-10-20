import { NextRequest, NextResponse } from 'next/server';
import { listPublishedNews } from '@/lib/platform/news';

export const runtime = 'nodejs';

/** Release notes published on the marketing site. */
export async function GET(_request: NextRequest) {
  try {
    return NextResponse.json({ posts: await listPublishedNews('site') });
  } catch (error) {
    console.error('[public/news] error:', error);
    return NextResponse.json({ error: 'Não foi possível carregar as novidades.' }, { status: 500 });
  }
}
