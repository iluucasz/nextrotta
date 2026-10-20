// Run with: node scripts/test-management-dashboard.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../lib/management-dashboard.ts');
const transpile = (file) =>
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
// The module imports other dependency-free lib/*.ts files (e.g. organization-settings) — resolve
// those extensionless relative imports to the .ts file and load them through the same transpiler.
require.extensions['.ts'] = (tsModule, tsFile) => tsModule._compile(transpile(tsFile), tsFile);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('.') && parent?.filename?.endsWith('.ts')) {
    const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return resolveFilename.call(this, request, parent, ...rest);
};
const calculationModule = new Module(filename, module);
calculationModule.filename = filename;
calculationModule.paths = Module._nodeModulePaths(path.dirname(filename));
calculationModule._compile(transpile(filename), filename);
const {
  buildManagementDashboard: build,
  defaultManagementFilters,
  aggregateOperations,
  variation,
  shiftMonth,
} = calculationModule.exports;
const defaults = () => ({ ...defaultManagementFilters('2026-01-20') });
const production = (month, technicianId, revenue, count, serviceType = 'Elétrica') => ({
  month,
  technicianId,
  revenue,
  count,
  serviceType,
});
const payroll = (month, technicianId, net = 4000, status = 'closed') => ({
  month,
  technicianId,
  net,
  status,
  advances: 500,
  benefits: 500,
});
const fixture = () => ({
  year: 2026,
  years: [2026, 2025],
  today: '2026-01-20',
  updatedAt: '2026-01-20T12:00:00Z',
  financeAvailable: true,
  technicians: [
    { id: 'a', name: 'Ana', qra: '01', status: 'active' },
    { id: 'b', name: 'Bruno', qra: '02', status: 'inactive' },
  ],
  production: [
    production('2025-12', 'a', 10000, 10),
    production('2026-01', 'a', 12000, 6),
    production('2026-01', 'a', 8000, 4, 'Hidráulica'),
    production('2026-01', 'b', 10000, 10),
  ],
  payroll: [payroll('2025-12', 'a'), payroll('2026-01', 'a'), payroll('2026-01', 'b', 2000)],
  expenses: [{ month: '2026-01', category: 'Combustível', status: 'pending', amount: 3000, paid: 1000 }],
  operations: [],
});

test('consolida faturamento, ticket ponderado e custos sem perder adiantamentos', () => {
  const result = build(fixture(), defaults());
  assert.equal(result.current.revenue, 30000);
  assert.equal(result.current.services, 20);
  assert.equal(result.current.ticket, 1500);
  assert.equal(result.current.payrollCost, 8000);
  assert.equal(result.current.transfer, 7000);
  assert.equal(result.current.expenses, 3000);
  assert.equal(result.current.net, 19000);
  assert.equal(result.current.margin, 63.33);
  assert.equal(result.technicians[0].name, 'Ana');
  assert.equal(result.technicians[0].id, 'a');
  assert.equal(
    result.technicians.reduce((sum, t) => sum + t.net, 0),
    result.current.net,
  );
});

