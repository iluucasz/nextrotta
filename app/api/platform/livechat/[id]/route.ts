import { NextRequest, NextResponse } from 'next/server';
import { cleanMessage } from '@/lib/livechat/rules';
import { closeConversation, getConversation, getMessages, markReadByOwner, reopenConversation, setUrgent } from '@/lib/livechat/store';
import { sendOwnerReply } from '@/lib/livechat/whatsapp';
import { PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** The conversation with its messages. ?after=<timestamp> returns only the newer messages; ?read=1 marks it as read. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    if (request.nextUrl.searchParams.get('read') === '1') {
      await getConversation(id);
      await markReadByOwner(id);
    }
    const [conversation, messages] = await Promise.all([getConversation(id), getMessages(id, request.nextUrl.searchParams.get('after'))]);
    return NextResponse.json({ conversation, messages });
  });
}

/** { text } — the owner's answer (on WhatsApp it is sent through the official number). */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    const text = cleanMessage((await readJson(request)).text);
    if (!text) throw new PlatformError('Escreva a mensagem.');
    const conversation = await getConversation(id);
    if (conversation.status === 'closed') await reopenConversation(id);
    await sendOwnerReply(id, text);
    await markReadByOwner(id);
    return NextResponse.json({ conversation: await getConversation(id), messages: await getMessages(id) });
  });
}

/** { status?: 'open' | 'closed', urgent?: boolean } */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    const body = await readJson(request);
    await getConversation(id);
    if (body.status === 'closed') await closeConversation(id, 'owner');
    else if (body.status === 'open') await reopenConversation(id);
    if (typeof body.urgent === 'boolean') await setUrgent(id, body.urgent);
    return NextResponse.json({ conversation: await getConversation(id) });
  });
}
