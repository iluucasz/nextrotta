import { NextResponse } from 'next/server';
import { IMPERSONATION_FLAG_COOKIE, PREVIEW_FLAG_COOKIE, PREVIEW_ORIGIN_COOKIE } from '@/lib/preview-mode';

export async function POST() {
  const response = NextResponse.json(
    { success: true },
    { status: 200 }
  );

  response.cookies.set({
    name: 'auth-token',
    value: '',
    httpOnly: true,
    maxAge: 0,
  });

  // Logging out from inside a preview would otherwise strand the parked admin token, and the next
  // attempt to start a preview would be rejected as "already active".
  response.cookies.set({ name: PREVIEW_ORIGIN_COOKIE, value: '', httpOnly: true, maxAge: 0, path: '/' });
  response.cookies.set({ name: PREVIEW_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });
  response.cookies.set({ name: IMPERSONATION_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });

  return response;
}
