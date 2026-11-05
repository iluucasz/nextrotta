import { NextRequest, NextResponse } from 'next/server';
import { cleanupExpiredBackups, runDailyBackups } from '@/lib/backup/service';
import { backupStorageConfigured } from '@/lib/backup/storage';
import { isCronAuthorized } from '@/lib/cron-secret';
import { trackRun } from '@/lib/worker-health';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The nightly backups, scheduled by Vercel Cron (vercel.json: 00:00 Brasília and again at 02:00 to catch up anything
 * that failed). The app already has the storage token, so this does not depend on the VPS worker. A company never gets
 * two daily backups on the same day (unique index), so running twice is safe. Then the copies past their plan's retention
 * are removed (the only hard deletion in the system, only backup files).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }
  if (!backupStorageConfigured()) {
    return NextResponse.json({ error: 'O armazenamento dos backups não está configurado (BLOB_READ_WRITE_TOKEN).' }, { status: 503 });
  }

  try {
    const result = await trackRun('backups', null, runDailyBackups);
    const removed = await trackRun('backup_cleanup', null, cleanupExpiredBackups);
    return NextResponse.json({ ...result, removed });
  } catch (error) {
    console.error('[cron/backups] error:', error);
    return NextResponse.json({ error: 'A rotina de backups falhou.' }, { status: 500 });
  }
}
