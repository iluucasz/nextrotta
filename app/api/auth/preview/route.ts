import { NextRequest, NextResponse } from 'next/server';
import { createToken, verifyAuth } from '@/lib/auth';
import { PREVIEW_FLAG_COOKIE, PREVIEW_ORIGIN_COOKIE } from '@/lib/preview-mode';
import { sql } from '@/lib/db';

const WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

/**
 * Starts an admin "preview" (impersonation) session for a technician: the admin's own token is
 * parked in a separate httpOnly cookie and the auth cookie is swapped for a technician token
 * carrying `preview: true`.
 *
 * That flag is what makes the session safe — middleware rejects every non-GET request made while
 * it's set, so a preview can look at the technician's screens but never write anything as them.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);

    if (!auth || auth.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // An admin token can't already be a preview token, but check anyway: nesting previews would
    // overwrite the parked origin token and strand the admin without a session to return to.
    if (auth.preview || request.cookies.get(PREVIEW_ORIGIN_COOKIE)) {
      return NextResponse.json({ error: 'Já existe uma sessão de preview ativa.' }, { status: 409 });
    }

    const { technicianId } = await request.json();

    if (!technicianId || typeof technicianId !== 'string') {
      return NextResponse.json({ error: 'Técnico não informado.' }, { status: 400 });
    }

    const rows = await sql`
      SELECT t.id, t.name, t.status, t.user_id, u.email, u.role
      FROM technicians t
      LEFT JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
      WHERE t.id = ${technicianId}
        AND t.organization_id = ${auth.organizationId}
        AND t.deleted_at IS NULL
      LIMIT 1
    `;

    if (!rows.length) {
      return NextResponse.json({ error: 'Técnico não encontrado.' }, { status: 404 });
    }

    const technician = rows[0];

    if (!technician.user_id || !technician.email) {
      return NextResponse.json(
        { error: 'Este técnico não tem usuário de acesso vinculado, então não há sessão para visualizar.' },
        { status: 422 },
      );
    }

    // getCurrentUser() refuses to resolve a technician session whose record isn't active, so
    // previewing one would drop straight to /login with the admin's token already swapped out.
    if (technician.status !== 'active') {
      return NextResponse.json(
        { error: 'Só é possível visualizar técnicos ativos.' },
        { status: 422 },
      );
    }

    const originToken = request.cookies.get('auth-token')?.value;

    if (!originToken) {
      return NextResponse.json({ error: 'Sessão de origem não encontrada.' }, { status: 401 });
    }

    const previewToken = await createToken({
      userId: technician.user_id as string,
      email: technician.email as string,
      role: 'technician',
      organizationId: auth.organizationId,
      organizationSlug: auth.organizationSlug,
      preview: true,
      previewBy: auth.userId,
    });

    const response = NextResponse.json({
      success: true,
      technician: { id: technician.id, name: technician.name },
    });

    const secure = process.env.NODE_ENV === 'production';

    response.cookies.set({
      name: PREVIEW_ORIGIN_COOKIE,
      value: originToken,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: WEEK_IN_SECONDS,
      path: '/',
    });

    response.cookies.set({
      name: 'auth-token',
      value: previewToken,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: WEEK_IN_SECONDS,
      path: '/',
    });

    // Deliberately readable by the client: the shell uses it to show the preview banner without an
    // extra request. It authorizes nothing on its own.
    response.cookies.set({
      name: PREVIEW_FLAG_COOKIE,
      value: '1',
      httpOnly: false,
      secure,
      sameSite: 'lax',
      maxAge: WEEK_IN_SECONDS,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[auth/preview] start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
