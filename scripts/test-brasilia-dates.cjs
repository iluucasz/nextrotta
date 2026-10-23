// Run with: node scripts/test-brasilia-dates.cjs   (also with TZ=UTC or TZ=Asia/Tokyo: the result must not change)
// Calendar days and months in Brasília time, whatever the zone of the machine (Vercel runs in UTC,
// where from 21:00 on "today" is already tomorrow).
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
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
const { brasiliaDateKey, formatDate } = require('../lib/formatters.ts');
const { previousCompetenceMonth } = require('../lib/payroll-utils.ts');
const { getScheduleRange } = require('../lib/schedule-planner.ts');

test('brasiliaDateKey: the day in Brasília, not the UTC day', () => {
  assert.equal(brasiliaDateKey(new Date('2026-10-13T12:00:00Z')), '2026-10-13');
  assert.equal(brasiliaDateKey(new Date('2026-10-14T00:30:00Z')), '2026-10-13', '21:30 in Brasília is still the 13th');
  assert.equal(brasiliaDateKey(new Date('2026-10-14T02:59:00Z')), '2026-10-13');
  assert.equal(brasiliaDateKey(new Date('2026-10-14T03:00:00Z')), '2026-10-14');
  assert.equal(brasiliaDateKey(new Date('2026-11-01T01:00:00Z')).slice(0, 7), '2026-10', 'month end');
  assert.equal(brasiliaDateKey(new Date('2027-01-01T02:00:00Z')), '2026-12-31', 'year end');
});

test('formatDate: a DATE column is a calendar day, not a moment', () => {
  assert.equal(formatDate('2026-10-13'), '13/10/2026');
  assert.equal(formatDate('2026-10-13T00:00:00.000Z'), '13/10/2026');
  assert.equal(formatDate('2026-10-13T00:00:00Z'), '13/10/2026');
  assert.equal(formatDate(null), '-');
});

test('previousCompetenceMonth: same answer in any time zone', () => {
  assert.equal(previousCompetenceMonth('2026-03'), '2026-02');
  assert.equal(previousCompetenceMonth('2026-01'), '2025-12');
  assert.equal(previousCompetenceMonth('2026-10'), '2026-09');
  assert.equal(previousCompetenceMonth('2026-12'), '2026-11');
});

test('schedule range without a month means the current month in Brasília', () => {
  const { startDate } = getScheduleRange('month', Number(brasiliaDateKey().slice(0, 4)));
  assert.equal(startDate.slice(0, 7), brasiliaDateKey().slice(0, 7));
});
