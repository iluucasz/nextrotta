import { NextRequest, NextResponse } from 'next/server';
import { createToken } from '@/lib/auth';
import { redeemLoginHandoff } from '@/lib/auth-handoff';
import { IMPERSONATION_FLAG_COOKIE, PREVIEW_FLAG_COOKIE, PREVIEW_ORIGIN_COOKIE } from '@/lib/preview-mode';
import { resolveHost, rootUrl, sameHostUrl } from '@/lib/tenant-host';

/**
 * Landing point on the organization's subdomain after logging in on the root domain: redeems the
 * one-time code and sets a host-only session cookie, so it is never sent to another organization.
 */
export async function GET(request: NextRequest) {
  const backToLogin = () => NextResponse.redirect(rootUrl('/login?erro=link', request));

  try {
    const host = resolveHost(request.headers.get('host'));
    const code = request.nextUrl.searchParams.get('code');

    if (host.kind !== 'organization' || !code) {
      return backToLogin();
    }

    const user = await redeemLoginHandoff(code, host.slug);
    if (!user) {
      return backToLogin();
    }

    const token = await createToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organization_id,
      organizationSlug: user.organization_slug,
      ...(user.impersonation_id ? { impersonationId: user.impersonation_id } : {}),
    });

    const response = NextResponse.redirect(sameHostUrl(user.role === 'admin' ? '/admin' : '/dashboard', request));

    response.cookies.set({
      name: 'auth-token',
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });

    response.cookies.set({ name: PREVIEW_ORIGIN_COOKIE, value: '', httpOnly: true, maxAge: 0, path: '/' });
    response.cookies.set({ name: PREVIEW_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });
    response.cookies.set({
      name: IMPERSONATION_FLAG_COOKIE,
      value: user.impersonation_id ? '1' : '',
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: user.impersonation_id ? 60 * 60 * 24 * 7 : 0,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[auth/handoff] error:', error);
    return backToLogin();
  }
}
