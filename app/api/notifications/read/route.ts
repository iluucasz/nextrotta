import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { markNotificationsRead } from '@/lib/notifications';

export const runtime = 'nodejs';

/** { ids: string[] } marks those as read; { all: true } marks every notification the person can see. */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id): id is string => typeof id === 'string') : [];
    if (!body?.all && !ids.length) return NextResponse.json({ error: 'Informe quais notificações marcar como lidas.' }, { status: 400 });

    await markNotificationsRead({
      organizationId: auth.organizationId,
      userId: auth.userId,
      isAdmin: auth.role === 'admin',
      ids: body?.all ? undefined : ids,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[notifications] read error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
