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

// ---- presets chosen when a company is created

test('the monthly preset drops the fortnights and counts each OS in its own month; the fortnightly one is the old default', () => {
  const presets = require('../lib/pay-presets.ts');
  assert.deepEqual(presets.PAY_PRESETS, ['fortnightly', 'monthly']);
  assert.equal(presets.isPayPreset('monthly'), true);
  assert.equal(presets.isPayPreset('weekly'), false);
  assert.equal(presets.isPayPreset(undefined), false);

  const monthly = presets.applyPayPreset(settings.DEFAULT_ORGANIZATION_SETTINGS, 'monthly');
  assert.deepEqual(monthly.periodCutDays, []);
  assert.equal(monthly.competenceSource, 'service_date');
  assert.equal(calendar.hasPeriods(monthly.periodCutDays), false);
  assert.equal(monthly.commissionMode, settings.DEFAULT_ORGANIZATION_SETTINGS.commissionMode, 'the rest is untouched');

  // Applying "fortnightly" to a fresh company changes nothing: it is what every company already gets.
  const fortnightly = presets.applyPayPreset(settings.DEFAULT_ORGANIZATION_SETTINGS, 'fortnightly');
  assert.deepEqual(fortnightly, settings.DEFAULT_ORGANIZATION_SETTINGS);

  // Whatever a preset writes is valid for the settings screen too.
  for (const preset of presets.PAY_PRESETS) {
    assert.ok(settings.parseOrganizationSettingsInput(presets.applyPayPreset(settings.DEFAULT_ORGANIZATION_SETTINGS, preset)).settings, preset);
  }
});

// ---- the closing day (month closing for payment)

