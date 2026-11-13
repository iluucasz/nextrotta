// Run with: node scripts/test-commission-formula.cjs
// The "Personalizado" commission: a calculation built in steps (lib/commission-formula.ts), its checks, the
// templates (which must give the same numbers as the fixed modes) and how it joins the folha and the settings.
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
const f = require('../lib/commission-formula.ts');
const rules = require('../lib/payroll-rules.ts');
const settings = require('../lib/organization-settings.ts');

const src = (source) => ({ kind: 'source', source });
const num = (value) => ({ kind: 'number', value });
const step = (id) => ({ kind: 'step', step: id });
const inputs = (extra = {}) => ({ ...f.ZERO_INPUTS, ...f.EXAMPLE_INPUTS, ...extra });

test('percent: a percentage of the production, from a number or from the technician', () => {
  const fixed = { steps: [{ id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(30) }] };
  assert.equal(f.commissionFromFormula(fixed, inputs()), 3000);
  const own = { steps: [{ id: 's1', label: '', kind: 'percent', of: src('production'), percent: src('percentage') }] };
  assert.equal(f.commissionFromFormula(own, inputs({ percentage: 12.5 })), 1250);
});

test('multiply and divide: R$ per OS, per hour, and a division by zero is zero, never an error', () => {
  const perService = { steps: [{ id: 's1', label: '', kind: 'multiply', of: src('services'), by: num(30) }] };
  assert.equal(f.commissionFromFormula(perService, inputs()), 1260);
  const perHour = { steps: [{ id: 's1', label: '', kind: 'multiply', of: src('hours'), by: src('rate') }] };
  assert.equal(f.commissionFromFormula(perHour, inputs({ hours: 168.5, rate: 18 })), 3033);
  const hourOfSalary = { steps: [{ id: 's1', label: '', kind: 'divide', of: src('salary'), by: num(220) }] };
  assert.equal(f.commissionFromFormula(hourOfSalary, inputs({ salary: 2200 })), 10);
  const byZero = { steps: [{ id: 's1', label: '', kind: 'divide', of: src('salary'), by: num(0) }] };
  assert.equal(f.commissionFromFormula(byZero, inputs()), 0);
});

test('add and subtract take several things at once, and the commission never goes below zero', () => {
  const formula = {
    steps: [
      { id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(30) },
      { id: 's2', label: '', kind: 'subtract', of: step('s1'), items: [src('salary'), src('vr')] },
    ],
  };
  const result = f.evaluateCommissionFormula(formula, inputs());
  assert.equal(result.value, 500);
  assert.equal(f.evaluateCommissionFormula(formula, inputs({ production: 5000 })).value, 0);
  assert.equal(f.evaluateCommissionFormula(formula, inputs({ production: 5000 })).raw, -1000);
  const sum = { steps: [{ id: 's1', label: '', kind: 'add', of: num(100), items: [num(50), src('services')] }] };
  assert.equal(f.commissionFromFormula(sum, inputs()), 192);
});

test('at_least and at_most hold a value between a floor and a ceiling', () => {
  const base = { id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(10) };
  const floor = { steps: [base, { id: 's2', label: '', kind: 'at_least', of: step('s1'), limit: num(1500) }] };
  assert.equal(f.commissionFromFormula(floor, inputs()), 1500);
  assert.equal(f.commissionFromFormula(floor, inputs({ production: 30000 })), 3000);
  const cap = { steps: [base, { id: 's2', label: '', kind: 'at_most', of: step('s1'), limit: num(800) }] };
  assert.equal(f.commissionFromFormula(cap, inputs()), 800);
  assert.equal(f.commissionFromFormula(cap, inputs({ production: 5000 })), 500);
});

