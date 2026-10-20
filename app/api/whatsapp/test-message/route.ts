import { NextRequest, NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/whatsapp/evolution';
import { sendTestMessage } from '@/lib/whatsapp/notifications';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const body = await request.json().catch(() => null);
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (!normalizePhone(phone)) {
      return NextResponse.json({ error: 'Informe um telefone válido com DDD.' }, { status: 400 });
    }

    if (!message) {
      return NextResponse.json({ error: 'Escreva a mensagem de teste.' }, { status: 400 });
    }

    const result = await sendTestMessage(auth.organizationId, { phone, message, createdBy: auth.userId });

    if (result.outcome !== 'sent') {
      return NextResponse.json({ error: result.error ?? 'Não foi possível enviar.' }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[whatsapp/test-message] error:', error);
    return NextResponse.json({ error: 'Erro ao enviar a mensagem de teste.' }, { status: 500 });
  }
}
