import { NextRequest, NextResponse } from 'next/server';
import { connectLivechatWhatsApp, disconnectLivechatWhatsApp, getLivechatWhatsAppStatus, refreshLivechatQr } from '@/lib/livechat/whatsapp';
import { withPlatformOwner, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The official WhatsApp of the live chat (instance `nextrotta-suporte`): is it connected, and to which number. */
export async function GET(request: NextRequest) {
  return withPlatformStaff(request, async () => NextResponse.json(await getLivechatWhatsAppStatus()));
}

/** Creates the instance when needed, points its webhook at the app and returns a QR code (call again for a fresh code). */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await connectLivechatWhatsApp()));
}

/** A fresh QR code and pairing code for the window that is open (they change every ~20 seconds). */
export async function PUT(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await refreshLivechatQr()));
}

/** Disconnects the number (the instance stays, ready for another QR code). */
export async function DELETE(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await disconnectLivechatWhatsApp()));
}
