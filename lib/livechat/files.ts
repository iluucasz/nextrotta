import { randomUUID } from 'node:crypto';
import { get, put } from '@vercel/blob';
import { ATTACHMENT_TYPES, INLINE_ATTACHMENT_TYPES, safeFileName } from './rules';

/** A file of a chat as kept in the private store. */
export type SavedFile = { fileName: string; contentType: string; size: number; url: string };

/**
 * Keeps a chat file in the private store, in the folder of the company the chat belongs to (or "platform" for someone the
 * platform does not know). Nothing about it is public: it is only ever read back through chatFileResponse.
 */
export async function saveChatFile(input: { organizationId: string | null; conversationId: string; fileName: string | null; contentType: string; buffer: Buffer }): Promise<SavedFile> {
  const fileName = safeFileName(input.fileName, input.contentType);
  const stored = fileName.replace(/[^\w.-]+/g, '_').slice(-80);
  const blob = await put(`chat/${input.organizationId ?? 'platform'}/${input.conversationId}/${randomUUID()}-${stored}`, input.buffer, {
    access: 'private',
    contentType: input.contentType,
  });
  return { fileName, contentType: input.contentType, size: input.buffer.length, url: blob.url };
}

/** Streams a stored chat file to whoever was already checked: the type comes from our record, never from the file itself. */
export async function chatFileResponse(attachment: { url: string; fileName: string; contentType: string }, download: boolean): Promise<Response> {
  const file = await get(attachment.url, { access: 'private' });
  if (!file || file.statusCode !== 200 || !file.stream) return Response.json({ error: 'Arquivo não encontrado.' }, { status: 404 });
  const type = attachment.contentType in ATTACHMENT_TYPES ? attachment.contentType : 'application/octet-stream';
  const inline = !download && INLINE_ATTACHMENT_TYPES.has(type);
  return new Response(file.stream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(file.blob.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
