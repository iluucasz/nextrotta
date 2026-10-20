import { NextRequest, NextResponse } from 'next/server';
import { getBugScreenshot } from '@/lib/platform/bugs';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ bugId: string }> };

function imageResponse(dataUrl: string | null) {
  const match = dataUrl?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) return NextResponse.json({ error: 'Sem captura de tela.' }, { status: 404 });
  return new NextResponse(Buffer.from(match[2], 'base64'), {
    headers: { 'Content-Type': match[1], 'Cache-Control': 'private, max-age=3600' },
  });
}

export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => imageResponse(await getBugScreenshot((await context.params).bugId, { kind: 'owner' })));
}
