import { after, NextRequest, NextResponse } from 'next/server';
import { getConversation, setTyping } from '@/lib/livechat/store';
import { showTypingOnWhatsApp } from '@/lib/livechat/whatsapp';
import { readJson, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/**
 * { mirror?: false } — the team is typing in this conversation ("digitando…" for the customer, for a few seconds; the panel repeats
 * it while the person types). On WhatsApp (or a web chat whose customer gave a number, unless mirror is false) the customer's phone
 * shows it too, once per burst.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformStaff(request, async () => {
    const { id } = await context.params;
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const conversation = await getConversation(id);
    if (conversation.status === 'closed') return NextResponse.json({ ok: true });
    const started = await setTyping(id, 'owner');
    const toWhatsApp = conversation.channel === 'whatsapp' || (Boolean(conversation.contactPhone) && body.mirror !== false);
    if (started && toWhatsApp) after(() => showTypingOnWhatsApp(conversation.contactPhone));
    return NextResponse.json({ ok: true });
  });
}
