import { NextRequest, NextResponse } from 'next/server';
import { describeHours } from '@/lib/livechat/auto-messages';
import { loadAutoMessages } from '@/lib/livechat/auto-store';
import { withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The automatic messages as they are now (defaults plus the owner's changes) and the business hours. The whole team reads them (the closing texts fill the "Encerrar" windows). */
export async function GET(request: NextRequest) {
  return withPlatformStaff(request, async () => {
    const { messages, hours } = await loadAutoMessages();
    return NextResponse.json({ messages, hours, hoursText: describeHours(hours) });
  });
}
