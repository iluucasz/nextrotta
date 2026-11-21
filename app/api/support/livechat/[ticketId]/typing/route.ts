import { NextRequest, NextResponse } from 'next/server';
import { authorizeCustomer, chatFailure as failure } from '@/lib/livechat/customer-access';
import { findWebConversation, setTyping } from '@/lib/livechat/store';

export const runtime = 'nodejs';

type Context = { params: Promise<{ ticketId: string }> };

/** The customer is typing in the chat of this ticket ("digitando…" for the team, for a few seconds; the window repeats it). */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { ticketId } = await context.params;
    await authorizeCustomer(request, ticketId);
    const conversation = await findWebConversation(ticketId);
    if (conversation?.status === 'open') await setTyping(conversation.id, 'customer');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
