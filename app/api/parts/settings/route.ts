import { NextRequest, NextResponse } from 'next/server';
import { getPartsSettings, savePartsSettings } from '@/lib/parts/catalog';
import { partsContext, partsError, readJson } from '@/lib/parts/route-helpers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const context = await partsContext(request, 'any');
  if (context instanceof NextResponse) return context;
  try {
    return NextResponse.json({ settings: await getPartsSettings(context.organizationId) });
  } catch (error) {
    return partsError(error, 'get settings');
  }
}

export async function PUT(request: NextRequest) {
  const context = await partsContext(request, 'admin');
  if (context instanceof NextResponse) return context;
  try {
    return NextResponse.json({ settings: await savePartsSettings(context.organizationId, await readJson(request), context.actor) });
  } catch (error) {
    return partsError(error, 'save settings');
  }
}
