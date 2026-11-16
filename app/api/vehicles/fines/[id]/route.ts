import { NextRequest, NextResponse } from 'next/server';
import { readJson, vehiclesRoute } from '@/lib/vehicles/api';
import { parseFineInput } from '@/lib/vehicles/fines-rules';
import { removeFine, updateFine } from '@/lib/vehicles/fines-store';
import { VehicleError } from '@/lib/vehicles/store';

export const runtime = 'nodejs';

/** Edits the fine and/or records progress (indicated, paid, aware, appeal). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    const parsed = parseFineInput(await readJson(request), true);
    if ('error' in parsed) throw new VehicleError(parsed.error);
    await updateFine(actor, id, parsed.value);
    return NextResponse.json({ ok: true });
  });
}

/** Removes the fine from the lists (soft delete). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return vehiclesRoute(request, async (actor) => {
    const { id } = await context.params;
    await removeFine(actor, id);
    return NextResponse.json({ ok: true });
  });
}
