// Run with: node scripts/test-billing-report.cjs
// The Faturamento numbers (lib/billing-report.ts): only closed folhas count, advances are part of the cost,
// the comparison wraps over December/January, a technician filter narrows everything.
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
const report = require('../lib/billing-report.ts');

const technicians = [
  { id: 'a', name: 'Ana', qra: 'A-1', status: 'active' },
  { id: 'b', name: 'Beto', qra: 'B-2', status: 'active' },
  { id: 'c', name: 'Caio', qra: 'C-3', status: 'inactive' },
];
const service = (technician, month, value, type = 'Reboque') => ({ id: `${technician}${month}${value}${type}`, technician_id: technician, competence_month: month, date_performed: `${month}-10`, value, service_type: type });
const folha = (technician, month, status, net, advances = 0, va = 0, vr = 0) => ({ technician_id: technician, competence_month: month, status, net_total: net, advances_total: advances, va_deduction: va, vr_deduction: vr });

const services = [
  service('a', '2026-10', 1000), service('a', '2026-10', 500, 'Pane'), service('b', '2026-10', 2000),
  service('a', '2026-09', 800), service('b', '2026-09', 700), service('c', '2026-10', 9999),
  service('a', '2025-12', 300), service('b', '2026-01', 400),
];
const payroll = [
  folha('a', '2026-10', 'closed', 600, 100, 50, 50), // cost 800
  folha('b', '2026-10', 'draft', 900), // draft: not a cost yet
  folha('a', '2026-09', 'closed', 300),
  folha('b', '2026-09', 'closed', 200),
];
const input = { services, payroll, technicians };
const october = { mode: 'monthly', year: 2026, month: 10, technicianId: 'all' };

test('a closed folha costs the net, the advances and the cards; a draft costs nothing yet', () => {
  assert.equal(report.payrollCostOf(folha('a', '2026-10', 'closed', 600, 100, 50, 50)), 800);
  const { current } = report.buildBillingReport(input, october);
  assert.equal(current.revenue, 3500);
  assert.equal(current.payrollCost, 800);
  assert.equal(current.net, 2700);
  assert.equal(current.payrollCount, 1);
});

test('services without a closed folha make the result partial, and say why', () => {
  const { current } = report.buildBillingReport(input, october);
  assert.equal(current.draftPayroll, 1, 'Beto has only a draft');
  assert.equal(current.missingPayroll, 0);
});

test('inactive technicians are left out', () => {
  const { current, technicians: rows } = report.buildBillingReport(input, october);
  assert.equal(current.services, 3);
  assert.ok(!rows.some((row) => row.id === 'c'));
});

test('the monthly comparison is the month before; January wraps to December', () => {
  const { previous } = report.buildBillingReport(input, october);
  assert.equal(previous.revenue, 1500);
  assert.equal(previous.payrollCost, 500);
  assert.deepEqual(report.previousPeriodMonths({ mode: 'monthly', year: 2026, month: 1 }), ['2025-12']);
  const january = report.buildBillingReport(input, { ...october, month: 1 });
  assert.equal(january.current.revenue, 400);
  assert.equal(january.previous.revenue, 300);
});

test('the annual view covers the twelve months and compares with the previous year', () => {
  const annual = report.buildBillingReport(input, { ...october, mode: 'annual' });
  assert.equal(annual.current.revenue, 3500 + 1500 + 400);
  assert.equal(annual.previous.revenue, 300);
  assert.equal(annual.trend.length, 12);
  assert.equal(annual.trend[0].key, '2026-01');
  assert.equal(annual.comparisonLabel, 'ano 2025');
});

test('the monthly evolution is the 12 months ending in the selected one', () => {
  const monthly = report.buildBillingReport(input, october);
  assert.equal(monthly.trend.length, 12);
  assert.equal(monthly.trend[11].key, '2026-10');
  assert.equal(monthly.trend[0].key, '2025-11');
  assert.equal(monthly.trend.find((point) => point.key === '2025-12').revenue, 300);
});

test('choosing a technician narrows everything', () => {
  const only = report.buildBillingReport(input, { ...october, technicianId: 'a' });
  assert.equal(only.current.revenue, 1500);
  assert.equal(only.current.payrollCost, 800);
  assert.equal(only.current.producers, 1);
  assert.equal(only.technicians.length, 1);
  assert.equal(only.activeTechnicians, 1);
});

test('types and the per-technician ranking add up to the total', () => {
  const full = report.buildBillingReport(input, october);
  assert.equal(full.types.reduce((total, type) => total + type.revenue, 0), full.current.revenue);
  assert.equal(full.technicians.reduce((total, row) => total + row.revenue, 0), full.current.revenue);
  assert.equal(full.technicians.reduce((total, row) => total + row.payrollCost, 0), full.current.payrollCost);
  const ana = full.technicians.find((row) => row.id === 'a');
  assert.equal(ana.ticket, 750);
  assert.equal(ana.net, 700);
  assert.equal(ana.margin, 46.67);
});

test('no revenue never divides by zero', () => {
  const empty = report.buildBillingReport({ services: [], payroll: [], technicians }, october);
  assert.equal(empty.current.margin, 0);
  assert.equal(empty.current.ticket, 0);
});
