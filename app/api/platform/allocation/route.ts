import { NextRequest, NextResponse } from 'next/server';
import { getAllocation, parseResource } from '@/lib/platform/allocation';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?resource=storageMb|whatsappMessagesMonth|portoRunsMonth|maxUsers — total, distributed, free and each organization's share. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const resource = parseResource(request.nextUrl.searchParams.get('resource') ?? 'storageMb');
    return NextResponse.json(await getAllocation(resource));
  });
}
