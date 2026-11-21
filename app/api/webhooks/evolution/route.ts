import { after, NextRequest, NextResponse } from 'next/server';
import { linkInboundToOpenCase } from '@/lib/cases/store';
import { autoReplyToInbound, LIVECHAT_INSTANCE, saveInboundMedia, webhookTokenMatches } from '@/lib/livechat/whatsapp';
import { parseEvolutionWebhook } from '@/lib/livechat/rules';
import { applyWhatsAppReceipt, setCustomerTypingByPhone, storeWhatsAppMessage } from '@/lib/livechat/store';
import { getSupportContact } from '@/lib/support-contact';
import { samePhone } from '@/lib/livechat/rules';

export const runtime = 'nodejs';
// The file of a photo or video is fetched after the answer, and may take a while.
export const maxDuration = 60;

/**
 * Messages that arrive on (or are typed from) the platform's official WhatsApp number, delivered by the Evolution server to the
 * live chat inbox, plus what happens around them: the customer typing, and WhatsApp delivering or reading what the team sent.
 * Authenticated by the token the instance was configured with (header `x-webhook-token`); only the live chat
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
      if (event.kind === 'status') {
        await applyWhatsAppReceipt(event.waId, event.status);
        continue;
      }
      if (event.kind === 'presence') {
        if (!(own && samePhone(event.phone, own))) await setCustomerTypingByPhone(event.phone, event.typing);
        continue;
      }
      if (event.kind !== 'message') continue;
      if (own && samePhone(event.phone, own)) continue;
      const saved = await storeWhatsAppMessage(event);
      if (saved) {
        stored += 1;
        // Greeting, away notice, note about files: only for what the customer wrote, and it never fails the webhook.
        await linkInboundToOpenCase(saved.id);
        await autoReplyToInbound(event, saved.id);
        // A photo, voice note, video or document: fetched and kept after the answer (it never fails the webhook either).
        if (event.media && event.mediaKind) after(() => saveInboundMedia(event, saved.id));
      }
    }
    return NextResponse.json({ received: true, stored });
  } catch (error) {
    console.error('[webhooks/evolution] processing failed:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
