// Run with: node scripts/test-schedule-alternation.cjs
// "Semana sim, semana não" and the teams that alternate are counted from a fixed Monday, not from the
// start of the period being built: an escala made month after month must keep alternating across months.
process.env.DATABASE_URL ??= 'postgres://user:pass@localhost/none';
process.env.JWT_SECRET ??= 'test';
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
const { buildPersistedSchedule, getScheduleWeekIndex } = require('../lib/schedule-planner.ts');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const TECHNICIANS = [A, B];

const rule = (mode, rotation_cadence = 'weekly') => ({ mode, technician_ids: [], rotation_cadence });
function input(month, overrides = {}) {
  return {
    period_mode: 'month',
    year: 2026,
    month,
    technician_scope: 'all',
    technician_ids: [],
    weekday_start_time: '08:00',
    weekday_end_time: '17:00',
    weekend_start_time: '08:00',
    weekend_end_time: '12:00',
    saturday_rule: rule('all'),
    sunday_rule: rule('off'),
    day_rules: {
      monday: rule('all'), tuesday: rule('all'), wednesday: rule('all'), thursday: rule('all'), friday: rule('all'),
      saturday: rule('all'), sunday: rule('off'),
    },
    groups: [],
    rotation_groups: [],
    recurring_rules: [],
    general_days_off: [],
    overrides: [],
    ...overrides,
  };
}
const SATURDAYS = { 10: ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31'], 11: ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'], 12: ['2026-12-05', '2026-12-12'] };
const worksOn = (rows, technicianId, date) => rows.find((row) => row.technician_id === technicianId && row.date === date)?.status === 'scheduled';

test('weeks are counted from a fixed Monday, Monday to Sunday', () => {
  assert.equal(getScheduleWeekIndex('2024-01-01'), 0);
  assert.equal(getScheduleWeekIndex('2024-01-07'), 0);
  assert.equal(getScheduleWeekIndex('2024-01-08'), 1);
  assert.equal(getScheduleWeekIndex('2026-10-31') + 1, getScheduleWeekIndex('2026-11-07'));
});

test('"semana sim, semana não" does not restart when the next month is built', () => {
  const saturdays = [...SATURDAYS[10], ...SATURDAYS[11], ...SATURDAYS[12]];
  const rows = [10, 11, 12].flatMap((month) => buildPersistedSchedule(input(month, { day_rules: { ...input(month).day_rules, saturday: rule('all', 'alternating') } }), TECHNICIANS));
  const works = saturdays.map((date) => worksOn(rows, A, date));
  for (let i = 1; i < works.length; i += 1) assert.notEqual(works[i], works[i - 1], `Saturdays ${saturdays[i - 1]} and ${saturdays[i]} must differ`);
});

test('the opposite phase works on the Saturdays the first one rests', () => {
  const saturdays = SATURDAYS[11];
  const on = buildPersistedSchedule(input(11, { day_rules: { ...input(11).day_rules, saturday: rule('all', 'alternating') } }), TECHNICIANS);
  const off = buildPersistedSchedule(input(11, { day_rules: { ...input(11).day_rules, saturday: rule('all', 'alternating_off') } }), TECHNICIANS);
  for (const date of saturdays) assert.notEqual(worksOn(on, A, date), worksOn(off, A, date), date);
});

test('two teams keep alternating from October into November', () => {
  const rotation_groups = [{ label: '', day_keys: ['saturday'], technician_ids: [A], rotation_cadence: 'weekly' }];
  const rows = [10, 11].flatMap((month) => buildPersistedSchedule(input(month, { rotation_groups }), TECHNICIANS));
  const saturdays = [...SATURDAYS[10], ...SATURDAYS[11]];
  for (const date of saturdays) assert.notEqual(worksOn(rows, A, date), worksOn(rows, B, date), `exactly one team on ${date}`);
  for (let i = 1; i < saturdays.length; i += 1) assert.notEqual(worksOn(rows, A, saturdays[i]), worksOn(rows, A, saturdays[i - 1]), saturdays[i]);
});

test('weekly days are unaffected', () => {
  const rows = buildPersistedSchedule(input(11), TECHNICIANS);
  for (const date of SATURDAYS[11]) assert.equal(worksOn(rows, A, date), true);
});
