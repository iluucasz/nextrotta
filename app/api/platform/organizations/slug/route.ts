import { NextRequest, NextResponse } from 'next/server';
import { checkSlugAvailability } from '@/lib/platform/organizations';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?slug=empresa → { slug, available, reason } for the live check in the creation wizard. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    return NextResponse.json(await checkSlugAvailability(request.nextUrl.searchParams.get('slug') ?? ''));
  });
}
