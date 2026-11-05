import { NextRequest, NextResponse } from 'next/server';
import { listConversations, unreadSummary } from '@/lib/livechat/store';
import { withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The inbox: conversations (newest activity first) and how many have something unread. ?status=open|closed|all&q= */
export async function GET(request: NextRequest) {
  return withPlatformStaff(request, async () => {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const [conversations, unread] = await Promise.all([
      listConversations({ status: status === 'closed' || status === 'all' ? status : 'open', search: params.get('q') ?? '' }),
      unreadSummary(),
    ]);
    return NextResponse.json({ conversations, unread });
  });
}
