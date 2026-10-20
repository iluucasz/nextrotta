import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { verifyAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { IMPERSONATION_FLAG_COOKIE } from '@/lib/preview-mode';
import { rootUrl } from '@/lib/tenant-host';

/**
 * Ends the platform owner's session inside an organization. The session row is closed, so the
 * token stops working everywhere, and the owner goes back to the platform panel.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyAuth(request);
    if (!auth?.impersonationId) {
      return NextResponse.json({ error: 'Nenhum acesso do dono em andamento.' }, { status: 400 });
    }

    await sql`
      UPDATE impersonation_sessions
      SET ended_at = NOW()
      WHERE id = ${auth.impersonationId}
        AND ended_at IS NULL
    `;

    await recordAudit({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: 'platform_owner',
      impersonationId: auth.impersonationId,
      action: 'impersonation.ended',
    });

    const response = NextResponse.json({ success: true, redirectTo: rootUrl('/plataforma', request) });
    response.cookies.set({ name: 'auth-token', value: '', httpOnly: true, maxAge: 0, path: '/' });
    response.cookies.set({ name: IMPERSONATION_FLAG_COOKIE, value: '', maxAge: 0, path: '/' });
    return response;
  } catch (error) {
    console.error('[auth/impersonation/exit] error:', error);
    return NextResponse.json({ error: 'Erro ao encerrar o acesso.' }, { status: 500 });
  }
}
