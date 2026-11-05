import { NextRequest, NextResponse } from 'next/server';
import { attachmentProblem, cleanMessage } from '@/lib/livechat/rules';
import { getConversation, getMessages, markReadByOwner, reopenConversation } from '@/lib/livechat/store';
import { sendOwnerAttachment } from '@/lib/livechat/whatsapp';
import { PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The team sends a file in a conversation: multipart form with `file`, `text` (optional) and `mirror` ("0" to keep it out of the
 * customer's WhatsApp). On a WhatsApp conversation it goes through the official number.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new PlatformError('Escolha um arquivo para enviar.');
    const problem = attachmentProblem({ type: file.type, size: file.size });
    if (problem) throw new PlatformError(problem);

    const conversation = await getConversation(id);
    if (conversation.status === 'closed') await reopenConversation(id);
    const result = await sendOwnerAttachment(id, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, contentType: file.type }, cleanMessage(form?.get('text')), { mirror: form?.get('mirror') !== '0' });
    await markReadByOwner(id);
    return NextResponse.json({ conversation: await getConversation(id), messages: await getMessages(id), whatsapp: result.whatsapp, whatsappError: result.whatsappError ?? null }, { status: 201 });
  });
}
