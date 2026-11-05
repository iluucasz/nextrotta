import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { chatClosingMessage, cleanMessage } from '@/lib/livechat/rules';
import { endConversation } from '@/lib/livechat/whatsapp';
import { findWebConversation, getMessages, markReadByCustomer, sendCustomerMessage, setConversationPhone, startWebConversation, type ChatMessage, type Conversation } from '@/lib/livechat/store';
import { normalizePhone } from '@/lib/whatsapp/phone';
import { getBugReport } from '@/lib/platform/bugs';
import { PlatformError } from '@/lib/platform/errors';

export const runtime = 'nodejs';

type Context = { params: Promise<{ ticketId: string }> };

function failure(error: unknown) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[support/livechat] error:', error);
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
}

/** The customer's view: their messages are "mine", the platform's are the other side. System lines stay in the middle. */
const forCustomer = (message: ChatMessage) => ({
  id: message.id,
  mine: message.direction === 'in',
  senderName: message.direction === 'in' ? message.senderName : 'Suporte NextRotta',
  body: message.body,
  kind: message.kind,
  createdAt: message.createdAt,
});
const conversationView = (conversation: Conversation | null) => (conversation ? { id: conversation.id, status: conversation.status, unread: conversation.unreadCustomer, whatsapp: conversation.contactPhone } : null);

/** The ticket of this company that this person may chat about (the admin: any; others: their own). */
async function authorize(request: NextRequest, ticketId: string) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) throw new PlatformError('Não autorizado.', 401);
  const { report } = await getBugReport(ticketId, { kind: 'organization', organizationId: auth.organizationId });
  if (auth.role !== 'admin' && report.userId !== auth.userId) throw new PlatformError('Chamado não encontrado.', 404);
  const user = (await sql`SELECT name FROM users WHERE id = ${auth.userId}`)[0];
  return { auth, report, userName: String(user?.name ?? 'Cliente') };
}

/** The chat of a ticket: ?after=<timestamp> returns only newer messages. Reading it marks the platform's messages as read. */
export async function GET(request: NextRequest, context: Context) {
  try {
    const { ticketId } = await context.params;
    await authorize(request, ticketId);
    const conversation = await findWebConversation(ticketId);
    if (!conversation) return NextResponse.json({ conversation: null, messages: [] });
    const messages = await getMessages(conversation.id, request.nextUrl.searchParams.get('after'));
    if (conversation.unreadCustomer > 0) await markReadByCustomer(conversation.id);
    return NextResponse.json({ conversation: conversationView(conversation), messages: messages.map(forCustomer) });
  } catch (error) {
    return failure(error);
  }
}

/** { text } sends a message (starting the chat when there is none); { action: 'close' } ends it. */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { ticketId } = await context.params;
    const { auth, report, userName } = await authorize(request, ticketId);
    const body = (await request.json().catch(() => ({}))) as { text?: unknown; action?: unknown; phone?: unknown };

    // { action: 'phone', phone } — the WhatsApp the team may also answer on ("" removes it).
    if (body.action === 'phone') {
      const existing = await findWebConversation(ticketId);
      if (!existing || existing.status !== 'open') throw new PlatformError('Inicie o chat antes de informar o WhatsApp.', 409);
      const raw = String(body.phone ?? '').trim();
      const phone = raw ? normalizePhone(raw) : null;
      if (raw && !phone) throw new PlatformError('O WhatsApp informado não é válido. Use DDD + número.');
      const updated = await setConversationPhone(existing.id, phone);
      return NextResponse.json({ conversation: conversationView(updated), messages: (await getMessages(updated.id)).map(forCustomer) });
    }

    if (body.action === 'close') {
      const existing = await findWebConversation(ticketId);
      if (existing?.status === 'open') await endConversation(existing.id, 'customer', chatClosingMessage('web'));
      const after = await findWebConversation(ticketId);
      return NextResponse.json({ conversation: conversationView(after), messages: after ? (await getMessages(after.id)).map(forCustomer) : [] });
    }

    if (!cleanMessage(body.text)) throw new PlatformError('Escreva a mensagem.');
    // Live chat and written support are separate: only a ticket opened as a live chat has a chat.
    if (report.channel !== 'chat') throw new PlatformError('Este chamado é de atendimento por escrito. Para falar ao vivo, inicie um novo chat ao vivo.', 409);
    if (report.status === 'resolved' || report.status === 'not_reproduced') throw new PlatformError('Este chamado já foi concluído. Abra um novo chamado para falar com o suporte.', 409);
    const conversation = await startWebConversation({ organizationId: auth.organizationId, userId: auth.userId, ticketId, userName });
    await sendCustomerMessage(conversation, userName, body.text);
    const messages = await getMessages(conversation.id);
    return NextResponse.json({ conversation: conversationView(await findWebConversation(ticketId)), messages: messages.map(forCustomer) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
