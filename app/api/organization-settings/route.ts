import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { verifyOrganizationAuth } from '@/lib/auth';
import { parseOrganizationSettingsInput, pickTechnicianSettings } from '@/lib/organization-settings';
import { getOrganizationSettings, getOrganizationSettingsMeta, saveOrganizationSettings } from '@/lib/organization-settings-store';

export const runtime = 'nodejs';

/** Admins get every setting; technicians (or an admin previewing one) only what their own screens use. */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const settings = await getOrganizationSettings(auth.organizationId);

    // Salaries and the default commission never leave the admin side.
    if (auth.role !== 'admin' || auth.preview) {
      return NextResponse.json({ settings: pickTechnicianSettings(settings) });
    }

    return NextResponse.json({ settings, ...(await getOrganizationSettingsMeta(auth.organizationId)) });
  } catch (error) {
    console.error('[organization-settings] GET error:', error);
    return NextResponse.json({ error: 'Erro ao carregar as configurações.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin' || auth.preview) {
      return NextResponse.json({ error: 'Apenas administradores podem alterar as configurações.' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const input = body?.settings ?? body;
    const before = await getOrganizationSettings(auth.organizationId);
    // Fields left out keep their current value, so a screen that only knows some of them can save.
    const parsed = parseOrganizationSettingsInput(input && typeof input === 'object' ? { ...before, ...input } : input);
    if (parsed.error !== undefined) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const settings = await saveOrganizationSettings(auth.organizationId, parsed.settings, auth.userId);

    await recordAudit({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: auth.impersonationId ? 'platform_owner' : auth.role,
      impersonationId: auth.impersonationId ?? null,
      action: 'organization_settings.updated',
      targetType: 'organization',
      targetId: auth.organizationId,
      details: { before, after: settings },
    });

    return NextResponse.json({ settings, ...(await getOrganizationSettingsMeta(auth.organizationId)) });
  } catch (error) {
    console.error('[organization-settings] PUT error:', error);
    return NextResponse.json({ error: 'Erro ao salvar as configurações.' }, { status: 500 });
  }
}