test('tiers reached: the amount of the highest tier reached, and nothing before the first', () => {
  const formula = { steps: [{ id: 's1', label: '', kind: 'tiers', measure: src('services'), style: 'reached', pays: 'amount', tiers: [{ from: 30, value: 300 }, { from: 40, value: 500 }, { from: 60, value: 900 }] }] };
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 29 })), 0);
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 30 })), 300);
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 42 })), 500);
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 99 })), 900);
  const percent = { steps: [{ id: 's1', label: '', kind: 'tiers', measure: src('production'), style: 'reached', pays: 'percent', tiers: [{ from: 0, value: 10 }, { from: 8000, value: 15 }] }] };
  assert.equal(f.commissionFromFormula(percent, inputs({ production: 10000 })), 1500);
  assert.equal(f.commissionFromFormula(percent, inputs({ production: 5000 })), 500);
});

test('tiers progressive: each part of the measure pays its own band, the way a tax table does', () => {
  const formula = { steps: [{ id: 's1', label: '', kind: 'tiers', measure: src('services'), style: 'progressive', pays: 'amount', tiers: [{ from: 0, value: 20 }, { from: 40, value: 30 }, { from: 80, value: 40 }] }] };
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 0 })), 0);
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 40 })), 800);
  // 40 × 20 + 2 × 30
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 42 })), 860);
  // 40 × 20 + 40 × 30 + 20 × 40
  assert.equal(f.commissionFromFormula(formula, inputs({ services: 100 })), 2800);
  const percent = { steps: [{ id: 's1', label: '', kind: 'tiers', measure: src('production'), style: 'progressive', pays: 'percent', tiers: [{ from: 0, value: 10 }, { from: 5000, value: 20 }] }] };
  // 10% of the first 5.000 + 20% of the next 5.000
  assert.equal(f.commissionFromFormula(percent, inputs({ production: 10000 })), 1500);
});

test('condition: one value when the comparison holds, another when it does not', () => {
  const formula = {
    steps: [
      { id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(20) },
      { id: 's2', label: '', kind: 'condition', left: src('production'), op: 'gte', right: num(8000), then: step('s1'), otherwise: num(0) },
    ],
  };
  assert.equal(f.commissionFromFormula(formula, inputs()), 2000);
  assert.equal(f.commissionFromFormula(formula, inputs({ production: 7999.99 })), 0);
  assert.equal(f.commissionFromFormula(formula, inputs({ production: 8000 })), 1600);
  for (const [op, left, right, holds] of [['gt', 5, 5, false], ['gt', 6, 5, true], ['lte', 5, 5, true], ['lt', 5, 5, false], ['lt', 4, 5, true]]) {
    const one = { steps: [{ id: 's1', label: '', kind: 'condition', left: num(left), op, right: num(right), then: num(1), otherwise: num(2) }] };
    assert.equal(f.commissionFromFormula(one, inputs()), holds ? 1 : 2, `${left} ${op} ${right}`);
  }
});

test('templates: the "excess" template pays exactly what the fixed excess mode pays', () => {
  const template = f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build();
  assert.deepEqual(f.validateCommissionFormula(template), []);
  for (const [production, salary, vr, va, percentage] of [[22728.28, 3452, 699.6, 249, 25], [3772, 2000, 620, 320, 25], [10000, 2000, 500, 0, 30], [0, 0, 0, 0, 25]]) {
    const fixed = rules.calculateCommissionValue({ mode: 'excess', totalServices: production, percentage, baseSalary: salary, vrAllowance: vr, vaAllowance: va });
    const custom = rules.calculateCommissionValue({ mode: 'custom', formula: template, totalServices: production, percentage, baseSalary: salary, vrAllowance: vr, vaAllowance: va });
    assert.equal(custom, fixed, `production ${production}`);
  }
  for (const item of f.FORMULA_TEMPLATES) assert.deepEqual(f.validateCommissionFormula(item.build()), [], item.id);
});

