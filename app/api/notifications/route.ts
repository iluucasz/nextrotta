import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { runNotificationChecks } from '@/lib/notification-checks';
import { countUnreadNotifications, listNotifications } from '@/lib/notifications';

export const runtime = 'nodejs';

/**
 * The notifications of the person's own company plus the general ones from the platform.
 * `?check=1` (sent when the page opens, and every few minutes) also looks for things worth telling: the escala
 * running out, a module under maintenance, a folha left open, the WhatsApp disconnected, the storage filling up.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const isAdmin = auth.role === 'admin';
    const params = { organizationId: auth.organizationId, userId: auth.userId, isAdmin };

    if (isAdmin && request.nextUrl.searchParams.get('check') === '1') {
      await runNotificationChecks(auth.organizationId);
    }

    const limit = Number(request.nextUrl.searchParams.get('limit')) || 30;
    const [items, unread] = await Promise.all([listNotifications({ ...params, limit }), countUnreadNotifications(params)]);

    return NextResponse.json({ items, unread });
  } catch (error) {
    console.error('[notifications] list error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
