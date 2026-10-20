import { NextRequest, NextResponse } from 'next/server';
import { checkWhatsAppNumber } from '@/lib/whatsapp/evolution';
import { validatePhone } from '@/lib/whatsapp/phone';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { connectionFromConfig, getWhatsAppConfig } from '@/lib/whatsapp/store';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

/**
 * GET /api/whatsapp/check-number?phone=... — validates the format and, when WhatsApp is configured,
 * asks Evolution whether the number actually has a WhatsApp account.
 *
 * `whatsapp` is `null` when that second check couldn't be made (not configured, Evolution offline):
 * the number may still be fine, it just wasn't confirmed.
 */
export async function GET(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  const validation = validatePhone(request.nextUrl.searchParams.get('phone'));

  if (validation.status !== 'valid') {
    return NextResponse.json({
      valid: false,
      message: validation.status === 'empty' ? 'Informe um telefone.' : validation.message,
      whatsapp: null,
    });
  }

  const base = { valid: true, formatted: validation.formatted, e164: validation.e164, mobile: validation.mobile };

  try {
    const connection = connectionFromConfig(await getWhatsAppConfig(auth.organizationId));

    if (!connection) {
      return NextResponse.json({ ...base, whatsapp: null, message: 'Formato válido. WhatsApp não configurado para confirmar o número.' });
    }

    const check = await checkWhatsAppNumber(connection, validation.e164);

    if (check.error) {
      return NextResponse.json({ ...base, whatsapp: null, message: `Formato válido, mas não foi possível confirmar no WhatsApp (${check.error}).` });
    }

    return NextResponse.json({
      ...base,
      whatsapp: check.exists,
      message: check.exists ? 'Número com WhatsApp ativo.' : 'Este número não tem WhatsApp.',
    });
  } catch (error) {
    console.error('[whatsapp/check-number] error:', error);
    return NextResponse.json({ ...base, whatsapp: null, message: 'Formato válido, mas não foi possível confirmar no WhatsApp.' });
  }
}
