import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { parseOrganizationSettingsInput } from '@/lib/organization-settings';
import { getOrganizationSettings, saveOrganizationSettings } from '@/lib/organization-settings-store';
import { getOrganizationDetail, PlatformError } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** The organization's business rules, edited by the owner (same rules as the admin's own screen). */
export async function PUT(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    await getOrganizationDetail(id); // 404 for an unknown organization

    const before = await getOrganizationSettings(id);
    const input = await readJson(request);
    // Fields left out keep their current value, so a screen that only knows some of them can save.
    const parsed = parseOrganizationSettingsInput(input && typeof input === 'object' ? { ...before, ...(input as Record<string, unknown>) } : input);
    if (parsed.error !== undefined) throw new PlatformError(parsed.error);

    const settings = await saveOrganizationSettings(id, parsed.settings, owner.userId);

    await recordAudit({
      organizationId: id,
      actorId: owner.userId,
      actorRole: 'platform_owner',
      action: 'organization_settings.updated',
      targetType: 'organization',
      targetId: id,
      details: { before, after: settings },
    });

    return NextResponse.json({ settings });
  });
}
