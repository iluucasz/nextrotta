// Run with: node scripts/test-data-retention.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
const { dataDeletionDate, LOCKED_DATA_RETENTION_MONTHS } = require('../lib/data-retention.ts');

const day = (date) => date.toISOString().slice(0, 10);

test('the data is kept for 3 months after the lock', () => {
  assert.equal(LOCKED_DATA_RETENTION_MONTHS, 3);
  assert.equal(day(dataDeletionDate('2026-11-05T17:13:00Z')), '2027-02-05');
});

test('the end of a month is clamped, never rolled into the next one', () => {
  assert.equal(day(dataDeletionDate('2026-11-30T12:00:00Z')), '2027-02-28');
  assert.equal(day(dataDeletionDate('2026-05-31T12:00:00Z')), '2026-08-31');
  assert.equal(day(dataDeletionDate('2027-11-30T12:00:00Z')), '2028-02-29', 'a leap year');
});

test('the day is the one in Brasília, not in UTC', () => {
  // 01:00 UTC on the 6th is still the evening of the 5th in Brasília.
  assert.equal(day(dataDeletionDate('2026-11-06T01:00:00Z')), '2027-02-05');
});

test('an invalid date gives nothing', () => {
  assert.equal(dataDeletionDate('not a date'), null);
});
