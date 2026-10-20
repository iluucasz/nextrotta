import { NextRequest, NextResponse } from 'next/server';
import { addOrganizationNote, archiveOrganizationNote, isUuid, listOrganizationNotes, PlatformError } from '@/lib/platform/organizations';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** The owner's private notes about the customer. */
export async function GET(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async () => {
    const { id } = await context.params;
    if (!isUuid(id)) throw new PlatformError('Organização não encontrada.', 404);
    return NextResponse.json({ notes: await listOrganizationNotes(id) });
  });
}

/** { text } */
export async function POST(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    const body = await readJson(request);
    const note = await addOrganizationNote(id, typeof body.text === 'string' ? body.text : '', { id: owner.userId });
    return NextResponse.json({ note }, { status: 201 });
  });
}

/** ?noteId=… — archives the note (kept, just hidden). */
export async function DELETE(request: NextRequest, context: Context) {
  return withPlatformOwner(request, async (owner) => {
    const { id } = await context.params;
    await archiveOrganizationNote(id, request.nextUrl.searchParams.get('noteId') ?? '', { id: owner.userId });
    return NextResponse.json({ success: true });
  });
}
