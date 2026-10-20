import { NextRequest, NextResponse } from 'next/server';
import { isScheduledNotification, runNotificationNow } from '@/lib/whatsapp/notifications';
import { NOTIFICATION_TYPES, type NotificationType } from '@/lib/whatsapp/notification-types';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';
// Sends are sequential with a pause between them; a full team fits well inside this.
export const maxDuration = 120;

/** "Rodar agora" for a scheduled notification. Never re-sends what was already sent. */
export async function POST(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const body = await request.json().catch(() => null);
    const type = NOTIFICATION_TYPES.includes(body?.type) ? (body.type as NotificationType) : null;

    if (!type || !isScheduledNotification(type)) {
      return NextResponse.json({ error: 'Notificação inválida para execução manual.' }, { status: 400 });
    }

    const summary = await runNotificationNow(auth.organizationId, type, { createdBy: auth.userId });
    return NextResponse.json({ summary });
  } catch (error) {
    console.error('[whatsapp/run] error:', error);
    return NextResponse.json({ error: 'Erro ao executar a notificação.' }, { status: 500 });
  }
}
