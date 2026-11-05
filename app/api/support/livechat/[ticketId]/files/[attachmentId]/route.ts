import { NextRequest } from 'next/server';
import { authorizeCustomer, chatFailure } from '@/lib/livechat/customer-access';
import { chatFileResponse } from '@/lib/livechat/files';
import { findWebConversation, getAttachment } from '@/lib/livechat/store';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

/** A file of this ticket's chat, for the company that owns the ticket (?download=1 to save instead of showing it). */
export async function GET(request: NextRequest, context: { params: Promise<{ ticketId: string; attachmentId: string }> }) {
  try {
    const { ticketId, attachmentId } = await context.params;
    await authorizeCustomer(request, ticketId);
    const [attachment, conversation] = await Promise.all([getAttachment(attachmentId), findWebConversation(ticketId)]);
    if (!attachment || !conversation || attachment.conversationId !== conversation.id) throw new PlatformError('Arquivo não encontrado.', 404);
    return await chatFileResponse(attachment, request.nextUrl.searchParams.get('download') === '1');
  } catch (error) {
    return chatFailure(error);
  }
}
