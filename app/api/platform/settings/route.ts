import { NextRequest, NextResponse } from 'next/server';
import { getIntegrationsStatus } from '@/lib/platform/operations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { getPlatformSettings, updatePlatformSettings } from '@/lib/platform/settings';

export const runtime = 'nodejs';

/** Platform settings plus the real status of each external integration. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const [settings, integrations] = await Promise.all([getPlatformSettings(), getIntegrationsStatus()]);
    return NextResponse.json({ settings, integrations });
  });
}

/** Any of { defaultGraceDays, reservedSubdomains, maintenance: { enabled, message }, ai: {…}, reason }. */
export async function PUT(request: NextRequest) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json({ settings: await updatePlatformSettings(await readJson(request), { id: owner.userId }) }),
  );
}
