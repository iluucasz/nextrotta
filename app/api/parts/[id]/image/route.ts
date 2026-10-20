import { NextRequest, NextResponse } from 'next/server';
import { get, put } from '@vercel/blob';
import { checkLimit } from '@/lib/billing/entitlements';
import { getPartImageFile, savePartImage } from '@/lib/parts/catalog';
import { partsContext, partsError } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_BYTES = 2 * 1024 * 1024;

/** Serves the part's picture to anyone of the organization (the Blob store is private). */
export async function GET(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const file = await getPartImageFile(context.organizationId, id);
    if (!file) return NextResponse.json({ error: 'Sem imagem.' }, { status: 404 });
    const blob = await get(file.url, { access: 'private' });
    if (!blob || blob.statusCode !== 200 || !blob.stream) return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 404 });
    return new NextResponse(blob.stream, {
      headers: {
        'Content-Type': IMAGE_TYPES[file.contentType] ? file.contentType : 'application/octet-stream',
        // The URL carries the image id (?v=), so a new picture is a new URL.
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return partsError(error, 'get part image');
  }
}

/** Admin uploads a picture (the screen already shrinks it to ~800 px). */
export async function POST(request: NextRequest, { params }: Params) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Envie uma imagem.' }, { status: 400 });
    const extension = IMAGE_TYPES[file.type];
    if (!extension) return NextResponse.json({ error: 'Use uma imagem JPG, PNG ou WebP.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Imagem muito grande (máximo 2 MB).' }, { status: 400 });

    const limit = await checkLimit(context.organizationId, 'storageMb', file.size / (1024 * 1024));
    if (!limit.allowed) return NextResponse.json({ error: limit.message }, { status: 403 });

    const blob = await put(`parts/${context.organizationId}/${id}-${Date.now()}.${extension}`, Buffer.from(await file.arrayBuffer()), {
      access: 'private',
      contentType: file.type,
    });
    const part = await savePartImage(context.organizationId, id, { url: blob.url, contentType: file.type, size: file.size }, context.actor);
    return NextResponse.json({ part });
  } catch (error) {
    return partsError(error, 'upload part image');
  }
}
