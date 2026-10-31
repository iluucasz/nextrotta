import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { archiveNotification } from '@/lib/notifications';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** Retracts a notice: it leaves every company's list (the record stays). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Notificação não encontrada.', 404);

    const archived = await archiveNotification(id);
    if (!archived) throw new PlatformError('Notificação não encontrada ou já retirada.', 404);

    await recordAudit({
      organizationId: archived.organizationId,
      actorId: owner.userId,
      actorRole: 'platform_owner',
      action: 'notification.archived',
      targetType: 'notification',
      targetId: id,
    });

    return NextResponse.json({ ok: true });
  });
}
