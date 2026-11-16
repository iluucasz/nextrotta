// Deletes the Blob files (backups, livechat attachments) that belong to the zz-* test organizations.
// Usage: node scripts/purge-test-blobs.mjs [--apply]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(`${root}/package.json`);
const { del } = require('@vercel/blob');
const { openPool, loadEnv } = await import('./lib/db.mjs');
loadEnv();
const apply = process.argv.includes('--apply');
const { pool } = openPool();

const urls = [
  ...(await pool.query(`SELECT b.storage_url AS url FROM organization_backups b JOIN organizations o ON o.id = b.organization_id WHERE o.slug LIKE 'zz-%' AND b.storage_url IS NOT NULL`)).rows,
  ...(await pool.query(`SELECT a.url AS url FROM livechat_attachments a JOIN organizations o ON o.id = a.organization_id WHERE o.slug LIKE 'zz-%' AND a.url IS NOT NULL`)).rows,
].map((row) => row.url);

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error('BLOB_READ_WRITE_TOKEN missing');
const storeId = token.split('_')[3]?.toLowerCase();
const hosts = new Set(urls.filter((u) => /^https?:/.test(u)).map((u) => new URL(u).host.split('.')[0].toLowerCase()));
const other = urls.filter((u) => !/^https?:/.test(u));
console.log('files:', urls.length, '| stores in the URLs:', [...hosts].join(',') || '-', '| token store matches:', hosts.size === 1 && hosts.has(storeId), '| non-URL values:', other.length, other.slice(0, 2));
if (!urls.length) {
  await pool.end();
  process.exit(0);
}
if (hosts.size !== 1 || !hosts.has(storeId)) throw new Error('URLs are not all in the store of this token: stopping');

if (apply) {
  const full = urls.filter((u) => /^https?:/.test(u));
  for (let i = 0; i < full.length; i += 50) await del(full.slice(i, i + 50), { token });
  console.log('deleted', full.length);
} else {
  console.log('dry run: nothing deleted');
}
await pool.end();
