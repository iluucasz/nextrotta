import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyWebhookSignature } from '@/lib/mercadopago/client';
import { mercadoPagoWebhookSecret } from '@/lib/mercadopago/config';
import { handleMercadoPagoNotification } from '@/lib/parts/sales';

export const runtime = 'nodejs';

/**
 * Mercado Pago notifications (orders and payments of the technicians' accounts). Nothing in the
 * body is trusted: it only says which sale to check, and the check asks Mercado Pago itself with
 * the technician's token (MERCADOPAGO_WEBHOOK_SECRET validates the signature when present).
 */
export async function POST(request: NextRequest) {
  const text = await request.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
  const dataId = params.get('data.id') ?? params.get('id') ?? (data.id !== undefined ? String(data.id) : null);
  const type = params.get('type') ?? params.get('topic') ?? (typeof body.type === 'string' ? body.type : null);
  const mpUserId = body.user_id !== undefined && body.user_id !== null ? String(body.user_id) : null;

  // A signed call with a wrong signature is refused. Unsigned ones (e.g. a payment link's
  // notification_url, which may arrive without x-signature) go on: they can only trigger a check.
  const secret = mercadoPagoWebhookSecret();
  if (secret && request.headers.get('x-signature')) {
    const valid = verifyWebhookSignature({
      signature: request.headers.get('x-signature'),
      requestId: request.headers.get('x-request-id'),
      dataId: params.get('data.id') ?? dataId,
      secret,
    });
    if (!valid) return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
  }

  const event = (
    await sql`
      INSERT INTO mercadopago_webhook_events (topic, action, resource_id, mp_user_id, live_mode, payload)
      VALUES (${type}, ${typeof body.action === 'string' ? body.action : null}, ${dataId}, ${mpUserId},
              ${typeof body.live_mode === 'boolean' ? body.live_mode : null}, ${JSON.stringify(body)}::jsonb)
      RETURNING id
    `
  )[0];

  try {
    const saleId = await handleMercadoPagoNotification({ type, dataId, mpUserId });
    await sql`UPDATE mercadopago_webhook_events SET processed_at = NOW(), sale_id = ${saleId} WHERE id = ${event.id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[mercadopago] webhook:', error);
    await sql`UPDATE mercadopago_webhook_events SET error = ${message} WHERE id = ${event.id}`;
    // Mercado Pago retries non-2xx answers later.
    return NextResponse.json({ error: 'Falha ao processar.' }, { status: 500 });
  }
}
