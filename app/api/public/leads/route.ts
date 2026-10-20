import { NextRequest, NextResponse } from 'next/server';
import { PlatformError } from '@/lib/platform/errors';
import { submitLead } from '@/lib/platform/leads';

export const runtime = 'nodejs';

/** The marketing site's contact and sign-up forms. Public, with a honeypot and a per-sender hourly limit. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Envio inválido.' }, { status: 400 });

  const sourceIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip');
  try {
    await submitLead(body as Record<string, unknown>, sourceIp ?? null);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[public/leads] error:', error);
    return NextResponse.json({ error: 'Não foi possível enviar agora. Tente de novo ou fale pelo WhatsApp.' }, { status: 500 });
  }
}
