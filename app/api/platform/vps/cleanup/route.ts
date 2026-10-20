import { NextRequest, NextResponse } from 'next/server';
import { PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';
import { listVpsCleanups, runVpsCleanup } from '@/lib/platform/vps';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** History of cleanups (previews, manual and automatic runs). */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async () => NextResponse.json({ cleanups: await listVpsCleanups() }));
}

/** `{ dryRun: true }` lists what would go and how much it frees; `{ dryRun: false }` runs it. */
export async function POST(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const body = await readJson(request);
    if (typeof body.dryRun !== 'boolean') throw new PlatformError('Informe dryRun: true (prévia) ou false (executar).');
    return NextResponse.json(await runVpsCleanup({ dryRun: body.dryRun, trigger: 'manual', actor: { id: owner.userId } }));
  });
}
