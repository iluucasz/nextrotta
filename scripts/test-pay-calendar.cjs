// Run with: node scripts/test-pay-calendar.cjs
// The pay calendar (lib/pay-calendar.ts): which month an imported OS belongs to and which month the
// screens open on, plus the two settings that drive it (lib/organization-settings.ts).
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
const calendar = require('../lib/pay-calendar.ts');
const settings = require('../lib/organization-settings.ts');

test('a service goes to the month of its own date, whatever the batch month says', () => {
  assert.equal(calendar.competenceForImportRow('service_date', '2026-10-31', '2026-11'), '2026-10');
  assert.equal(calendar.competenceForImportRow('service_date', '2026-11-01', '2026-10'), '2026-11');
  assert.equal(calendar.competenceForImportRow('service_date', '2026-09-30', ''), '2026-09');
});

test('by batch, every row takes the month chosen for the file (the old rule)', () => {
  assert.equal(calendar.competenceForImportRow('batch', '2026-09-30', '2026-10'), '2026-10');
  assert.equal(calendar.competenceForImportRow('batch', '2026-11-02', '2026-10'), '2026-10');
});

test('an impossible date has no month', () => {
  assert.equal(calendar.competenceForImportRow('service_date', '2026-02-30', '2026-02'), '');
  assert.equal(calendar.competenceForImportRow('service_date', '', '2026-02'), '');
  assert.equal(calendar.competenceForDate('31/10/2026'), '');
  assert.equal(calendar.isDateKey('2028-02-29'), true);
  assert.equal(calendar.isDateKey('2027-02-29'), false);
});

test('the preview counts the OS of each month, oldest first', () => {
  const counts = calendar.countByCompetence(['2026-11-03', '2026-10-07', '2026-10-23', '2026-09-30', '2026-13-01', '']);
  assert.deepEqual(counts, [
    { month: '2026-09', count: 1 },
    { month: '2026-10', count: 2 },
    { month: '2026-11', count: 1 },
  ]);
});

test('months shift across the year boundary', () => {
  assert.equal(calendar.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(calendar.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(calendar.shiftMonth('2026-03', -14), '2025-01');
});

test('without a settle day the screens open on the current month', () => {
  assert.equal(calendar.defaultCompetenceMonth('2026-11-03', 0), '2026-11');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-30', 0), '2026-11');
});

test('with a settle day the screens open on the previous month until that day, inclusive', () => {
  assert.equal(calendar.defaultCompetenceMonth('2026-11-01', 5), '2026-10');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-05', 5), '2026-10');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-06', 5), '2026-11');
  assert.equal(calendar.defaultCompetenceMonth('2027-01-02', 5), '2026-12');
});

test('month labels read the Brazilian way', () => {
  assert.equal(calendar.monthLabel('2026-10'), '10/2026');
  assert.equal(calendar.monthLabel('x'), 'x');
});

test('a new organization keeps the old rules', () => {
  assert.equal(settings.DEFAULT_ORGANIZATION_SETTINGS.competenceSource, 'batch');
  assert.equal(settings.DEFAULT_ORGANIZATION_SETTINGS.settlePreviousMonthUntilDay, 0);
  // A row stored before the migration has neither column: it reads as the defaults.
  const legacy = settings.normalizeOrganizationSettings({ commission_mode: 'excess' });
  assert.equal(legacy.competenceSource, 'batch');
  assert.equal(legacy.settlePreviousMonthUntilDay, 0);
});

test('the settings are read from the stored row and validated on input', () => {
  const stored = settings.normalizeOrganizationSettings({ competence_source: 'service_date', settle_previous_month_until_day: 5 });
  assert.equal(stored.competenceSource, 'service_date');
  assert.equal(stored.settlePreviousMonthUntilDay, 5);

  const base = { ...settings.DEFAULT_ORGANIZATION_SETTINGS };
  assert.ok(settings.parseOrganizationSettingsInput({ ...base, competenceSource: 'service_date', settlePreviousMonthUntilDay: 5 }).settings);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, competenceSource: 'whenever' }).error, /mês de cada OS/);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, settlePreviousMonthUntilDay: 29 }).error, /acerto do mês anterior/);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, settlePreviousMonthUntilDay: -1 }).error, /acerto do mês anterior/);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, settlePreviousMonthUntilDay: 2.5 }).error, /acerto do mês anterior/);
});
