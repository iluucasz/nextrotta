import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { BackupError, getBackup } from '@/lib/backup/service';
import { restoreBackup } from '@/lib/backup/restore';
import { openBackupFile } from '@/lib/backup/storage';
import { forgetOrganizationSettings } from '@/lib/organization-settings-store';
import { notifyWorkerRefresh } from '@/lib/porto-worker-client';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Downloads the backup file (gzip of a JSON): whatever the company wants to keep or inspect. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const { id } = await params;
    const backup = await getBackup(auth.organizationId, id);
    if (!backup || backup.status !== 'completed' || !backup.storageUrl) return NextResponse.json({ error: 'Backup não encontrado.' }, { status: 404 });

    const stream = await openBackupFile(backup.storageUrl);
    if (!stream) return NextResponse.json({ error: 'O arquivo deste backup não foi encontrado.' }, { status: 404 });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="nextrotta-${auth.organizationSlug}-backup-${backup.createdAt.slice(0, 16).replace(/[:T]/g, '-')}.json.gz"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[organization/backups] download error:', error);
    return NextResponse.json({ error: 'Não foi possível baixar o backup.' }, { status: 500 });
  }
}

/** { confirm: "RESTAURAR" } — puts the organization back as it was in this backup. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin' || auth.preview) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== 'RESTAURAR') return NextResponse.json({ error: 'Digite RESTAURAR para confirmar.' }, { status: 400 });

    const { id } = await params;
    const result = await restoreBackup(auth.organizationId, id, {
      id: auth.userId,
      role: auth.impersonationId ? 'platform_owner' : 'admin',
      impersonationId: auth.impersonationId ?? null,
    });

    // The restored settings must be read again, here and by the worker.
    forgetOrganizationSettings(auth.organizationId);
    await notifyWorkerRefresh().catch(() => undefined);
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof BackupError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/backups] restore error:', error);
    return NextResponse.json({ error: 'Não foi possível restaurar o backup. Nada foi alterado.' }, { status: 500 });
  }
}
