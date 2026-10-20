import { NextRequest, NextResponse } from 'next/server';
import { getEvolutionConnectionState } from '@/lib/whatsapp/evolution';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';
import { connectionFromConfig, getWhatsAppConfig } from '@/lib/whatsapp/store';
import { blockUnlessFeature } from '@/lib/billing/require-feature';

export const runtime = 'nodejs';

/** "Testar conexão": asks Evolution whether the instance is connected to WhatsApp. */
export async function POST(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const featureBlocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (featureBlocked) return featureBlocked;

  try {
    const connection = connectionFromConfig(await getWhatsAppConfig(auth.organizationId));

    if (!connection) {
      return NextResponse.json({ connected: false, state: null, error: 'O WhatsApp da empresa ainda não foi conectado. Crie a instância e leia o QR Code.' });
    }

    return NextResponse.json(await getEvolutionConnectionState(connection));
  } catch (error) {
    console.error('[whatsapp/connection] error:', error);
    return NextResponse.json({ error: 'Erro ao testar a conexão.' }, { status: 500 });
  }
}
