import { list } from '@vercel/blob';
import { getVercelAccount } from './vercel-plan';

/**
 * Real usage of the Vercel Blob store (every file, of every organization), for Operação → Capacidade.
 * With VERCEL_API_TOKEN the size comes from the Vercel API (free); otherwise the store is listed,
 * a billed "advanced operation", so the result is kept for a while.
 */

const CACHE_MS = 15 * 60 * 1000;

export type BlobUsage =
  | { configured: false }
  | { configured: true; ok: true; bytes: number; files: number; measuredAt: string }
  | { configured: true; ok: false; error: string };

let cache: { at: number; value: BlobUsage } | null = null;

export async function getBlobUsage(): Promise<BlobUsage> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { configured: false };
  const account = await getVercelAccount();
  if (account.configured && account.ok && account.store) {
    return { configured: true, ok: true, bytes: account.store.sizeBytes, files: account.store.count ?? 0, measuredAt: new Date().toISOString() };
  }
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  let value: BlobUsage;
  try {
    let bytes = 0;
    let files = 0;
    let cursor: string | undefined;
    do {
      const page = await list({ cursor, limit: 1000 });
      for (const blob of page.blobs) {
        bytes += blob.size;
        files += 1;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    value = { configured: true, ok: true, bytes, files, measuredAt: new Date().toISOString() };
  } catch (error) {
    console.error('[capacity] Blob usage error:', error);
    value = { configured: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  cache = { at: Date.now(), value };
  return value;
}
