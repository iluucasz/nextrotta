import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { openPlatformBackupDownload } from '@/lib/platform/backup';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** The encrypted file (.nrpb), to keep a copy elsewhere. Opening it takes the key and scripts/restore-platform-backup.cjs. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const { record, stream } = await openPlatformBackupDownload(id);
    await recordAudit({
      organizationId: null,
      actorId: owner.userId,
      actorRole: 'platform_owner',
      action: 'platform_backup.downloaded',
      targetType: 'platform_backup',
      targetId: record.id,
      details: null,
    });
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="nextrotta-plataforma-${record.backupDate}-${record.id.slice(0, 8)}.nrpb"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
