import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { previewRestore } from '@/lib/backup/preview';
import { BackupError } from '@/lib/backup/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** What restoring this backup would change, counted (nothing is changed). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    const { id } = await params;
    return NextResponse.json({ preview: await previewRestore(auth.organizationId, id) });
  } catch (error) {
    if (error instanceof BackupError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[organization/backups] preview error:', error);
    return NextResponse.json({ error: 'Não foi possível calcular o que muda.' }, { status: 500 });
  }
}
