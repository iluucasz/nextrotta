import { NextRequest, NextResponse } from 'next/server';
import { createManualPlatformBackup, getPlatformBackups } from '@/lib/platform/backup';
import { withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';
// A copy of the whole database is read, compressed and locked before it is stored.
export const maxDuration = 300;

/** The copies of the whole platform (newest first), the retention, and why a new one can't be made here (blocker). */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json(await getPlatformBackups()));
}

/** "Fazer backup agora": one copy of every table, at most one every 2 minutes. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => NextResponse.json({ backup: await createManualPlatformBackup(owner.userId) }, { status: 201 }));
}
