import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { verifyOrganizationAuth } from '@/lib/auth';
import { getCompanyFile } from '@/lib/organization-files';

export const runtime = 'nodejs';

/** Types the browser may show in place; anything else (HTML, SVG...) is downloaded, never rendered on our origin. */
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

/** One file of the company from the private store, for its administrator (works while the access is locked). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string; id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const { kind, id } = await params;
    const found = await getCompanyFile(auth.organizationId, kind, id);
    if (!found) return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });

    const file = await get(found.url, { access: 'private' });
    if (!file || file.statusCode !== 200 || !file.stream) return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });

    const contentType = (found.contentType || file.blob.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const download = request.nextUrl.searchParams.get('download') === '1' || !INLINE_TYPES.has(contentType);
    return new NextResponse(file.stream, {
      headers: {
        'Content-Type': INLINE_TYPES.has(contentType) ? contentType : 'application/octet-stream',
        'Content-Length': String(file.blob.size),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(found.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[organization/files] error:', error);
    return NextResponse.json({ error: 'Não foi possível abrir o arquivo.' }, { status: 500 });
  }
}
