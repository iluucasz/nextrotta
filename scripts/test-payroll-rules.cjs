// Run with: node scripts/test-payroll-rules.cjs
// The folha arithmetic (lib/payroll-rules.ts): the three ways a company can pay commission, overtime,
// the production award and what goes to the technician's account. The numbers of the first test are the
// worked example in docs/calculo-folha.md.
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
const rules = require('../lib/payroll-rules.ts');
const settings = require('../lib/organization-settings.ts');

const base = { totalServices: 22728.28, percentage: 25, baseSalary: 3452, vrAllowance: 699.6, vaAllowance: 249 };

test('excess: the commission is what the production percentage leaves after salary and cards', () => {
  assert.equal(rules.commissionBase(22728.28, 25), 5682.07);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'excess' }), 1281.47);
});

test('excess never goes below zero', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'excess', totalServices: 3772, percentage: 25, baseSalary: 2000, vrAllowance: 620, vaAllowance: 320 }), 0);
});

test('percentage: the plain percentage, whatever the salary and cards are', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'percentage' }), 5682.07);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'percentage', totalServices: 0 }), 0);
});

test('none: no commission at all', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'none' }), 0);
});

test('a negative production never makes a negative commission', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'percentage', totalServices: -100 }), 0);
});

test('overtime: hours over the target at the hourly rate times the multiplier', () => {
  const result = rules.calculateOvertime({ totalHours: 230, monthlyHours: 220, baseSalary: 2200, multiplier: 1.5 });
  assert.equal(result.extraHours, 10);
  assert.equal(result.hourlyRate, 10);
  assert.equal(result.value, 150);
  assert.equal(rules.calculateOvertime({ totalHours: 200, monthlyHours: 220, baseSalary: 2200, multiplier: 1.5 }).value, 0);
  assert.equal(rules.calculateOvertime({ totalHours: 230, monthlyHours: 220, baseSalary: 0, multiplier: 1.5 }).value, 0);
  assert.equal(rules.calculateOvertime({ totalHours: 230, monthlyHours: 0, baseSalary: 2200, multiplier: 1.5 }).value, 0);
});

test('award: the highest tier reached, and the next one to reach', () => {
  const tiers = [{ minServices: 80, amount: 250 }, { minServices: 100, amount: 500 }];
  assert.deepEqual(rules.awardProgress(32, tiers), { reached: null, next: tiers[0] });
  assert.deepEqual(rules.awardProgress(80, tiers), { reached: tiers[0], next: tiers[1] });
  assert.deepEqual(rules.awardProgress(120, tiers), { reached: tiers[1], next: null });
  assert.equal(settings.calculateServiceAward(100, tiers), 500);
});

test('cash net: earnings minus discounts and advances', () => {
  assert.equal(rules.calculateCashNet({ baseSalary: 2000, commission: 0, extraHours: 40, award: 10, discounts: 20, advances: 10 }), 2020);
});

test('settings: an unknown commission mode falls back to the old rule, a valid one is kept', () => {
  assert.equal(settings.normalizeOrganizationSettings({ commission_mode: 'whatever' }).commissionMode, 'excess');
  assert.equal(settings.normalizeOrganizationSettings({ commission_mode: 'none' }).commissionMode, 'none');
  assert.equal(settings.normalizeOrganizationSettings({}).commissionMode, 'excess');
  assert.ok(settings.parseOrganizationSettingsInput({ ...settings.DEFAULT_ORGANIZATION_SETTINGS, commissionMode: 'percentage' }).settings);
  assert.ok(settings.parseOrganizationSettingsInput({ ...settings.DEFAULT_ORGANIZATION_SETTINGS, commissionMode: 'x' }).error);
});
