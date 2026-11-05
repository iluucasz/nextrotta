import { NextRequest, NextResponse } from 'next/server';
import { getOrganizationDetail, getOrganizationForSupport, updateOrganization } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Organization data, usage, integrations, settings and provisioning state. */
export async function GET(request: NextRequest, context: Context) {
  // A support user gets the reduced view (no plans, values, integrations or usage), decided here and not in the screen.
  return withPlatformStaff(request, async (staff) => {
    const { id } = await context.params;
    return NextResponse.json(staff.role === 'platform_owner' ? await getOrganizationDetail(id) : await getOrganizationForSupport(id));
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
