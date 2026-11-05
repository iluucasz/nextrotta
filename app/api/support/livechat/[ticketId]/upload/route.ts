import { NextRequest, NextResponse } from 'next/server';
import { checkLimit } from '@/lib/billing/entitlements';
import { authorizeCustomer, chatFailure, conversationView, forCustomer } from '@/lib/livechat/customer-access';
import { saveChatFile } from '@/lib/livechat/files';
import { attachmentPreview, attachmentProblem, cleanMessage } from '@/lib/livechat/rules';
import { assertCustomerMayWrite, findWebConversation, getMessages, sendCustomerAttachment, startWebConversation } from '@/lib/livechat/store';
import { alertOwnerOfChat } from '@/lib/livechat/whatsapp';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Context = { params: Promise<{ ticketId: string }> };

/**
 * The customer sends a file in the chat (an attached file or a pasted screenshot), with an optional text: multipart form with
 * `file` and `text`. It is kept in the private store, in the company's own folder, and counts against the company's storage plan.
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { ticketId } = await context.params;
    const { auth, report, userName } = await authorizeCustomer(request, ticketId);
    if (report.channel !== 'chat') throw new PlatformError('Este chamado é de atendimento por escrito. Para falar ao vivo, inicie um novo chat ao vivo.', 409);

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) throw new PlatformError('Escolha um arquivo para enviar.');
    const problem = attachmentProblem({ type: file.type, size: file.size });
    if (problem) throw new PlatformError(problem);

    const conversation = (await findWebConversation(ticketId)) ?? (await startWebConversation({ organizationId: auth.organizationId, userId: auth.userId, ticketId, userName }));
    // Refuse before keeping anything: an ended chat, too many messages, or a full storage plan.
    await assertCustomerMayWrite(conversation);
    const limit = await checkLimit(auth.organizationId, 'storageMb', file.size / (1024 * 1024));
    if (!limit.allowed) throw new PlatformError(limit.message, 403);

    const saved = await saveChatFile({ organizationId: auth.organizationId, conversationId: conversation.id, fileName: file.name, contentType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
    const text = form?.get('text');
    await sendCustomerAttachment(conversation, userName, text, saved);
    await alertOwnerOfChat(conversation, userName, cleanMessage(text) || attachmentPreview(saved.fileName));
    const messages = await getMessages(conversation.id);
    return NextResponse.json({ conversation: conversationView(await findWebConversation(ticketId)), messages: messages.map(forCustomer) }, { status: 201 });
  } catch (error) {
    return chatFailure(error);
  }
}
