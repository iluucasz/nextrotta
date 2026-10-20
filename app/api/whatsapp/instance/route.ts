import { NextRequest, NextResponse } from 'next/server';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { PlatformError } from '@/lib/platform/errors';
import { createInstance, disconnectInstance, getInstanceStatus } from '@/lib/whatsapp/instance';
import { requireWhatsAppAdmin } from '@/lib/whatsapp/require-admin';

export const runtime = 'nodejs';

async function guard(request: NextRequest) {
  const auth = await requireWhatsAppAdmin(request);
  if (!auth) return { response: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) };
  const blocked = await blockUnlessFeature(auth.organizationId, 'whatsapp');
  if (blocked) return { response: blocked };
  return { auth };
}

function failure(error: unknown) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[whatsapp/instance] error:', error);
  return NextResponse.json({ error: 'Erro ao falar com o WhatsApp.' }, { status: 500 });
}

/** The organization's instance: name (its subdomain), state and connected number. */
export async function GET(request: NextRequest) {
  const { auth, response } = await guard(request);
  if (!auth) return response;
  try {
    return NextResponse.json(await getInstanceStatus(auth.organizationId));
  } catch (error) {
    return failure(error);
  }
}

/** Creates the instance and returns the first QR code. */
export async function POST(request: NextRequest) {
  const { auth, response } = await guard(request);
  if (!auth) return response;
  try {
    return NextResponse.json(await createInstance(auth.organizationId, { userId: auth.userId, impersonationId: auth.impersonationId ?? null }));
  } catch (error) {
    return failure(error);
  }
}

/** Disconnects the WhatsApp number (the instance stays, ready for a new QR code). */
export async function DELETE(request: NextRequest) {
  const { auth, response } = await guard(request);
  if (!auth) return response;
  try {
    return NextResponse.json(await disconnectInstance(auth.organizationId, { userId: auth.userId, impersonationId: auth.impersonationId ?? null }));
  } catch (error) {
    return failure(error);
  }
}