test('the folha: custom reads the month data, the technician values, and still honours the minimum and the cap', () => {
  const formula = { steps: [{ id: 's1', label: '', kind: 'multiply', of: src('days'), by: src('rate') }] };
  const input = { mode: 'custom', formula, totalServices: 0, percentage: 25, baseSalary: 2000, vrAllowance: 0, vaAllowance: 0, daysWorked: 20, rate: 100 };
  assert.equal(rules.calculateCommissionValue(input), 2000);
  assert.equal(rules.calculateCommissionValue({ ...input, maximum: 1500 }), 1500);
  assert.equal(rules.calculateCommissionValue({ ...input, daysWorked: 5, minimum: 800 }), 800);
  assert.equal(rules.calculateCommissionValue({ ...input, formula: null }), 0);
  assert.equal(rules.calculateCommissionValue({ ...input, formula: { steps: [] } }), 0);
});

test('the trace: every step comes with its name, value and a sentence with the numbers in it', () => {
  const formula = f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build();
  const result = f.evaluateCommissionFormula(formula, inputs());
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[0].label, 'Parte da produção');
  assert.equal(result.steps[0].value, 3000);
  assert.match(result.steps[0].text, /^Percentual do técnico \(30%\) de Produção do mês \(R\$\s10\.000,00\)$/);
  assert.match(result.steps[1].text, /Salário base/);
  assert.equal(f.stepName({ id: 's1', label: '', kind: 'percent' }, 0), 'Porcentagem (etapa 1)');
});

test('validation: names the step that is wrong, in words', () => {
  assert.deepEqual(f.validateCommissionFormula({ steps: [] }), ['Monte o cálculo com pelo menos uma etapa.']);
  const forward = { steps: [{ id: 's1', label: '', kind: 'at_least', of: step('s2'), limit: num(0) }, { id: 's2', label: '', kind: 'percent', of: src('production'), percent: num(10) }] };
  assert.match(f.validateCommissionFormula(forward)[0], /Etapa 1.*não existe antes/);
  const hundred = { steps: [{ id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(120) }] };
  assert.match(f.validateCommissionFormula(hundred)[0], /entre 0 e 100/);
  const noItems = { steps: [{ id: 's1', label: '', kind: 'subtract', of: src('production'), items: [] }] };
  assert.match(f.validateCommissionFormula(noItems)[0], /escolha o que tirar/);
  const unordered = { steps: [{ id: 's1', label: '', kind: 'tiers', measure: src('services'), style: 'reached', pays: 'amount', tiers: [{ from: 40, value: 1 }, { from: 30, value: 2 }] }] };
  assert.match(f.validateCommissionFormula(unordered)[0], /ordem crescente/);
  const duplicated = { steps: [{ id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(10) }, { id: 's1', label: '', kind: 'percent', of: src('production'), percent: num(10) }] };
  assert.match(f.validateCommissionFormula(duplicated)[0], /se repete/);
  const many = { steps: Array.from({ length: 13 }, (_, i) => ({ id: `s${i + 1}`, label: '', kind: 'percent', of: src('production'), percent: num(1) })) };
  assert.match(f.validateCommissionFormula(many)[0], /no máximo 12/);
});

test('reading a stored formula: object or JSON text, and anything malformed is refused whole', () => {
  const template = f.FORMULA_TEMPLATES.find((item) => item.id === 'tiers_os').build();
  assert.deepEqual(f.normalizeCommissionFormula(JSON.parse(JSON.stringify(template))), template);
  assert.deepEqual(f.normalizeCommissionFormula(JSON.stringify(template)), template);
  assert.equal(f.normalizeCommissionFormula(null), null);
  assert.equal(f.normalizeCommissionFormula('not json'), null);
  assert.equal(f.normalizeCommissionFormula({ steps: [{ id: 's1', kind: 'percent', of: { kind: 'source', source: 'nope' }, percent: num(1) }] }), null);
  assert.equal(f.normalizeCommissionFormula({ steps: [{ id: 's1', kind: 'eval', code: 'process.exit()' }] }), null);
});

