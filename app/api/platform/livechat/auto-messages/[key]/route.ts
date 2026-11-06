import { NextRequest, NextResponse } from 'next/server';
import { describeHours } from '@/lib/livechat/auto-messages';
import { saveAutoMessage } from '@/lib/livechat/auto-store';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** { enabled?, body?, hours?, reset? } — changes one automatic message (admins only). `reset` goes back to the default text and state. */
export async function PUT(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  return withPlatformOwner(request, async (owner) => {
    const { key } = await context.params;
    const { messages, hours } = await saveAutoMessage(key, await readJson(request), { id: owner.userId, role: owner.role });
    return NextResponse.json({ messages, hours, hoursText: describeHours(hours) });
  });
}
