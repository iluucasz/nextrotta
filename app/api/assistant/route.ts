import { NextRequest, NextResponse } from 'next/server';
import { ask, getAssistantStatus, listConversations } from '@/lib/ai/assistant';
import { assistantFailure as failure, assistantUser } from '@/lib/ai/route';

export const runtime = 'nodejs';
// Answers may need a few rounds of data lookups.
export const maxDuration = 120;

/** Availability, credits and the admin's conversations. */
export async function GET(request: NextRequest) {
  try {
    const user = await assistantUser(request);
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const [status, conversations] = await Promise.all([getAssistantStatus(user), listConversations(user)]);
    return NextResponse.json({ ...status, conversations });
  } catch (error) {
    return failure(error);
  }
}

/** { question, conversationId? } — answers and debits the credits. */
export async function POST(request: NextRequest) {
  try {
    const user = await assistantUser(request);
    if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await ask(user, body ?? {}));
  } catch (error) {
    return failure(error);
  }
}
