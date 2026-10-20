import { NextRequest, NextResponse } from 'next/server';
import { PlatformError } from '@/lib/platform/errors';
import { getOrganizationDetail } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { releaseOrganization } from '@/lib/signup';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** { action: "release" } — opens the system to a company that subscribed on the site (end of the preparation). */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const body = await readJson(request);
    if (body.action !== 'release') throw new PlatformError('Ação inválida.');
    await getOrganizationDetail(id); // 404 for an unknown id
    await releaseOrganization(id, owner.userId);
    return NextResponse.json({ organization: await getOrganizationDetail(id) });
  });
}
