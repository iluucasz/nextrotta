import { NextRequest, NextResponse } from 'next/server';
import { createOrganization, listOrganizations } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** ?status=active|provisioning|...&search=texto */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => {
    const organizations = await listOrganizations({
      status: request.nextUrl.searchParams.get('status'),
      search: request.nextUrl.searchParams.get('search'),
    });
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
