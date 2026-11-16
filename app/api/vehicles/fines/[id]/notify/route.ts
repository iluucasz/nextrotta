import { NextRequest, NextResponse } from 'next/server';
import { vehiclesRoute } from '@/lib/vehicles/api';
import { notifyDriver } from '@/lib/vehicles/fines-store';

export const runtime = 'nodejs';

/** Tells the driver about the fine (shows in his "Minhas multas" and goes by WhatsApp when that is on). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    return NextResponse.json(await notifyDriver(actor, id));
  });
}
