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

// ---- payment periods inside the month (cut days)

test('a month without cut days has no periods: it is paid by the month', () => {
  assert.deepEqual(calendar.periodKeys([]), []);
  assert.equal(calendar.periodForDay(10, []), null);
  assert.equal(calendar.hasPeriods([]), false);
});

test('one cut day makes the usual two fortnights, the cut day itself still in the first', () => {
  assert.deepEqual(calendar.periodKeys([15]), ['Q1', 'Q2']);
  assert.equal(calendar.periodForDay(1, [15]), 'Q1');
  assert.equal(calendar.periodForDay(15, [15]), 'Q1');
  assert.equal(calendar.periodForDay(16, [15]), 'Q2');
  assert.equal(calendar.periodForDay(31, [15]), 'Q2');
  assert.equal(calendar.periodForDate('2026-10-23', [15]), 'Q2');
  assert.equal(calendar.periodForDate('2026-02-30', [15]), null, 'not a real day');
  assert.equal(calendar.periodForDate('', [15]), null);
});

test('any list of cut days cuts the month where the company wants', () => {
  assert.deepEqual(calendar.periodKeys([10, 20]), ['Q1', 'Q2', 'Q3']);
  assert.deepEqual([5, 10, 11, 20, 21, 31].map((day) => calendar.periodForDay(day, [10, 20])), ['Q1', 'Q1', 'Q2', 'Q2', 'Q3', 'Q3']);
  assert.deepEqual([7, 8, 14, 15, 21, 22, 31].map((day) => calendar.periodForDay(day, [7, 14, 21])), ['Q1', 'Q2', 'Q2', 'Q3', 'Q3', 'Q4', 'Q4']);
  assert.deepEqual(calendar.periodKeys([5, 10, 15, 20]), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
});

test('the screens say Q1 and Q2 for two fortnights and the days for anything else', () => {
  assert.equal(calendar.periodLabel('Q1', [15]), 'Q1');
  assert.equal(calendar.periodDescription('Q2', [15]), 'Segunda quinzena');
  assert.equal(calendar.periodLabel('Q2', [10, 20]), 'Período 2');
  assert.equal(calendar.periodDays('Q1', [10, 20]), 'dias 1 a 10');
  assert.equal(calendar.periodDays('Q2', [10, 20]), 'dias 11 a 20');
  assert.equal(calendar.periodDays('Q3', [10, 20]), 'dia 21 em diante');
  assert.equal(calendar.periodDescription('Q3', [10, 20]), 'Dia 21 em diante');
});

test('cut days are whole days from 1 to 27, increasing, at most four', () => {
  assert.deepEqual(calendar.normalizeCutDays([]), []);
  assert.deepEqual(calendar.normalizeCutDays([15]), [15]);
  assert.deepEqual(calendar.normalizeCutDays(['10', '20']), [10, 20]);
  for (const bad of [[0], [28], [15, 15], [20, 10], [1.5], [1, 2, 3, 4, 5], ['x'], 'a', null, undefined]) assert.equal(calendar.normalizeCutDays(bad), null, JSON.stringify(bad));
  assert.deepEqual(calendar.parseCutDays('10, 20'), [10, 20]);
  assert.deepEqual(calendar.parseCutDays('7;14 21'), [7, 14, 21]);
  assert.deepEqual(calendar.parseCutDays(''), []);
  assert.equal(calendar.parseCutDays('20, 10'), null);
  assert.equal(calendar.isPeriodKey('Q3'), true);
  assert.equal(calendar.isPeriodKey('Q6'), false);
});

test('a company keeps its cut day: new ones start at 15, a stored list is read as is, an invalid one falls back', () => {
  assert.deepEqual(settings.DEFAULT_ORGANIZATION_SETTINGS.periodCutDays, [15]);
  assert.deepEqual(settings.normalizeOrganizationSettings({ commission_mode: 'excess' }).periodCutDays, [15]);
  assert.deepEqual(settings.normalizeOrganizationSettings({ period_cut_days: [] }).periodCutDays, []);
  assert.deepEqual(settings.normalizeOrganizationSettings({ period_cut_days: [10, 20] }).periodCutDays, [10, 20]);
  assert.deepEqual(settings.normalizeOrganizationSettings({ period_cut_days: [20, 10] }).periodCutDays, [15]);
  const base = { ...settings.DEFAULT_ORGANIZATION_SETTINGS };
  assert.deepEqual(settings.parseOrganizationSettingsInput({ ...base, periodCutDays: [] }).settings.periodCutDays, []);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, periodCutDays: [28] }).error, /dias de corte/);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, periodCutDays: [10, 10] }).error, /dias de corte/);
  assert.deepEqual(settings.pickTechnicianSettings({ ...base, periodCutDays: [10, 20] }).periodCutDays, [10, 20]);
});
