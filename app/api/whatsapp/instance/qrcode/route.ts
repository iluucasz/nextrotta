import { NextRequest, NextResponse } from 'next/server';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { PlatformError } from '@/lib/platform/errors';
import { getQrCode } from '@/lib/whatsapp/instance';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';

export const runtime = 'nodejs';

/** A fresh QR code for the organization's instance; { connected: true } once the number is linked. */
export async function GET(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  const blocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (blocked) return blocked;
  try {
    return NextResponse.json(await getQrCode(auth.organizationId));
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[whatsapp/instance/qrcode] error:', error);
    return NextResponse.json({ error: 'Erro ao gerar o QR Code.' }, { status: 500 });
  }
}
