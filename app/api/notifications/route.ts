import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { runNotificationChecks } from '@/lib/notification-checks';
import { isSeverity } from '@/lib/notification-meta';
import { countUnreadNotifications, listNotifications, summarizeNotifications, type NotificationSeverity } from '@/lib/notifications';

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

    // The bell asks for the latest few; the notifications page adds the filters, a page offset and the counters.
    const query = request.nextUrl.searchParams;
    const kind = query.get('kind');
    const filters = {
      state: query.get('state') === 'cleared' ? ('cleared' as const) : ('active' as const),
      severity: isSeverity(query.get('severity')) ? (query.get('severity') as NotificationSeverity) : undefined,
      kind: kind && /^[a-z_-]{1,40}$/.test(kind) ? kind : undefined,
      scope: query.get('scope') === 'company' || query.get('scope') === 'system' ? (query.get('scope') as 'company' | 'system') : undefined,
    };
    const limit = Number(query.get('limit')) || 30;
    const offset = Number(query.get('offset')) || 0;

    const [items, unread, summary] = await Promise.all([
      listNotifications({ ...params, ...filters, limit, offset }),
      countUnreadNotifications(params),
      query.get('summary') === '1' ? summarizeNotifications(params) : Promise.resolve(undefined),
    ]);

    return NextResponse.json({ items, unread, hasMore: items.length === Math.min(Math.max(limit, 1), 100), summary });
  } catch (error) {
    console.error('[notifications] list error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
