import { get } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';
import { getCertificateFile } from '@/lib/legal/certificate';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Downloads one certificate of acceptance of the company (the file lives in the private store, so it only opens through here or the company's Biblioteca). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string; docId: string }> }) {
  return withPlatformOwner(request, async () => {
    const { id, docId } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
    const certificate = await getCertificateFile(id, docId);
    if (!certificate) throw new PlatformError('Comprovante não encontrado.', 404);

    const file = await get(certificate.url, { access: 'private' });
    if (!file || file.statusCode !== 200 || !file.stream) throw new PlatformError('Arquivo não encontrado.', 404);
    return new NextResponse(file.stream, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(file.blob.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(certificate.fileName)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
