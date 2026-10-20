import { NextRequest, NextResponse } from 'next/server';
import { getOrganizationDetail, updateOrganization } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Organization data, usage, integrations, settings and provisioning state. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    return NextResponse.json(await getOrganizationDetail(id));
  });
}

/** Company data: name, legalName, document, email, phone, city, state. The subdomain never changes. */
export async function PATCH(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const organization = await updateOrganization(id, await readJson(request), { id: owner.userId });
    return NextResponse.json({ organization });
  });
}
