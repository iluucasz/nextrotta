import { NextRequest, NextResponse } from 'next/server';
import { normalizeNotificationSettings } from '@/lib/whatsapp/notification-types';
import { validatePhone } from '@/lib/whatsapp/phone';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { getWhatsAppConfig, saveWhatsAppConfig } from '@/lib/whatsapp/store';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const config = await getWhatsAppConfig(auth.organizationId);

    // The Evolution server's URL and key never leave the backend; the connection itself is read
    // from /api/whatsapp/instance.
    return NextResponse.json({
      enabled: config.enabled,
      testPhone: config.testPhone,
      appUrl: config.appUrl,
      notifications: config.notifications,
      updatedAt: config.updatedAt,
    });
  } catch (error) {
    console.error('[whatsapp/config] GET error:', error);
    return NextResponse.json({ error: 'Erro ao carregar a configuração do WhatsApp.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }

    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
    const appUrl = text(body.appUrl);

    if (appUrl && !/^https?:\/\//i.test(appUrl)) {
      return NextResponse.json({ error: 'O link do sistema deve começar com http:// ou https://.' }, { status: 400 });
    }

    const testPhone = validatePhone(text(body.testPhone));
    if (testPhone.status === 'incomplete' || testPhone.status === 'invalid') {
      return NextResponse.json({ error: `Número de teste: ${testPhone.message}` }, { status: 400 });
    }

    await saveWhatsAppConfig(
      auth.organizationId,
      {
        enabled: body.enabled === true,
        testPhone: testPhone.status === 'valid' ? testPhone.formatted : '',
        appUrl,
        notifications: normalizeNotificationSettings(body.notifications),
      },
      auth.userId,
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[whatsapp/config] PUT error:', error);
    return NextResponse.json({ error: 'Erro ao salvar a configuração do WhatsApp.' }, { status: 500 });
  }
}
