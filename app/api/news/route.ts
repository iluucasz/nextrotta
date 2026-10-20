import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { listPublishedNews } from '@/lib/platform/news';

export const runtime = 'nodejs';

/** Release notes published for the organizations' system. */
export async function GET(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  return NextResponse.json({ posts: await listPublishedNews('system', 30) });
}
