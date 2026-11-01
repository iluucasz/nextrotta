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

// ---- commission paid per service, hour or day, and the guaranteed minimum / cap ----

test('per_service: a fixed amount for each OS of the month, whatever the OS are worth', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 42, rate: 30 }), 1260);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 42, rate: 30, totalServices: 1 }), 1260);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 0, rate: 30 }), 0);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 3, rate: 33.335 }), 100.01);
});

test('per_hour: a fixed amount for each hour worked, with fractions of an hour', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_hour', totalHours: 168.5, rate: 18 }), 3033);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_hour', totalHours: 7.25, rate: 20 }), 145);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_hour', totalHours: 0, rate: 18 }), 0);
});

test('per_day: a fixed amount for each day worked', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_day', daysWorked: 21, rate: 120 }), 2520);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_day', daysWorked: 0, rate: 120 }), 0);
});

test('the per-unit modes ignore the salary, the cards and the percentage', () => {
  const free = { ...base, percentage: 90, baseSalary: 99999, vrAllowance: 5000, vaAllowance: 5000 };
  assert.equal(rules.calculateCommissionValue({ ...free, mode: 'per_service', serviceCount: 10, rate: 12.5 }), 125);
});

test('a missing or negative rate or count never makes a negative commission', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 10 }), 0);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 10, rate: -5 }), 0);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_hour', totalHours: -10, rate: 18 }), 0);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_day', daysWorked: Number.NaN, rate: 100 }), 0);
});

test('minimum: a guaranteed commission, also when the rule gives less', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 5, rate: 30, minimum: 500 }), 500);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 50, rate: 30, minimum: 500 }), 1500);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'excess', totalServices: 1000, minimum: 300 }), 300);
});

test('cap: the commission never goes above the ceiling, and the cap wins over the minimum', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 200, rate: 30, maximum: 4000 }), 4000);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'percentage', maximum: 5000 }), 5000);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'per_service', serviceCount: 5, rate: 30, minimum: 800, maximum: 600 }), 600);
});

test('none ignores the minimum: no commission means none', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'none', minimum: 500, rate: 30, serviceCount: 10 }), 0);
});

test('the old modes are untouched by the new inputs', () => {
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'excess' }), 1281.47);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'excess', rate: 999, serviceCount: 99, minimum: 0, maximum: 0 }), 1281.47);
  assert.equal(rules.calculateCommissionValue({ ...base, mode: 'percentage' }), 5682.07);
});

test('rateKindOf says what the stored amount means in each mode', () => {
  assert.deepEqual(['excess', 'percentage', 'per_service', 'per_hour', 'per_day', 'none'].map((mode) => rules.rateKindOf(mode)), ['percent', 'percent', 'service', 'hour', 'day', null]);
});

test('settings: the new modes and amounts are accepted, bad ones are refused with a message', () => {
  const ok = settings.parseOrganizationSettingsInput({ ...settings.DEFAULT_ORGANIZATION_SETTINGS, commissionMode: 'per_service', commissionRate: 35.5, commissionMinimum: 500, commissionMaximum: 4000 });
  assert.equal(ok.error, undefined);
  assert.equal(ok.settings.commissionMode, 'per_service');
  assert.equal(ok.settings.commissionRate, 35.5);
  const negative = settings.parseOrganizationSettingsInput({ ...settings.DEFAULT_ORGANIZATION_SETTINGS, commissionRate: -1 });
  assert.match(negative.error, /comissão/i);
  const inverted = settings.parseOrganizationSettingsInput({ ...settings.DEFAULT_ORGANIZATION_SETTINGS, commissionMinimum: 900, commissionMaximum: 400 });
  assert.match(inverted.error, /teto/i);
  assert.equal(settings.parseOrganizationSettingsInput({ ...settings.DEFAULT_ORGANIZATION_SETTINGS, commissionMode: 'bogus' }).error !== undefined, true);
  assert.equal(settings.normalizeOrganizationSettings({ commission_mode: 'per_hour', commission_rate: '18.00' }).commissionRate, 18);
});
