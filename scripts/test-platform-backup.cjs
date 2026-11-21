// Run with: node scripts/test-platform-backup.cjs
// The backup of the whole platform: the locked file, what it keeps, how long, and that it can be put back. The pure parts run
// without a database. The rest reads the development database (read-only) and restores the copy into a scratch schema
// (zz_restore_test, dropped at the end), so no real table is ever written.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const ts = require('typescript');

for (const name of ['.env.local', '.env']) {
  const file = path.join(__dirname, '..', name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
const format = require('../lib/platform/backup-format.ts');
const { planRestore, restorePlatformBackup } = require('../lib/platform/backup-restore.ts');

const KEY = crypto.randomBytes(32);
const sample = (rows = { a: ['{"id":1}', '{"id":2}'], b: [] }) => {
  const tables = Object.keys(rows);
  const lines = [JSON.stringify({ format: format.PLATFORM_BACKUP_FORMAT, version: 1, createdAt: '2026-11-21T00:00:00.000Z', tables })];
  for (const table of tables) for (const row of rows[table]) lines.push(`{"t":${JSON.stringify(table)},"r":${row}}`);
  lines.push(JSON.stringify({ end: true, counts: Object.fromEntries(tables.map((t) => [t, rows[t].length])) }));
  return lines.join('\n') + '\n';
};

test('the file is locked: the right key opens it, another key or an edit does not', () => {
  const plain = gzipSync(Buffer.from(sample()));
  const locked = format.encryptBackup(plain, KEY);
  assert.ok(!locked.includes(Buffer.from('"id":1')), 'content must not be readable without the key');
  assert.deepEqual(format.decryptBackup(locked, KEY), plain);
  assert.throws(() => format.decryptBackup(locked, crypto.randomBytes(32)), /chave não confere/);
  const edited = Buffer.from(locked);
  edited[edited.length - 1] ^= 1;
  assert.throws(() => format.decryptBackup(edited, KEY), /chave não confere|alterado/);
  assert.throws(() => format.decryptBackup(Buffer.from('not a backup at all, really not'), KEY), /não é um backup/);
});

test('the key comes from PLATFORM_BACKUP_KEY, else is derived from the Porto key, else is missing', () => {
  const own = crypto.randomBytes(32).toString('base64');
  const porto = crypto.randomBytes(32).toString('base64');
  assert.ok(format.platformBackupKey({ PLATFORM_BACKUP_KEY: own, PORTO_CREDENTIALS_KEY: porto }).equals(Buffer.from(own, 'base64')));
  const derived = format.platformBackupKey({ PORTO_CREDENTIALS_KEY: porto });
  assert.equal(derived.length, 32);
  assert.ok(!derived.equals(Buffer.from(porto, 'base64')), 'the Porto key itself must never be the backup key');
  assert.ok(derived.equals(format.platformBackupKey({ PORTO_CREDENTIALS_KEY: porto })), 'stable: the same input gives the same key');
  assert.equal(format.platformBackupKey({}), null);
  assert.throws(() => format.platformBackupKey({ PLATFORM_BACKUP_KEY: 'curta' }), /32 bytes/);
});

test('a cut or altered file is refused when parsed', () => {
  const whole = sample();
  assert.deepEqual(format.parsePlatformBackup(whole).counts, { a: 2, b: 0 });
  const lines = whole.trim().split('\n');
  const withoutRow = [lines[0], lines[1], lines[3]].join('\n');
  assert.throws(() => format.parsePlatformBackup(withoutRow), /incompleto.*"a" tem 1/);
  assert.throws(() => format.parsePlatformBackup(lines.slice(0, -1).join('\n')), /corrompida|incompleto|fim do arquivo/);
  assert.throws(() => format.parsePlatformBackup(whole.replace('nextrotta-platform-backup', 'outra-coisa')), /não é um backup/);
});

test('copies past 30 days go, the newest one never does', () => {
  const day = 24 * 60 * 60 * 1000;
  const now = new Date('2026-11-21T00:00:00Z');
  const copy = (id, ago) => ({ id, createdAt: new Date(now.getTime() - ago * day) });
  assert.deepEqual(format.expiredPlatformCopyIds([copy('new', 1), copy('mid', 29), copy('old', 31), copy('older', 90)], 30, now).sort(), ['old', 'older']);
  assert.deepEqual(format.expiredPlatformCopyIds([copy('only', 400)], 30, now), [], 'the last copy is kept whatever its age');
  assert.deepEqual(format.expiredPlatformCopyIds([copy('a', 1), copy('b', 400)], null, now), [], 'no retention keeps everything');
  assert.equal(format.PLATFORM_BACKUP_RETENTION_DAYS, 30);
});

test('monitoring samples are the only tables left out', () => {
  assert.deepEqual([...format.PLATFORM_BACKUP_EXCLUDED_TABLES].sort(), ['vps_container_metrics', 'vps_metrics']);
});

test('restore order: parents first, and a circle is broken at an optional column', () => {
  const fk = (table, references, columns, nullable) => ({ table, references, columns, nullable });
  const simple = planRestore(['child', 'parent'], [fk('child', 'parent', ['parent_id'], false)]);
  assert.deepEqual(simple.order, ['parent', 'child']);
  assert.equal(simple.deferred.size, 0);

  const circle = planRestore(
    ['users', 'organizations', 'storage_containers'],
    [fk('users', 'organizations', ['organization_id'], true), fk('organizations', 'storage_containers', ['container_id'], true), fk('storage_containers', 'users', ['created_by'], true)],
  );
  assert.equal(circle.order.length, 3);
  assert.equal([...circle.deferred.values()].reduce((n, set) => n + set.size, 0), 1, 'one column is enough to break the circle');
  // a table that only waits for a parent is never the one left empty: only the column that closes a circle is
  const mixed = planRestore(
    ['notifications', 'users', 'organizations'],
    [fk('notifications', 'organizations', ['organization_id'], true), fk('users', 'organizations', ['organization_id'], true), fk('organizations', 'users', ['created_by'], true)],
  );
  assert.equal(mixed.deferred.has('notifications'), false, 'the notifications column is not part of the circle');
  assert.equal(mixed.deferred.size, 1);
  assert.ok(mixed.order.indexOf('organizations') < mixed.order.indexOf('notifications') || mixed.order.indexOf('notifications') === mixed.order.length - 1);
  // a self reference is fine: it is checked at the end of the statement
  assert.deepEqual(planRestore(['p'], [fk('p', 'p', ['parent_id'], false)]).order, ['p']);
  // a circle of required columns can't be restored: it says so
  assert.throws(() => planRestore(['a', 'b'], [fk('a', 'b', ['b_id'], false), fk('b', 'a', ['a_id'], false)]), /dependem umas das outras/);
});

const run = process.env.DATABASE_URL ? test : test.skip;

run('a copy of the real database restores, row for row, into an empty schema', { timeout: 240000 }, async () => {
  const { Pool, neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const { buildPlatformBackup } = require('../lib/platform/backup.ts');

  process.env.PORTO_CREDENTIALS_KEY ||= crypto.randomBytes(32).toString('base64');
  const { file, tableCounts } = await buildPlatformBackup();
  const parsed = format.openPlatformBackup(file, format.platformBackupKey());
  assert.deepEqual(parsed.counts, tableCounts);
  assert.ok(tableCounts.organizations > 0 && tableCounts.users > 0, 'the platform tables are in');
  assert.equal('vps_metrics' in tableCounts, false);
  assert.ok(Object.keys(tableCounts).length > 60);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const SCHEMA = 'zz_restore_test';
  try {
    // Nothing is deleted here except the scratch schema this test creates.
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    const tables = parsed.header.tables;
    for (const table of tables) {
      await client.query(`CREATE TABLE ${SCHEMA}."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // The foreign keys of the real schema, pointed at the scratch tables (search_path resolves the names there first).
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const fks = await client.query(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`);
    let added = 0;
    for (const fk of fks.rows) {
      const table = String(fk.t).replace(/^public\./, '').replace(/"/g, '');
      if (!tables.includes(table)) continue;
      await client.query(`ALTER TABLE ${SCHEMA}."${table}" ADD CONSTRAINT "${fk.conname}" ${fk.def.replace(/public\./g, '')}`);
      added += 1;
    }
    await client.query('SET search_path TO public');
    assert.ok(added > 100, `the scratch schema has the real foreign keys (${added})`);

    await client.query('BEGIN');
    let result;
    try {
      result = await restorePlatformBackup(client, SCHEMA, parsed);
    } catch (error) {
      throw new Error(`${error.message} :: ${error.detail ?? ''} :: ${error.table ?? ''}`);
    }
    await client.query('COMMIT');
    assert.deepEqual(result.skippedTables, []);

    let checked = 0;
    for (const table of tables) {
      if (!tableCounts[table]) continue;
      const back = (
        await client.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(('x' || substr(md5(to_jsonb(t)::text), 1, 15))::bit(60)::bigint), 0)::text AS h FROM ${SCHEMA}."${table}" t`)
      ).rows[0];
      assert.equal(back.n, tableCounts[table], `${table}: row count`);
      // The same hash of every row as the backup holds it: nothing was altered on the way back (order doesn't matter).
      let expected = 0n;
      for (const line of parsed.rows.get(table)) expected += BigInt('0x' + crypto.createHash('md5').update(line).digest('hex').slice(0, 15));
      assert.equal(BigInt(back.h), expected, `${table}: rows identical to the backup`);
      checked += 1;
    }
    assert.ok(checked > 30);

    // The real data keeps growing (the worker writes all day), but nothing the backup holds may be missing from it.
    for (const table of ['organizations', 'users', 'plans', 'features']) {
      const now = (await client.query(`SELECT COUNT(*)::int AS n FROM public."${table}"`)).rows[0].n;
      assert.ok(now >= tableCounts[table], `${table}: the database never has fewer rows than the copy`);
    }

    // A second restore over data already there is refused, and changes nothing.
    await client.query('BEGIN');
    await assert.rejects(restorePlatformBackup(client, SCHEMA, parsed), /já tem dados/);
    await client.query('ROLLBACK');
  } finally {
    await client.query('SET search_path TO public').catch(() => undefined);
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    client.release();
    await pool.end();
  }
});
