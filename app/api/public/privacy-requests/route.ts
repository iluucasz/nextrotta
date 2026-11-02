import { NextRequest, NextResponse } from 'next/server';
import { submitPrivacyRequest } from '@/lib/privacy/requests';
import { PlatformError } from '@/lib/platform/errors';
import { clientIp } from '@/lib/security/throttle';

export const runtime = 'nodejs';

/** The public channel for data-subject requests (LGPD art. 18). Honeypot plus a per-sender hourly limit. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Envio inválido.' }, { status: 400 });
  try {
    const ip = clientIp(request.headers);
    await submitPrivacyRequest(body as Record<string, unknown>, ip === 'unknown' ? null : ip);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[public/privacy-requests] error:', error);
    return NextResponse.json({ error: 'Não foi possível enviar agora. Tente de novo em instantes.' }, { status: 500 });
  }
}