test('comparação de janeiro atravessa o ano e tendência tem 12 meses completos', () => {
  const result = build(fixture(), defaults());
  assert.equal(result.previous.revenue, 10000);
  assert.equal(result.comparisonLabel, 'Dezembro de 2025');
  assert.equal(result.trend.length, 12);
  assert.equal(result.trend[0].month, '2025-02');
  assert.equal(result.trend[11].revenue, 30000);
  assert.equal(result.trend[0].services, 0);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('visão anual soma valores, recalcula ticket e compara ao ano anterior', () => {
  const data = fixture();
  data.production.push(production('2026-02', 'a', 1000, 10));
  const result = build(data, { ...defaults(), mode: 'annual' });
  assert.equal(result.current.revenue, 31000);
  assert.equal(result.current.ticket, 1033.33);
  assert.equal(result.previous.revenue, 10000);
  assert.equal(result.current.missingPayroll, 1);
  assert.equal(result.trend[0].month, '2026-01');
  assert.equal(result.trend[11].month, '2026-12');
});

test('inclui histórico inativo e aplica filtro de situação sem perder o rateio mensal', () => {
  const result = build(fixture(), { ...defaults(), technicianStatus: 'inactive' });
  assert.equal(result.current.revenue, 10000);
  assert.equal(result.current.expenses, 1000);
  assert.equal(result.current.payrollCost, 3000);
  assert.equal(result.current.net, 6000);
  assert.equal(result.technicians.length, 1);
});

test('recorte de técnico e serviço rateia folha e despesas, mantendo ticket do serviço', () => {
  const result = build(fixture(), { ...defaults(), technicianIds: ['a'], serviceType: 'Elétrica' });
  assert.equal(result.current.revenue, 12000);
  assert.equal(result.current.services, 6);
  assert.equal(result.current.ticket, 2000);
  assert.equal(result.current.payrollCost, 3000);
  assert.equal(result.current.expenses, 1200);
  assert.equal(result.current.net, 7800);
  assert.equal(result.types.length, 1);
});

test('pagamentos parciais dividem corretamente valor pago e saldo aberto', () => {
  assert.equal(build(fixture(), { ...defaults(), expenseStatus: 'paid' }).current.expenses, 1000);
  assert.equal(build(fixture(), { ...defaults(), expenseStatus: 'pending' }).current.expenses, 2000);
  assert.equal(build(fixture(), { ...defaults(), expenseCategory: 'Inexistente' }).current.expenses, 0);
});

test('rascunhos são excluídos por padrão e folhas pendentes sinalizam resultado incompleto', () => {
  const data = fixture();
  data.payroll[1].status = 'draft';
  const result = build(data, defaults());
  assert.equal(result.current.payrollCost, 3000);
  assert.equal(result.current.missingPayroll, 1);
  assert.equal(result.current.draftPayroll, 0);
  const preview = build(data, { ...defaults(), payrollStatus: 'all' });
  assert.equal(preview.current.payrollCost, 8000);
  assert.equal(preview.current.draftPayroll, 1);
  assert.equal(preview.current.missingPayroll, 1);
});

test('custos independem de haver serviços e o filtro de origem afeta todo o resultado', () => {
  const data = fixture();
  data.production = [];
  assert.equal(build(data, defaults()).current.net, -11000);
  assert.equal(build(data, defaults()).current.ticket, 0);
  assert.equal(build(fixture(), { ...defaults(), costScope: 'payroll' }).current.totalCosts, 8000);
  assert.equal(build(fixture(), { ...defaults(), costScope: 'expenses' }).current.totalCosts, 3000);
});

test('variação não gera infinito e interpreta corretamente resultados negativos', () => {
  assert.equal(variation(100, 0), null);
  assert.equal(variation(0, 0), 0);
  assert.equal(variation(-50, -100), 50);
  assert.equal(variation(0, 100), -100);
});

const schedule = (date, status, notes = null, technicianId = 'a') => ({
  technicianId,
  date,
  status,
  notes,
  start: '08:00',
  end: '17:00',
});
test('ausências usam apontamentos explícitos: folga, cancelamento, pendência e futuro não viram faltas', () => {
  const result = aggregateOperations(
    [
      schedule('2026-01-01', 'cancelled', 'Apontamento manual: falta; previsto=08:00-17:00'),
      schedule('2026-01-02', 'cancelled', 'Apontamento manual: justificado; previsto=08:00-17:00'),
      schedule('2026-01-03', 'cancelled', 'Apontamento manual: folga; previsto=08:00-17:00'),
      schedule('2026-01-04', 'cancelled', 'Folga planejada'),
      schedule('2026-01-05', 'scheduled'),
      schedule('2026-01-20', 'scheduled'),
      schedule('2026-01-21', 'cancelled', 'Apontamento manual: falta; previsto=08:00-17:00'),
    ],
    [],
    '2026-01-20',
  )[0];
  assert.equal(result.missed, 1);
  assert.equal(result.justified, 1);
  assert.equal(result.daysOff, 2);
  assert.equal(result.pending, 1);
  assert.equal(result.observed, 2);
  assert.equal(result.debits, 8);
  assert.equal(result.planned, 8);
});

test('banco respeita pausa, apontamento real e histórico anterior ao período', () => {
  const operations = aggregateOperations(
    [
      schedule('2024-12-01', 'completed'),
      schedule('2026-01-01', 'completed', 'Apontamento manual: trabalhou; previsto=08:00-17:00'),
      schedule('2026-01-02', 'completed'),
      schedule('2026-01-04', 'completed'),
    ],
    [
      { technicianId: 'a', date: '2024-12-01', hours: 10 },
      { technicianId: 'a', date: '2026-01-01', hours: 10 },
      { technicianId: 'a', date: '2026-01-02', hours: 7 },
      { technicianId: 'a', date: '2026-01-03', hours: 12 }, // No shift: no automatic credit.
    ],
    '2026-01-20',
  );
  const data = fixture();
  data.operations = operations;
  const result = build(data, defaults());
  assert.equal(result.current.worked, 29);
  assert.equal(result.current.credits, 2);
  assert.equal(result.current.debits, 1);
  assert.equal(result.current.balance, 1);
  assert.equal(result.accumulated, 3);
  assert.equal(result.trend[11].accumulated, 3);
  assert.equal(build(data, { ...defaults(), technicianIds: ['b'] }).accumulated, 0);
  assert.equal(build(data, { ...defaults(), serviceType: 'Hidráulica' }).current.worked, 29);
});

test('recorte vazio mantém métricas finitas e não atribui despesas a técnico inexistente', () => {
  const result = build(fixture(), { ...defaults(), technicianIds: ['missing'] });
  assert.equal(result.technicians.length, 0);
  for (const value of Object.values(result.current)) assert.equal(value, 0);
});
