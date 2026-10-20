import { NextRequest, NextResponse } from 'next/server';
import { adjustCredits, getOrganizationCredits } from '@/lib/platform/ai-credits';
import { isUuid, PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

async function organizationId(context: Context) {
  const { id } = await context.params;
  if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
  return id;
}

/** Balance and statement. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => NextResponse.json(await getOrganizationCredits(await organizationId(context))));
}

/** { quantity (negative debits), reason } — manual adjustment. */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) =>
    NextResponse.json(await adjustCredits(await organizationId(context), await readJson(request), { id: owner.userId })),
  );
}
