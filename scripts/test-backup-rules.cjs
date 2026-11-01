// Run with: node scripts/test-backup-rules.cjs
// The pure rules of the backups: the Brasília day and the next 00:00, which copies expire (the latest never does) and
// the statements of a restore (nothing is deleted, each statement carries exactly the parameters it uses, a backup of
// another company is refused).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const dates = require('../lib/backup/dates.ts');
const rules = require('../lib/backup/rules.ts');
const tables = require('../lib/backup/tables.ts');

const ORG = '11111111-1111-1111-1111-111111111111';
const ACTOR = '22222222-2222-2222-2222-222222222222';

test('the backup day is the Brasília day, whatever the server clock says', () => {
  assert.equal(dates.brasiliaDay(new Date('2026-11-01T02:59:59Z')), '2026-10-31');
  assert.equal(dates.brasiliaDay(new Date('2026-11-01T03:00:00Z')), '2026-11-01');
  assert.equal(dates.brasiliaDay(new Date('2026-12-31T23:30:00-03:00')), '2026-12-31');
});

test('the next backup is the next 00:00 in Brasília', () => {
  assert.equal(dates.nextBackupTime(new Date('2026-11-01T15:00:00Z')).toISOString(), '2026-11-02T03:00:00.000Z');
  assert.equal(dates.nextBackupTime(new Date('2026-11-01T02:00:00Z')).toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(dates.nextBackupTime(new Date('2026-12-31T20:00:00Z')).toISOString(), '2027-01-01T03:00:00.000Z');
  assert.equal(dates.backupTimeOf('2026-11-01').toISOString(), '2026-11-01T03:00:00.000Z');
});

const copy = (id, daysAgo, status = 'completed') => ({ id, status, createdAt: new Date(Date.parse('2026-11-01T03:00:00Z') - daysAgo * 86400000) });
const now = new Date('2026-11-01T03:00:00Z');

test('retention: copies older than the plan days go, the latest never does', () => {
  const list = [copy('hoje', 0), copy('ontem', 1), copy('mes', 30), copy('velho', 100), copy('antigo', 400)];
  assert.deepEqual(rules.expiredCopyIds(list, 90, now).sort(), ['antigo', 'velho']);
  assert.deepEqual(rules.expiredCopyIds(list, 180, now), ['antigo']);
  assert.deepEqual(rules.expiredCopyIds(list, null, now), []);
});

test('retention: the most recent copy stays even when it is older than the retention', () => {
  assert.deepEqual(rules.expiredCopyIds([copy('so', 500)], 90, now), []);
  assert.deepEqual(rules.expiredCopyIds([copy('a', 400), copy('b', 500)], 90, now), ['b']);
});

test('retention: failed, running and already expired copies are not touched', () => {
  const list = [copy('ok', 1), copy('falhou', 300, 'failed'), copy('rodando', 300, 'running'), copy('vencido', 300, 'expired'), copy('velho', 300)];
  assert.deepEqual(rules.expiredCopyIds(list, 90, now), ['velho']);
});

const columns = {
  technicians: ['id', 'organization_id', 'name', 'base_salary', 'deleted_at', 'deleted_by', 'updated_at'],
  services: ['id', 'organization_id', 'value', 'deleted_at', 'deleted_by'],
  work_hours: ['id', 'organization_id', 'hours_worked', 'deleted_at', 'deleted_by'],
  finance_budgets: ['organization_id', 'category', 'amount', 'updated_at'],
  organization_settings: ['organization_id', 'commission_mode', 'commission_rate'],
  technician_visibility_settings: ['organization_id', 'scope', 'deleted_at'],
};
const rows = (table, list) => list.map((row) => ({ organization_id: ORG, ...row }));
const backup = {
  technicians: rows('technicians', [{ id: 't1', name: 'Ana', base_salary: 1000, deleted_at: null }]),
  services: rows('services', [{ id: 's1', value: 50, deleted_at: null }, { id: 's2', value: 70, deleted_at: '2026-10-01T00:00:00Z' }]),
  finance_budgets: rows('finance_budgets', [{ category: 'Aluguel', amount: 900 }]),
  organization_settings: rows('organization_settings', [{ commission_mode: 'per_service', commission_rate: 30 }]),
};
const build = (extra = {}) => rules.buildRestoreStatements({ organizationId: ORG, actorId: ACTOR, tables: backup, columns, ...extra });

test('restore: nothing is ever deleted', () => {
  for (const statement of build()) assert.doesNotMatch(statement.text, /\bDELETE\b|\bTRUNCATE\b|\bDROP\b/i);
});

test('restore: each statement carries exactly the parameters it uses', () => {
  for (const statement of build()) {
    const used = [...statement.text.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
    assert.equal(Math.max(...used), statement.params.length, `${statement.table}/${statement.step}`);
    assert.deepEqual([...new Set(used)].sort(), Array.from({ length: statement.params.length }, (_, index) => index + 1), `${statement.table}/${statement.step}`);
  }
});

test('restore: what the backup does not have is archived, what it has is written back (with its own deleted_at)', () => {
  const statements = build();
  const archive = statements.find((statement) => statement.table === 'services' && statement.step === 'archive');
  assert.match(archive.text, /SET deleted_at = NOW\(\), deleted_by = \$2::uuid/);
  assert.match(archive.text, /NOT EXISTS/);
  assert.match(archive.text, /organization_id = \$1::uuid AND deleted_at IS NULL/);
  const upsert = statements.find((statement) => statement.table === 'services' && statement.step === 'upsert');
  assert.match(upsert.text, /ON CONFLICT \(id\) DO UPDATE SET/);
  assert.match(upsert.text, /deleted_at = EXCLUDED\.deleted_at/);
  assert.match(upsert.text, /WHERE services\.organization_id = EXCLUDED\.organization_id/);
});

test('restore: technicians are archived all at once first, so two of them can swap a QRA', () => {
  const archive = build().find((statement) => statement.table === 'technicians' && statement.step === 'archive');
  assert.doesNotMatch(archive.text, /NOT EXISTS/);
  assert.equal(archive.params.length, 2);
});

test('restore: budgets that did not exist are zeroed, settings are only written back', () => {
  const statements = build();
  const zero = statements.find((statement) => statement.table === 'finance_budgets' && statement.step === 'zero');
  assert.match(zero.text, /SET amount = 0/);
  assert.ok(!statements.some((statement) => statement.table === 'organization_settings' && statement.step !== 'upsert'));
  const settings = statements.find((statement) => statement.table === 'organization_settings');
  assert.match(settings.text, /ON CONFLICT \(organization_id\) DO UPDATE SET commission_mode = EXCLUDED\.commission_mode, commission_rate = EXCLUDED\.commission_rate/);
});

test('restore: a table the backup has no rows for is still archived, and not written', () => {
  const statements = build();
  const visibility = statements.filter((statement) => statement.table === 'technician_visibility_settings');
  assert.deepEqual(visibility.map((statement) => statement.step), ['archive']);
  assert.equal(statements.some((statement) => statement.table === 'work_hours'), true, 'archives the hours that came after');
});

test('restore: a column the table no longer has is ignored, one that is new keeps its value', () => {
  const statements = rules.buildRestoreStatements({
    organizationId: ORG,
    actorId: ACTOR,
    tables: { services: rows('services', [{ id: 's1', value: 50, gone_column: 'x' }]) },
    columns: { services: ['id', 'organization_id', 'value', 'brand_new_column', 'deleted_at', 'deleted_by'] },
    plan: tables.RESTORE_TABLES.filter((entry) => entry.table === 'services'),
  });
  const upsert = statements.find((statement) => statement.step === 'upsert');
  assert.doesNotMatch(upsert.text, /gone_column/);
  assert.doesNotMatch(upsert.text, /brand_new_column/);
});

test('restore: a backup that holds a row of another company is refused before anything runs', () => {
  const foreign = { services: [{ id: 's9', organization_id: '99999999-9999-9999-9999-999999999999', value: 1 }] };
  assert.throws(() => build({ tables: foreign }), /outra empresa/);
});

test('restore: names that are not plain identifiers never reach the SQL', () => {
  assert.throws(() => rules.buildRestoreStatements({
    organizationId: ORG, actorId: ACTOR,
    tables: { services: [{ id: 's1', organization_id: ORG, 'value; DROP TABLE x': 1 }] },
    columns: { services: ['id', 'organization_id', 'value; DROP TABLE x'] },
    plan: [{ table: 'services', keys: ['id'], soft: true }],
  }), /inválido/);
});

test('what a restore never brings back: billing, credits, accounts, integrations and the parts', () => {
  const restored = tables.RESTORE_TABLES.map((entry) => entry.table);
  for (const protectedTable of ['subscriptions', 'billing_charges', 'ai_credit_ledger', 'users', 'porto_config', 'whatsapp_config', 'mercadopago_accounts', 'parts', 'part_movements', 'audit_events']) {
    assert.ok(!restored.includes(protectedTable), protectedTable);
  }
});

test('every table restored is also in the backup', () => {
  for (const entry of tables.RESTORE_TABLES) assert.ok(tables.BACKUP_TABLES.includes(entry.table), entry.table);
});
