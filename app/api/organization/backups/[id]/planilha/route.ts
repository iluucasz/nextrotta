import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { verifyOrganizationAuth } from '@/lib/auth';
import { BackupError, buildBackupFile, getBackup, getLastBackup, loadBackupFile } from '@/lib/backup/service';
import { buildBackupWorkbook, workbookFileName } from '@/lib/backup/workbook';

export const runtime = 'nodejs';
export const maxDuration = 120;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A backup as a spreadsheet (one tab per subject). `id` is a backup, "ultimo" (the newest copy, what a locked company
 * downloads) or "atual" (the company as it is right now, read from the database, for when there is no copy yet).
 * Allowed for the admin even when the access is locked.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

    const { id } = await params;
    let file;
    let info: { kind: 'daily' | 'manual' | 'before_restore' | 'closing' | 'current'; createdAt: string };
    let source: string;

    if (id === 'atual') {
      file = (await buildBackupFile(auth.organizationId)).file;
      info = { kind: 'current', createdAt: file.createdAt };
      source = 'current';
    } else {
      const wanted = id === 'ultimo' ? (await getLastBackup(auth.organizationId))?.id : id;
      const backup = wanted ? await getBackup(auth.organizationId, wanted) : null;
      if (!backup || backup.status !== 'completed') return NextResponse.json({ error: 'Backup não encontrado.' }, { status: 404 });
      if (!backup.storageUrl) return NextResponse.json({ error: 'O arquivo deste backup não está mais disponível.' }, { status: 404 });
      file = await loadBackupFile(backup.storageUrl);
      if (file.organization.id !== auth.organizationId) return NextResponse.json({ error: 'Este backup é de outra empresa.' }, { status: 403 });
      info = { kind: backup.kind, createdAt: backup.createdAt };
      source = backup.id;
    }

    const buffer = await buildBackupWorkbook(file, info);
    await recordAudit({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      actorRole: auth.impersonationId ? 'platform_owner' : 'admin',
      impersonationId: auth.impersonationId ?? null,
      action: 'backup.spreadsheet_downloaded',
      targetType: 'organization_backup',
      targetId: source === 'current' ? null : source,
      details: { source: source === 'current' ? 'current' : 'backup', bytes: buffer.length },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="${workbookFileName(file, info.createdAt)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof BackupError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/backups] spreadsheet error:', error);
    return NextResponse.json({ error: 'Não foi possível gerar a planilha.' }, { status: 500 });
  }
}