test('without a closing day the competence is the calendar month, as it always was', () => {
  assert.equal(calendar.competenceForDate('2026-10-31', 0), '2026-10');
  assert.equal(calendar.competenceForDate('2026-10-31'), '2026-10');
  assert.deepEqual(calendar.competenceRange('2026-02', 0), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(calendar.competenceRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(calendar.cycleDay('2026-10-17', 0), 17);
});

test('a closing day of 25: the competence of November runs from 26/10 to 25/11', () => {
  assert.equal(calendar.competenceForDate('2026-10-25', 25), '2026-10');
  assert.equal(calendar.competenceForDate('2026-10-26', 25), '2026-11');
  assert.equal(calendar.competenceForDate('2026-11-25', 25), '2026-11');
  assert.equal(calendar.competenceForDate('2026-11-26', 25), '2026-12');
  assert.equal(calendar.competenceForDate('2026-12-31', 25), '2027-01', 'the year changes with the competence');
  assert.equal(calendar.competenceForDate('2026-02-30', 25), '', 'not a real day');
  assert.deepEqual(calendar.competenceRange('2026-11', 25), { from: '2026-10-26', to: '2026-11-25' });
  assert.deepEqual(calendar.competenceRange('2027-01', 25), { from: '2026-12-26', to: '2027-01-25' });
  assert.deepEqual(calendar.competenceRange('x', 25), { from: '', to: '' });
});

test('every competence starts the day after the previous one ends', () => {
  const dayAfter = (key) => new Date(Date.parse(`${key}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  for (const closing of [0, 1, 5, 15, 25, 27]) {
    for (const [first, second] of [['2026-01', '2026-02'], ['2026-02', '2026-03'], ['2026-12', '2027-01']]) {
      const a = calendar.competenceRange(first, closing);
      const b = calendar.competenceRange(second, closing);
      assert.equal(b.from, dayAfter(a.to), `${closing}: ${first} -> ${second}`);
      for (const date of [a.from, a.to]) assert.equal(calendar.competenceForDate(date, closing), first, `${closing}: ${date}`);
    }
  }
});

test('days since the last closing', () => {
  assert.equal(calendar.cycleDay('2026-10-26', 25), 1);
  assert.equal(calendar.cycleDay('2026-10-31', 25), 6);
  assert.equal(calendar.cycleDay('2026-11-01', 25), 7);
  assert.equal(calendar.cycleDay('2026-11-25', 25), 31, 'the competence of November has 31 days');
  assert.equal(calendar.cycleDay('2026-12-01', 25), 6);
  assert.equal(calendar.cycleDay('2026-03-02', 25), 5, 'February has 28 days: 26/02 is day 1');
  assert.equal(calendar.cycleDay('2026-11-03', 0), 3);
});

test('the screens open on the competence in progress, and on the one that just closed until the settle day', () => {
  // closing 25, no settle day: 26/10 already opens November.
  assert.equal(calendar.defaultCompetenceMonth('2026-10-25', 0, 25), '2026-10');
  assert.equal(calendar.defaultCompetenceMonth('2026-10-26', 0, 25), '2026-11');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-10', 0, 25), '2026-11');
  // closing 25 and 5 days to settle: until 30/10 the competence of October that closed on the 25th is still the one opened.
  assert.equal(calendar.defaultCompetenceMonth('2026-10-26', 5, 25), '2026-10');
  assert.equal(calendar.defaultCompetenceMonth('2026-10-30', 5, 25), '2026-10');
  assert.equal(calendar.defaultCompetenceMonth('2026-10-31', 5, 25), '2026-11');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-20', 5, 25), '2026-11');
  // The old rule is the same call with the closing day 0.
  assert.equal(calendar.defaultCompetenceMonth('2026-11-05', 5, 0), '2026-10');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-06', 5, 0), '2026-11');
  assert.equal(calendar.defaultCompetenceMonth('2026-11-05', 5), '2026-10');
});

test('the import follows the closing day only when the month comes from the service date', () => {
  assert.equal(calendar.competenceForImportRow('service_date', '2026-10-26', '2026-10', 25), '2026-11');
  assert.equal(calendar.competenceForImportRow('batch', '2026-10-26', '2026-10', 25), '2026-10');
  assert.deepEqual(calendar.countByCompetence(['2026-10-25', '2026-10-26', '2026-11-25', '2026-11-26'], 25), [
    { month: '2026-10', count: 1 },
    { month: '2026-11', count: 2 },
    { month: '2026-12', count: 1 },
  ]);
});

test('with a closing day the cut days count from the start of the competence', () => {
  // 26/10 is day 1 of the competence of November: with a cut at 15, Q1 goes to 9/11 and Q2 from 10/11.
  assert.equal(calendar.periodForDate('2026-10-26', [15], 25), 'Q1');
  assert.equal(calendar.periodForDate('2026-11-09', [15], 25), 'Q1');
  assert.equal(calendar.periodForDate('2026-11-10', [15], 25), 'Q2');
  assert.equal(calendar.periodForDate('2026-11-25', [15], 25), 'Q2');
  assert.equal(calendar.periodForDate('2026-11-26', [15], 25), 'Q1', 'a new competence starts again');
  assert.equal(calendar.periodForDate('2026-11-10', [], 25), null);
  assert.equal(calendar.periodForDate('2026-11-16', [15], 0), 'Q2', 'closing 0 is the calendar day');
});

test('the closing day is a whole number from 0 to 27', () => {
  assert.equal(calendar.normalizeClosingDay(0), 0);
  assert.equal(calendar.normalizeClosingDay('25'), 25);
  for (const bad of [-1, 28, 2.5, 'x', '', null, undefined]) assert.equal(calendar.normalizeClosingDay(bad), null, String(bad));
  assert.equal(settings.DEFAULT_ORGANIZATION_SETTINGS.monthClosingDay, 0);
  assert.equal(settings.normalizeOrganizationSettings({ commission_mode: 'excess' }).monthClosingDay, 0);
  assert.equal(settings.normalizeOrganizationSettings({ month_closing_day: 25 }).monthClosingDay, 25);
  const base = { ...settings.DEFAULT_ORGANIZATION_SETTINGS };
  assert.equal(settings.parseOrganizationSettingsInput({ ...base, monthClosingDay: 25 }).settings.monthClosingDay, 25);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, monthClosingDay: 28 }).error, /fechamento do mês/);
  assert.match(settings.parseOrganizationSettingsInput({ ...base, monthClosingDay: -1 }).error, /fechamento do mês/);
  assert.equal(settings.pickTechnicianSettings({ ...base, monthClosingDay: 25 }).monthClosingDay, 25);
});

test('the competence of an hours row follows the closing day too', () => {
  const formatters = require('../lib/formatters.ts');
  assert.equal(formatters.monthKeyFromDate('2026-10-26T00:00:00.000Z'), '2026-10');
  assert.equal(formatters.monthKeyFromDate('2026-10-26T00:00:00.000Z', 25), '2026-11');
  assert.equal(formatters.monthKeyFromDate('2026-10-25T00:00:00.000Z', 25), '2026-10');
});
