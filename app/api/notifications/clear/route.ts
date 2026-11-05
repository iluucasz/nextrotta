import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { isSeverity } from '@/lib/notification-meta';
import { clearNotifications } from '@/lib/notifications';

export const runtime = 'nodejs';

/**
 * Clears notifications from the person's bell and list (nothing is deleted; "Limpas" shows them again).
 * { ids } clears those; { all: true } clears everything the filters match (severity, kind, scope), as shown on screen.
 * { restore: true } with the same shape brings them back.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      ids?: unknown;
      all?: unknown;
      restore?: unknown;
      severity?: unknown;
      kind?: unknown;
      scope?: unknown;
    } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
    if (!body?.all && !ids.length) return NextResponse.json({ error: 'Informe quais notificações limpar.' }, { status: 400 });

    await clearNotifications({
      organizationId: auth.organizationId,
      userId: auth.userId,
      isAdmin: auth.role === 'admin',
      ids: body?.all ? undefined : ids,
      restore: body?.restore === true,
      severity: isSeverity(body?.severity) ? body.severity : undefined,
      kind: typeof body?.kind === 'string' && /^[a-z_-]{1,40}$/.test(body.kind) ? body.kind : undefined,
      scope: body?.scope === 'company' || body?.scope === 'system' ? body.scope : undefined,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[notifications] clear error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
