import { NextRequest, NextResponse } from 'next/server';
import { chatClosingMessage, cleanMessage } from '@/lib/livechat/rules';
import { getConversation, getMessages, markReadByOwner, reopenConversation, setUrgent } from '@/lib/livechat/store';
import { endConversation, sendOwnerReply } from '@/lib/livechat/whatsapp';
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

/** { text, mirror?: false } — the owner's answer. On WhatsApp it is sent through the official number; on a web chat it is also mirrored to the customer's WhatsApp when there is one (unless mirror is false). */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    const body = await readJson(request);
    const text = cleanMessage(body.text);
    if (!text) throw new PlatformError('Escreva a mensagem.');
    const conversation = await getConversation(id);
    if (conversation.status === 'closed') await reopenConversation(id);
    const reply = await sendOwnerReply(id, text, { mirror: body.mirror !== false });
    await markReadByOwner(id);
    return NextResponse.json({ conversation: await getConversation(id), messages: await getMessages(id), whatsapp: reply.whatsapp, whatsappError: reply.whatsappError ?? null });
  });
}

/** { status?: 'open' | 'closed', thanks?: string | null, urgent?: boolean } — closing sends the thank-you (the default text, the given one, or none with null or ""). */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    const body = await readJson(request);
    const current = await getConversation(id);
    let whatsapp: 'sent' | 'failed' | 'skipped' = 'skipped';
    let whatsappError: string | null = null;
    if (body.status === 'closed') {
      const thanks = body.thanks === undefined ? chatClosingMessage(current.channel) : cleanMessage(body.thanks) || null;
      const ended = await endConversation(id, 'owner', thanks);
      whatsapp = ended.whatsapp;
      whatsappError = ended.whatsappError ?? null;
    } else if (body.status === 'open') await reopenConversation(id);
    if (typeof body.urgent === 'boolean') await setUrgent(id, body.urgent);
    return NextResponse.json({ conversation: await getConversation(id), whatsapp, whatsappError });
  });
}
