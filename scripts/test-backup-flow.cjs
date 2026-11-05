// Run with: node scripts/test-backup-flow.cjs
// Needs the development database and the private storage of the backups (.env). The whole path of a company's data, end to
// end, on a test company of its own ("zz-teste-backups", left archived): a backup is made and stored, read back as a
// spreadsheet, restored to an older date after more was done, and the restore is undone; the copy made before a lock is
// kept; a suspended company is locked at once; another company never sees any of it. Nothing of a real company is touched.
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const ExcelJS = require('exceljs');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);
const { sql } = require('../lib/db.ts');
const service = require('../lib/backup/service.ts');
const { restoreBackup } = require('../lib/backup/restore.ts');
const { previewRestore } = require('../lib/backup/preview.ts');
const { buildBackupWorkbook } = require('../lib/backup/workbook.ts');
const { removeBackupFile, backupStorageConfigured } = require('../lib/backup/storage.ts');
const { computeAccess } = require('../lib/organization-access.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-backups';
let org;
let other;
let actor;
const backups = [];

const activeServices = async (id = org) => (await sql`SELECT order_code FROM services WHERE organization_id = ${id} AND deleted_at IS NULL ORDER BY order_code`).map((row) => row.order_code);

test('setup: a test company with a technician and two services, and another one', async () => {
  assert.ok(backupStorageConfigured(), 'the storage of the backups must be configured to run this test');
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste backups', 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = ${org}`;
  other = (await sql`SELECT id FROM organizations WHERE slug = 'kappa'`)[0].id;
  actor = (await sql`SELECT id FROM users WHERE organization_id = ${other} AND role = 'admin' LIMIT 1`)[0].id;

  // A run right after another: the rule of one manual copy every 2 minutes and of one closing copy per 6 hours look at recent rows.
  await sql`UPDATE organization_backups SET status = 'expired', expired_at = NOW() WHERE organization_id = ${org} AND status IN ('running', 'completed')`;
  await sql`UPDATE organization_backups SET created_at = created_at - interval '1 day' WHERE organization_id = ${org}`;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE technicians SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  const technician = (await sql`INSERT INTO technicians (organization_id, name, email) VALUES (${org}, 'Técnica Teste', ${`teste-${Date.now()}@exemplo.com`}) RETURNING id`)[0].id;
  for (const code of ['A-1', 'A-2']) {
    await sql`INSERT INTO services (organization_id, technician_id, order_code, service_type, value, date_performed, time_performed, competence_month) VALUES (${org}, ${technician}, ${code}, 'Serviço de teste', 100, '2026-10-20', '10:00', '2026-10')`;
  }
  assert.deepEqual(await activeServices(), ['A-1', 'A-2']);
});

test('a backup is stored and read back; its spreadsheet has the data in words', async () => {
  const backup = await service.createBackup(org, 'manual', actor);
  backups.push(backup.id);
  assert.equal(backup.status, 'completed');
  assert.ok(backup.rowCounts.services >= 2, 'archived rows of earlier runs are in the copy too');

  const stored = await service.getBackup(org, backup.id);
  const file = await service.loadBackupFile(stored.storageUrl);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildBackupWorkbook(file, { kind: backup.kind, createdAt: backup.createdAt }));
  const sheet = workbook.getWorksheet('Serviços (OS)');
  const names = [];
  sheet.eachRow((row, number) => number > 1 && names.push([row.getCell(3).value, row.getCell(4).value]));
  assert.ok(names.some(([code, who]) => code === 'A-1' && who === 'Técnica Teste'), 'the technician by name');
  assert.equal(workbook.getWorksheet('Resumo').getRow(5).getCell(2).value, 'Manual');
});

