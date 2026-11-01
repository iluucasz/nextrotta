import { del, get, put } from '@vercel/blob';

// Where the copies live: the private blob storage, outside the database, under backups/<organization>/. The files are
// only ever read through the API, which checks whose they are. BLOB_READ_WRITE_TOKEN is the same one the library uses.

export function backupStorageConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export async function saveBackupFile(organizationId: string, name: string, body: Buffer): Promise<string> {
  const blob = await put(`backups/${organizationId}/${name}`, body, { access: 'private', contentType: 'application/gzip' });
  return blob.url;
}

/** The file as a Buffer, or null when the storage no longer has it. */
export async function readBackupFile(url: string): Promise<Buffer | null> {
  const file = await get(url, { access: 'private' });
  if (!file || file.statusCode !== 200 || !file.stream) return null;
  return Buffer.from(await new Response(file.stream).arrayBuffer());
}

/** A stream for downloading, or null. */
export async function openBackupFile(url: string) {
  const file = await get(url, { access: 'private' });
  if (!file || file.statusCode !== 200 || !file.stream) return null;
  return file.stream;
}

/** The one place in the system where something is erased for good: an expired backup copy. */
export async function removeBackupFile(url: string): Promise<void> {
  await del(url);
}
