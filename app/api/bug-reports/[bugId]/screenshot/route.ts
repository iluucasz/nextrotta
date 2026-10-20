import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { getBugScreenshot } from '@/lib/platform/bugs';
import { PlatformError } from '@/lib/platform/errors';

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
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const { bugId } = await context.params;
    return imageResponse(await getBugScreenshot(bugId, { kind: 'organization', organizationId: auth.organizationId }));
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
