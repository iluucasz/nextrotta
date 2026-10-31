import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { countUnreadNotifications, ensureScheduleReminder, listNotifications } from '@/lib/notifications';

export const runtime = 'nodejs';

/**
 * The notifications of the person's own company plus the general ones from the platform.
 * `?check=1` (sent when the page opens) also looks for things worth telling, like the escala running out.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const isAdmin = auth.role === 'admin';
    const params = { organizationId: auth.organizationId, userId: auth.userId, isAdmin };

    if (isAdmin && request.nextUrl.searchParams.get('check') === '1') {
      await ensureScheduleReminder(auth.organizationId).catch((error) => console.error('[notifications] schedule reminder failed:', error));
    }

    const limit = Number(request.nextUrl.searchParams.get('limit')) || 30;
    const [items, unread] = await Promise.all([listNotifications({ ...params, limit }), countUnreadNotifications(params)]);

    return NextResponse.json({ items, unread });
  } catch (error) {
    console.error('[notifications] list error:', error);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
