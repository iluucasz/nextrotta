import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { handleAsaasEvent } from '@/lib/billing/billing';

export const runtime = 'nodejs';

function tokenMatches(received: string | null) {
  const expected = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Asaas payment events. Authenticated by the token configured in the Asaas webhook settings, sent
 * in the `asaas-access-token` header. Answers 200 for anything handled (including redeliveries);
 * a 500 makes Asaas retry later.
 */
export async function POST(request: NextRequest) {
  if (!tokenMatches(request.headers.get('asaas-access-token'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const event = await request.json().catch(() => null);
  if (!event || typeof event !== 'object') {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    const result = await handleAsaasEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error('[webhooks/asaas] processing failed:', error);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
