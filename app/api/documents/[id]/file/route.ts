import { NextRequest, NextResponse } from 'next/server';
import { get } from '@vercel/blob';
import { verifyOrganizationAuth } from '@/lib/auth';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { listDocuments } from '@/lib/library-documents';

export const runtime = 'nodejs';

/** Types the browser may show in place; anything else (HTML, SVG...) is downloaded, never rendered on our origin. */
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

/** Serves a library file from the private blob store, to whoever may see the document. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role === 'platform_owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'library');
    if (featureBlocked) return featureBlocked;

    const { id } = await params;
    const [document] = await listDocuments(
      { organizationId: auth.organizationId, role: auth.role, technicianId: auth.technicianId || auth.userId },
      id,
    );
    if (!document?.blobUrl) {
      return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
    }

    const file = await get(String(document.blobUrl), { access: 'private' });
    if (!file || file.statusCode !== 200 || !file.stream) {
      return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
    }

    const fileName = String(document.fileName || 'documento');
    const contentType = (file.blob.contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const download = request.nextUrl.searchParams.get('download') === '1' || !INLINE_TYPES.has(contentType);
    return new NextResponse(file.stream, {
      headers: {
        'Content-Type': INLINE_TYPES.has(contentType) ? contentType : 'application/octet-stream',
        'Content-Length': String(file.blob.size),
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[documents] Get file error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
