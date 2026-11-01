import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { nextBackupAt, BackupError, createBackup, listBackups, retentionDaysFor } from '@/lib/backup/service';
import { backupStorageConfigured } from '@/lib/backup/storage';

export const runtime = 'nodejs';
// The first backup of a large organization takes a while.
export const maxDuration = 60;

/** The admin's backups: what exists, how long they are kept and when the next one runs. Allowed even when suspended. */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const configured = backupStorageConfigured();
    const [backups, retentionDays] = await Promise.all([listBackups(auth.organizationId), retentionDaysFor(auth.organizationId)]);
    return NextResponse.json({ configured, retentionDays, nextBackupAt: nextBackupAt(), backups });
  } catch (error) {
    console.error('[organization/backups] error:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os backups.' }, { status: 500 });
  }
}

/** "Fazer backup agora". */
export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin' || auth.preview) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const backup = await createBackup(auth.organizationId, 'manual', auth.userId);
    return NextResponse.json({ backup }, { status: 201 });
  } catch (error) {
    if (error instanceof BackupError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/backups] create error:', error);
    return NextResponse.json({ error: 'Não foi possível fazer o backup. Tente de novo.' }, { status: 500 });
  }
}
