import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, verifyAuth, verifyToken, type TokenPayload } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PREVIEW_ORIGIN_COOKIE } from '@/lib/preview-mode';
import { normalizeVisibility } from '@/lib/technician-visibility';
import {
  countVisibilityOverrides,
  deleteVisibility,
  GLOBAL_VISIBILITY_SCOPE,
  loadVisibilitySnapshot,
  saveVisibility,
} from '@/lib/technician-visibility-store';

export const runtime = 'nodejs';

type Scope = 'technician' | 'global';

/**
 * Returns the id of the admin acting on this request, or null.
 *
 * The settings are edited from inside a preview session, where the live auth cookie belongs to the
 * technician being previewed. The admin is proven by the parked origin token instead — and only if
 * it is the same admin who opened this preview (`previewBy`), so a stale origin cookie from some
 * other session can't be replayed. Middleware lets this route's writes through a preview for that
 * reason; everything else stays read-only.
 */
async function resolveAdminId(request: NextRequest, auth: TokenPayload | null): Promise<string | null> {
  if (!auth) return null;

  let adminId: string | null = null;

  if (!auth.preview) {
    adminId = auth.role === 'admin' ? auth.userId : null;
  } else {
    const originToken = request.cookies.get(PREVIEW_ORIGIN_COOKIE)?.value;
    const origin = originToken ? await verifyToken(originToken) : null;

    if (origin && origin.role === 'admin' && !origin.preview && origin.userId === auth.previewBy) {
      adminId = origin.userId;
    }
  }

  if (!adminId) return null;

  // The token says admin, but the account could have been demoted or removed since it was minted.
  const rows = await sql`
    SELECT role FROM users
    WHERE id = ${adminId}
      AND organization_id = ${auth.organizationId}
      AND deleted_at IS NULL
      AND status = 'active'
    LIMIT 1
  `;
  return rows[0]?.role === 'admin' ? adminId : null;
}

/** In preview the technician is whoever is being previewed; a plain admin session must name one. */
function resolveTechnicianId(
  user: { role: string; technician_id?: string | null },
  requested: string | null | undefined,
): string | null {
  if (user.role === 'technician') return user.technician_id ?? null;
  return typeof requested === 'string' && requested ? requested : null;
}

async function loadTechnician(organizationId: string, technicianId: string) {
  const rows = await sql`
    SELECT id, name FROM technicians
    WHERE id = ${technicianId}
      AND organization_id = ${organizationId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0] ? { id: rows[0].id as string, name: rows[0].name as string } : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const organizationId = user?.organization_id;

    if (!user || !organizationId) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    // Plain read: the technician's own screens asking what they may show.
    if (searchParams.get('detail') !== '1') {
      const technicianId = user.role === 'technician' ? user.technician_id ?? null : null;
      const { effective, source } = await loadVisibilitySnapshot(organizationId, technicianId);
      return NextResponse.json({ settings: effective, source });
    }

    // Detailed read for the admin modal: both layers, so it can show what's inherited.
    const adminId = await resolveAdminId(request, await verifyAuth(request));

    if (!adminId) {
      return NextResponse.json({ error: 'Apenas administradores podem ver esta configuração.' }, { status: 403 });
    }

    const technicianId = resolveTechnicianId(user, searchParams.get('technicianId'));
    const technician = technicianId ? await loadTechnician(organizationId, technicianId) : null;
    const [snapshot, overrideCount] = await Promise.all([
      loadVisibilitySnapshot(organizationId, technician?.id ?? null),
      countVisibilityOverrides(organizationId),
    ]);

    return NextResponse.json({ technician, overrideCount, ...snapshot });
  } catch (error) {
    console.error('[technician-visibility] GET error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const organizationId = user?.organization_id;
    const adminId = user ? await resolveAdminId(request, await verifyAuth(request)) : null;

    if (!user || !organizationId || !adminId) {
      return NextResponse.json({ error: 'Apenas administradores podem alterar esta configuração.' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    const scope: Scope | null = body?.scope === 'global' || body?.scope === 'technician' ? body.scope : null;

    if (!scope || !body?.settings) {
      return NextResponse.json({ error: 'Informe o escopo e as configurações.' }, { status: 400 });
    }

    const settings = normalizeVisibility(body.settings);

    if (scope === 'global') {
      await saveVisibility(organizationId, GLOBAL_VISIBILITY_SCOPE, settings, adminId);
      return NextResponse.json({ success: true, settings });
    }

    const technicianId = resolveTechnicianId(user, body.technicianId);
    const technician = technicianId ? await loadTechnician(organizationId, technicianId) : null;

    if (!technician) {
      return NextResponse.json({ error: 'Técnico não encontrado.' }, { status: 404 });
    }

    await saveVisibility(organizationId, technician.id, settings, adminId);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('[technician-visibility] PUT error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}

/** Drops a technician's override so they fall back to the settings for all technicians. */
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    const organizationId = user?.organization_id;
    const adminId = user ? await resolveAdminId(request, await verifyAuth(request)) : null;

    if (!user || !organizationId || !adminId) {
      return NextResponse.json({ error: 'Apenas administradores podem alterar esta configuração.' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const technicianId = resolveTechnicianId(user, searchParams.get('technicianId'));
    // Looked up rather than trusted, so this can only ever drop a technician's own row — never
    // the global one, whose key is just another string in the same column.
    const technician = technicianId ? await loadTechnician(organizationId, technicianId) : null;

    if (!technician) {
      return NextResponse.json({ error: 'Técnico não encontrado.' }, { status: 404 });
    }

    await deleteVisibility(organizationId, technician.id, adminId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[technician-visibility] DELETE error:', error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
