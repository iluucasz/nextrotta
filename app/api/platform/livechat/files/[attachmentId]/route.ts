import { NextRequest } from 'next/server';
import { chatFileResponse } from '@/lib/livechat/files';
import { getAttachment } from '@/lib/livechat/store';
import { PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** A file of any conversation, for the owner (?download=1 to save instead of showing it). */
export async function GET(request: NextRequest, context: { params: Promise<{ attachmentId: string }> }) {
  return withPlatformOwner(request, async () => {
    const { attachmentId } = await context.params;
    const attachment = await getAttachment(attachmentId);
    if (!attachment) throw new PlatformError('Arquivo não encontrado.', 404);
    return chatFileResponse(attachment, request.nextUrl.searchParams.get('download') === '1');
  });
}
