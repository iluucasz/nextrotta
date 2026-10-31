import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { sql } from '@/lib/db';
import { createNotification, listPlatformNotifications, NOTIFICATION_SEVERITIES, safeInternalHref, type NotificationSeverity } from '@/lib/notifications';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ notifications: await listPlatformNotifications() }));
}

/**
 * Publishes a notice. { title, body?, severity?, href?, organizationId? (empty = every company), expiresOn? "YYYY-MM-DD" }
 * Every company sees it; a company that signs up later does not see what was published before it existed.
 */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const input = await readJson(request);
    const title = String(input.title ?? '').trim();
    if (!title) throw new PlatformError('Escreva o título da notificação.', 400);
    if (title.length > 140) throw new PlatformError('O título pode ter até 140 caracteres.', 400);

    const body = String(input.body ?? '').trim();
    if (body.length > 1000) throw new PlatformError('O texto pode ter até 1000 caracteres.', 400);

    const severity = NOTIFICATION_SEVERITIES.includes(input.severity as NotificationSeverity) ? (input.severity as NotificationSeverity) : 'info';

    const rawHref = String(input.href ?? '').trim();
    const href = rawHref ? safeInternalHref(rawHref) : null;
    if (rawHref && !href) throw new PlatformError('O link precisa ser uma página do sistema, como /admin/assinatura.', 400);

    const organizationId = String(input.organizationId ?? '').trim() || null;
    if (organizationId) {
      if (!isUuid(organizationId)) throw new PlatformError('Empresa inválida.', 400);
      const exists = await sql`SELECT 1 FROM organizations WHERE id = ${organizationId} AND deleted_at IS NULL`;
      if (!exists[0]) throw new PlatformError('Empresa não encontrada.', 404);
    }

    const expiresOn = String(input.expiresOn ?? '').trim();
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new PlatformError('Data de validade inválida.', 400);

    const id = await createNotification({
      organizationId,
      kind: 'system',
      severity,
      title,
      body,
      href,
      createdBy: owner.userId,
      // valid through the end of that day in Brasília (UTC-3)
      expiresAt: expiresOn ? `${expiresOn}T23:59:59-03:00` : null,
    });

    await recordAudit({
      organizationId,
      actorId: owner.userId,
      actorRole: 'platform_owner',
      action: 'notification.published',
      targetType: 'notification',
      targetId: id,
      details: { title, severity, scope: organizationId ? 'organization' : 'all' },
    });

    return NextResponse.json({ id }, { status: 201 });
  });
}
