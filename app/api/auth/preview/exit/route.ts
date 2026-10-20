import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { PREVIEW_FLAG_COOKIE, PREVIEW_ORIGIN_COOKIE } from '@/lib/preview-mode';

const WEEK_IN_SECONDS = 60 * 60 * 24 * 7;

/** Restores the admin session parked by POST /api/auth/preview. */
export async function POST(request: NextRequest) {
  try {
    const originToken = request.cookies.get(PREVIEW_ORIGIN_COOKIE)?.value;

    if (!originToken) {
      return NextResponse.json({ error: 'Nenhuma sessão de preview ativa.' }, { status: 400 });
    }

    const origin = await verifyToken(originToken);

    // The parked token is only honored if it still verifies and is still an admin one — otherwise
    // this endpoint would be a way to install an arbitrary cookie as a live session.
    if (!origin || origin.role !== 'admin' || origin.preview) {
      const expired = NextResponse.json(
        { error: 'A sessão de origem expirou. Faça login novamente.' },
        { status: 401 },
      );
      expired.cookies.set({ name: PREVIEW_ORIGIN_COOKIE, value: '', httpOnly: true, maxAge: 0, path: '/' });
      expired.cookies.set({ name: PREVIEW_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });
      expired.cookies.set({ name: 'auth-token', value: '', httpOnly: true, maxAge: 0, path: '/' });
      return expired;
    }

    const response = NextResponse.json({ success: true });
    const secure = process.env.NODE_ENV === 'production';

    response.cookies.set({
      name: 'auth-token',
      value: originToken,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: WEEK_IN_SECONDS,
      path: '/',
    });

    response.cookies.set({ name: PREVIEW_ORIGIN_COOKIE, value: '', httpOnly: true, maxAge: 0, path: '/' });
    response.cookies.set({ name: PREVIEW_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });

    return response;
  } catch (error) {
    console.error('[auth/preview] exit error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
