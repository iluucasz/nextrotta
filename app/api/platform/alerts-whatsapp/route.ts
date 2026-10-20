import { NextRequest, NextResponse } from 'next/server';
import { connectAlertsWhatsApp, disconnectAlertsWhatsApp, getAlertsWhatsAppStatus } from '@/lib/platform/alerts';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The platform's own WhatsApp (instance `nextrotta-alertas`) that sends the owner's alerts. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getAlertsWhatsAppStatus()));
}

/** Creates the instance when needed and returns a QR code to connect it (call again for a fresh code). */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await connectAlertsWhatsApp()));
}

/** Disconnects the number (the instance stays, ready for another QR code). */
export async function DELETE(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await disconnectAlertsWhatsApp()));
}