test('formulaUsesSource and rateKindsOf: the technician screen asks only for the values the steps read', () => {
  const own = f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build();
  assert.equal(f.formulaUsesSource(own, 'percentage'), true);
  assert.equal(f.formulaUsesSource(own, 'rate'), false);
  assert.deepEqual(rules.rateKindsOf('custom', own), ['percent']);
  const perHour = { steps: [{ id: 's1', label: '', kind: 'multiply', of: src('hours'), by: src('rate') }] };
  assert.deepEqual(rules.rateKindsOf('custom', perHour), ['amount']);
  assert.deepEqual(rules.rateKindsOf('custom', { steps: [{ id: 's1', label: '', kind: 'multiply', of: src('hours'), by: num(10) }] }), []);
  assert.deepEqual(rules.rateKindsOf('per_hour'), ['hour']);
  assert.deepEqual(rules.rateKindsOf('none'), []);
});

test('settings: custom needs a complete formula; the other modes keep whatever was saved', () => {
  const defaults = settings.DEFAULT_ORGANIZATION_SETTINGS;
  const template = f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build();
  const ok = settings.parseOrganizationSettingsInput({ ...defaults, commissionMode: 'custom', commissionFormula: template });
  assert.ok(ok.settings);
  assert.deepEqual(ok.settings.commissionFormula, template);
  const empty = settings.parseOrganizationSettingsInput({ ...defaults, commissionMode: 'custom', commissionFormula: { steps: [] } });
  assert.match(empty.error, /Cálculo personalizado/);
  assert.ok(settings.parseOrganizationSettingsInput({ ...defaults, commissionMode: 'percentage', commissionFormula: { steps: [] } }).settings);
  assert.ok(settings.parseOrganizationSettingsInput({ ...defaults, commissionMode: 'custom', commissionFormula: 'broken' }).error);
  // Read from the database row (snake_case, jsonb already an object) and from the lenient reader.
  const row = settings.normalizeOrganizationSettings({ commission_mode: 'custom', commission_formula: JSON.parse(JSON.stringify(template)) });
  assert.equal(row.commissionMode, 'custom');
  assert.deepEqual(row.commissionFormula, template);
  assert.deepEqual(settings.normalizeOrganizationSettings({}).commissionFormula, { steps: [] });
  assert.deepEqual(settings.normalizeOrganizationSettings({ commission_formula: { steps: 'x' } }).commissionFormula, { steps: [] });
});

test('describeFormulaStep: the step in words, with no month numbers in it', () => {
  const excess = f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build();
  assert.equal(f.describeFormulaStep(excess, 0), 'Percentual do técnico de Produção do mês');
  assert.equal(f.describeFormulaStep(excess, 1), '“Parte da produção” − Salário base − VR − VA');
  const tiers = f.FORMULA_TEMPLATES.find((item) => item.id === 'tiers_os').build();
  assert.equal(f.describeFormulaStep(tiers, 0), 'Faixas de Número de OS: cada parte paga um valor por unidade');
  const goal = f.FORMULA_TEMPLATES.find((item) => item.id === 'goal').build();
  assert.match(f.describeFormulaStep(goal, 1), /^Se Produção do mês for maior ou igual a R\$\s8\.000,00, vale “Parte da produção”; senão, R\$\s0,00$/);
  const trace = f.evaluateCommissionFormula(tiers, inputs({ services: 42 }));
  assert.match(trace.steps[0].text, /Número de OS \(42 OS\): 40 OS × R\$\s20,00 \+ 2 OS × R\$\s30,00/);
});

test('withoutStep: removing a step leaves the ones that used it holding 0, never a dangling reference', () => {
  const excess = f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build();
  const trimmed = f.withoutStep(excess, 's1');
  assert.equal(trimmed.steps.length, 1);
  assert.deepEqual(f.validateCommissionFormula(trimmed), []);
  assert.deepEqual(trimmed.steps[0].of, { kind: 'number', value: 0 });
});
