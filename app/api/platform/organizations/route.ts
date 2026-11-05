import { NextRequest, NextResponse } from 'next/server';
import { createOrganization, listOrganizations, listOrganizationsForSupport } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner, withPlatformStaff } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?status=active|provisioning|...&search=texto */
export async function GET(request: NextRequest) {
  // The owner sees everything (plans, values); a support user ("atendente") only who the companies are and how to reach them.
  return withPlatformStaff(request, async (staff) => {
    const filters = { status: request.nextUrl.searchParams.get('status'), search: request.nextUrl.searchParams.get('search') };
    const organizations = staff.role === 'platform_owner' ? await listOrganizations(filters) : await listOrganizationsForSupport(filters);
    return NextResponse.json({ organizations });
  });
}

/**
 * Creates the organization in `provisioning` state. The steps run on
 * POST /api/platform/organizations/:id/provisioning.
 */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const organization = await createOrganization(await readJson(request), { id: owner.userId });
    return NextResponse.json({ organization }, { status: 201 });
  });
}