test('restoring to an older date: the preview counts it, the restore archives what came after, the undo brings it back', async () => {
  const [first] = backups;
  const technician = (await sql`SELECT id FROM technicians WHERE organization_id = ${org} AND deleted_at IS NULL LIMIT 1`)[0].id;
  // more is done after the backup
  await sql`INSERT INTO services (organization_id, technician_id, order_code, service_type, value, date_performed, time_performed, competence_month) VALUES (${org}, ${technician}, 'B-1', 'Depois do backup', 50, '2026-10-25', '09:00', '2026-10')`;
  assert.deepEqual(await activeServices(), ['A-1', 'A-2', 'B-1']);

  const preview = await previewRestore(org, first);
  const services = preview.tables.find((table) => table.table === 'services');
  assert.deepEqual([services.inBackup, services.willArchive], [2, 1], 'two come back, the one made later would be archived');
  assert.deepEqual(await activeServices(), ['A-1', 'A-2', 'B-1'], 'the preview changes nothing');

  assert.equal(await service.getLastRestore(org), null, 'nothing to undo before a restore');
  const result = await restoreBackup(org, first, { id: actor, role: 'admin' });
  assert.ok(result.safetyBackupId, 'the present was saved before restoring');
  backups.push(result.safetyBackupId);
  assert.deepEqual(await activeServices(), ['A-1', 'A-2'], 'back to the date of the backup');

  const last = await service.getLastRestore(org);
  assert.equal(last.safetyBackupId, result.safetyBackupId, 'the banner has what to undo');

  // undo = restore the copy of "before": B-1 is back
  const undo = await restoreBackup(org, last.safetyBackupId, { id: actor, role: 'admin' });
  backups.push(undo.safetyBackupId);
  assert.deepEqual(await activeServices(), ['A-1', 'A-2', 'B-1'], 'as it was before the restore');
  const after = await service.getLastRestore(org);
  assert.notEqual(after?.safetyBackupId, result.safetyBackupId, 'the first restore is no longer the one to undo');
  assert.equal(after.safetyBackupId, undo.safetyBackupId, 'and the undo itself can be undone');
});

test('nothing leaks: another company has none of these and its own data stays as it was', async () => {
  const mine = await sql`SELECT COUNT(*)::int AS total FROM services WHERE organization_id = ${other} AND order_code IN ('A-1', 'A-2', 'B-1')`;
  assert.equal(mine[0].total, 0);
  for (const id of backups) {
    assert.equal(await service.getBackup(other, id), null, 'a backup of this company is invisible to the other');
    await assert.rejects(restoreBackup(other, id, { id: actor, role: 'admin' }), /não encontrado/i);
  }
});

test('the copy made before a lock: kept, named for what it is, and never twice within 6 hours', async () => {
  const first = await service.createClosingBackup(org);
  assert.equal(first.kind, 'closing');
  backups.push(first.id);
  assert.equal(await service.createClosingBackup(org), null, 'not repeated');
  const last = await service.getLastBackup(org);
  assert.equal(last.id, first.id, 'it is the copy a locked company downloads');
  const copy = await service.getBackup(org, first.id);
  assert.equal((await service.loadBackupFile(copy.storageUrl)).tables.services.filter((row) => !row.deleted_at).length, 3, 'with the data as of the lock');
});

test('a suspended or canceled company is locked at once, a past due one is not', () => {
  const now = new Date();
  assert.equal(computeAccess('active', now, 0).level, 'full');
  assert.equal(computeAccess('past_due', now, 0).level, 'full', 'the grace period is full use');
  assert.equal(computeAccess('suspended', now, 0).level, 'export_only');
  assert.equal(computeAccess('canceled', new Date(now.getTime() - 60_000), 0).level, 'export_only');
  assert.equal(computeAccess('suspended', now, undefined).level, 'export_only', 'the default is no period of consultation');
  assert.equal(computeAccess('suspended', now, 7).level, 'read_only', 'the owner can still grant a period');
  // The database clock a few seconds ahead of the server must not open a window.
  assert.equal(computeAccess('suspended', new Date(now.getTime() + 8_000), 0).level, 'export_only');
});

after(async () => {
  // The only deletion allowed: the files of the test copies. The rows stay, expired.
  for (const id of backups) {
    const copy = await service.getBackup(org, id).catch(() => null);
    if (copy?.storageUrl) await removeBackupFile(copy.storageUrl).catch(() => undefined);
    await sql`UPDATE organization_backups SET status = 'expired', expired_at = NOW(), storage_url = NULL WHERE id = ${id}`;
  }
  const leftovers = await sql`SELECT id, storage_url FROM organization_backups WHERE organization_id = ${org} AND status = 'completed'`;
  for (const copy of leftovers) {
    if (copy.storage_url) await removeBackupFile(copy.storage_url).catch(() => undefined);
    await sql`UPDATE organization_backups SET status = 'expired', expired_at = NOW(), storage_url = NULL WHERE id = ${copy.id}`;
  }
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE technicians SET deleted_at = NOW(), status = 'inactive' WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
