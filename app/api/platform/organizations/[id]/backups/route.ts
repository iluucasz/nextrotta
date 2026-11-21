import { NextRequest, NextResponse } from 'next/server';
import { listBackups, nextBackupAt, retentionDaysFor } from '@/lib/backup/service';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** The company's backups (what its admin sees in Configurações → Backups), with the plan's retention and the next run. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
    const [backups, retentionDays] = await Promise.all([listBackups(id), retentionDaysFor(id)]);
    return NextResponse.json({ backups, retentionDays, nextRunAt: nextBackupAt() });
  });
}
