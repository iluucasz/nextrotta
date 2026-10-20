import { NextRequest, NextResponse } from 'next/server';
import { startImpersonation } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { organizationUrl } from '@/lib/tenant-host';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/**
 * { reason } → { redirectTo }. The panel navigates there (full navigation) to land inside the
 * organization as the owner, with the warning banner and every change audited.
 */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const body = await readJson(request);
    const { slug, code } = await startImpersonation(id, typeof body.reason === 'string' ? body.reason : '', {
      id: owner.userId,
    });

    return NextResponse.json({
      redirectTo: organizationUrl(slug, `/api/auth/handoff?code=${encodeURIComponent(code)}`, request),
    });
  });
}
