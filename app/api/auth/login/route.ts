import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { createToken } from '@/lib/auth';
import { createLoginHandoff } from '@/lib/auth-handoff';
import { sql } from '@/lib/db';
import { PREVIEW_FLAG_COOKIE, PREVIEW_ORIGIN_COOKIE } from '@/lib/preview-mode';
import { organizationUrl, resolveHost } from '@/lib/tenant-host';

const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';

/**
 * Login always happens on the root domain. The e-mail identifies the organization: organization
 * users get a one-time handoff link to their subdomain (where the session cookie is set), the
 * platform owner gets a session here and goes to the platform panel.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ error: 'Informe e-mail e senha.' }, { status: 400 });
    }

    const users = await sql`
      SELECT
        u.id, u.email, u.password_hash, u.role, u.status, u.organization_id,
        o.slug AS organization_slug, o.status AS organization_status,
        t.id AS technician_id, t.status AS technician_status
      FROM users u
      LEFT JOIN organizations o ON o.id = u.organization_id AND o.deleted_at IS NULL
      LEFT JOIN technicians t ON t.user_id = u.id AND t.deleted_at IS NULL
      WHERE u.email = ${email.trim().toLowerCase()}
        AND u.deleted_at IS NULL
      LIMIT 1
    `;

    const user = users[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
    }

    if (user.status !== 'active') {
      return NextResponse.json({ error: 'Acesso inativo. Fale com o administrador.' }, { status: 403 });
    }

    if (user.role === 'technician' && (!user.technician_id || user.technician_status !== 'active')) {
      return NextResponse.json({ error: 'Acesso inativo. Fale com o administrador.' }, { status: 403 });
    }

    if (user.role !== 'platform_owner') {
      if (!user.organization_slug) {
        return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
      }

      if (user.organization_status === 'provisioning') {
        return NextResponse.json(
          { error: 'O ambiente da sua empresa ainda está sendo preparado. Tente novamente em instantes.' },
          { status: 403 },
        );
      }
    }

    await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`;

    if (user.role !== 'platform_owner') {
      const code = await createLoginHandoff(user.id, user.organization_id);
      const redirectTo = organizationUrl(
        user.organization_slug,
        `/api/auth/handoff?code=${encodeURIComponent(code)}`,
        request,
      );

      const response = NextResponse.json({ success: true, redirectTo });
      // Remembers (on the root domain) where this person works, so the login page can send them
      // straight back while their session there is valid. Only the subdomain, never a token.
      response.cookies.set({
        name: 'last-organization',
        value: user.organization_slug,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7, // same lifetime as the session itself
        path: '/',
      });
      return response;
    }

    // The owner's session only exists on the root domain.
    if (resolveHost(request.headers.get('host')).kind !== 'root') {
      return NextResponse.json({ error: 'Entre pelo endereço principal da plataforma.' }, { status: 403 });
    }

    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: 'platform_owner',
      organizationId: null,
      organizationSlug: null,
    });

    const response = NextResponse.json({ success: true, redirectTo: '/plataforma' });

    response.cookies.set({
      name: 'auth-token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    // A fresh login always starts outside preview mode — clear any leftovers so a stale parked
    // token can't block the next preview or leave the banner showing.
    response.cookies.set({ name: PREVIEW_ORIGIN_COOKIE, value: '', httpOnly: true, maxAge: 0, path: '/' });
    response.cookies.set({ name: PREVIEW_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });

    return response;
  } catch (error) {
    console.error('[auth/login] error:', error);
    return NextResponse.json({ error: 'Erro interno. Tente novamente.' }, { status: 500 });
  }
}
