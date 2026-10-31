// Run with: node scripts/test-payroll-input.cjs
// What the folha routes accept: the competence format and the amounts (no NaN, no negatives where they make
// no sense, nothing the database column cannot hold).
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
const { isCompetenceMonth, parsePayrollValues } = require('../lib/payroll-input.ts');

test('competence month must be YYYY-MM with a real month', () => {
  assert.equal(isCompetenceMonth('2026-10'), true);
  assert.equal(isCompetenceMonth('2026-12'), true);
  for (const bad of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', '', null, undefined, 202610]) {
    assert.equal(isCompetenceMonth(bad), false, String(bad));
  }
});

test('missing amounts count as zero and are rounded to cents', () => {
  const result = parsePayrollValues({ base_salary: 1234.567, commission_value: '99.994' });
  assert.ok('values' in result);
  assert.equal(result.values.base_salary, 1234.57);
  assert.equal(result.values.commission_value, 99.99);
  assert.equal(result.values.net_total, 0);
  assert.equal(result.values.extraordinary_award_value, 0);
});

test('invalid amounts are refused with a message', () => {
  for (const body of [{ base_salary: 'abc' }, { net_total: Number.NaN }, { va_deduction: {} }, { vr_deduction: Infinity }]) {
    const result = parsePayrollValues(body);
    assert.ok('error' in result, JSON.stringify(body));
  }
});

test('only the hour bank and the net may be negative', () => {
  assert.ok('values' in parsePayrollValues({ hour_bank_balance: -12.5, net_total: -300 }));
  for (const field of ['base_salary', 'commission_value', 'discounts_total', 'advances_total', 'extra_hours_value', 'total_services_value']) {
    assert.ok('error' in parsePayrollValues({ [field]: -1 }), field);
  }
});

test('amounts bigger than the column are refused', () => {
  assert.ok('error' in parsePayrollValues({ hour_bank_balance: 1e8 }));
  assert.ok('values' in parsePayrollValues({ hour_bank_balance: 99999999.99 }));
});
