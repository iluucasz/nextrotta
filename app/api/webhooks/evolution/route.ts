import { NextRequest, NextResponse } from 'next/server';
import { LIVECHAT_INSTANCE, webhookTokenMatches } from '@/lib/livechat/whatsapp';
import { parseEvolutionWebhook } from '@/lib/livechat/rules';
import { storeWhatsAppMessage } from '@/lib/livechat/store';
import { getSupportContact } from '@/lib/support-contact';
import { samePhone } from '@/lib/livechat/rules';

export const runtime = 'nodejs';

/**
 * Messages that arrive on (or are typed from) the platform's official WhatsApp number, delivered by the Evolution server to the
 * live chat inbox. Authenticated by the token the instance was configured with (header `x-webhook-token`); only the live chat
 * instance is accepted. Answers 200 for what it handled or ignored, and 500 only when storing failed (so it is delivered again).
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('x-webhook-token') ?? request.nextUrl.searchParams.get('token');
  let allowed = false;
  try {
    allowed = webhookTokenMatches(token);
  } catch {
    return NextResponse.json({ error: 'Webhook indisponível.' }, { status: 503 });
  }
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  if ((payload as { instance?: unknown }).instance !== LIVECHAT_INSTANCE) return NextResponse.json({ ignored: 'other instance' });

  try {
    let stored = 0;
    // Messages the official number sends to itself (the alerts to the owner) are not conversations.
    const own = (await getSupportContact().catch(() => null))?.whatsapp ?? null;
    for (const event of parseEvolutionWebhook(payload)) {
      if (event.kind !== 'message') continue;
      if (own && samePhone(event.phone, own)) continue;
      if (await storeWhatsAppMessage(event)) stored += 1;
    }
    return NextResponse.json({ received: true, stored });
  } catch (error) {
    console.error('[webhooks/evolution] processing failed:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
