// Run with: node scripts/test-vehicle-status.cjs
// What the Carros screen says first (the status card and the problem rows). Pure: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);

const status = require('../lib/vehicles/status.ts');

const TODAY = '2026-11-16';
const car = (extra = {}) => ({ id: 'c1', plate: 'ABC1D23', technicianId: 't1', licensingDue: null, insuranceDue: null, finesCheckStatus: null, finesCheckMessage: null, ...extra });
const fine = (extra = {}) => ({
  id: 'f1', plate: 'ABC1D23', technicianName: 'Ana Souza', driverStance: null, amount: 130.16,
  technicianId: 't1', notifiedAt: null, acknowledgedAt: null, indicatedAt: null, appealStatus: 'none', paidAt: null, indicationDeadline: '2027-01-10', ...extra,
});
const problems = (cars, fines = [], lookupEnabled = false) => status.fleetProblems({ cars, fines, today: TODAY, lookupEnabled });

test('a fleet with nothing wrong is "em dia" and has no move to make', () => {
  const cars = [car(), car({ id: 'c2', plate: 'XYZ9K88' })];
  assert.deepEqual(problems(cars), []);
  const card = status.carsStatus(cars, []);
  assert.deepEqual([card.tone, card.headline, card.cta], ['success', 'Frota em dia', null]);
  assert.match(card.detail, /2 carros, todos com técnico/);
});

test('no cars at all invites the first one', () => {
  const card = status.carsStatus([], []);
  assert.deepEqual([card.tone, card.cta.action], ['neutral', { kind: 'add-car' }]);
});

test('an expired paper is a danger, one about to expire a warning, and dangers come first', () => {
  const cars = [car({ id: 'a', plate: 'AAA1A11', insuranceDue: '2026-12-01' }), car({ id: 'b', plate: 'BBB2B22', licensingDue: '2026-10-31' })];
  const list = problems(cars);
  assert.deepEqual(list.map((problem) => [problem.tone, problem.title]), [
    ['danger', 'Licenciamento vencido: BBB-2B22'],
    ['warning', 'Seguro do AAA-1A11 vence em 01/12'],
  ]);
  const card = status.carsStatus(cars, list);
  assert.deepEqual([card.tone, card.headline, card.detail, card.cta], ['danger', '2 coisas precisam de você', '1 urgente e 1 para acompanhar.', null], 'the card sums up; the rows carry the buttons');
});

test('only warnings make a warning card', () => {
  const cars = [car({ licensingDue: '2026-12-05' })];
  const card = status.carsStatus(cars, problems(cars));
  assert.deepEqual([card.tone, card.headline], ['warning', '1 coisa precisa de você']);
});

test('a fine whose time to name the driver runs out is a problem, and a driver who disagrees too', () => {
  const fines = [
    fine({ id: 'late', plate: 'LAT1A11', indicationDeadline: '2026-11-10' }),
    fine({ id: 'soon', plate: 'SOO2B22', indicationDeadline: '2026-11-19' }),
    fine({ id: 'no', plate: 'NOO3C33', driverStance: 'disputes', technicianName: 'Bruno Lima' }),
    fine({ id: 'done', plate: 'DON4D44', indicationDeadline: '2026-11-10', indicatedAt: 'x', notifiedAt: 'x', acknowledgedAt: 'x', paidAt: '2026-11-12' }),
  ];
  assert.deepEqual(problems([], fines).map((problem) => [problem.tone, problem.title]), [
    ['danger', 'Prazo vencido para indicar o condutor da multa do LAT-1A11'],
    ['warning', 'Indique o condutor da multa do SOO-2B22 até 19/11'],
    ['warning', 'Bruno Lima não concorda com a multa do NOO-3C33'],
  ]);
});

test('the automatic lookup only complains about cars when the company has it on', () => {
  const cars = [car({ finesCheckStatus: 'missing_data', finesCheckMessage: 'Informe o Renavam e o estado (UF) do carro.' }), car({ id: 'c2', plate: 'XYZ9K88', finesCheckStatus: 'partial', finesCheckMessage: 'Só a PRF.' })];
  assert.deepEqual(problems(cars, [], false), []);
  const on = problems(cars, [], true);
  assert.deepEqual(on.map((problem) => [problem.title, problem.actionLabel]), [['ABC-1D23: Informe o Renavam e o estado (UF) do carro.', 'Completar']], 'a partial lookup is only information');
});

test('the Multas card: empty, resolved, open, and urgent', () => {
  assert.deepEqual([status.finesStatus([], TODAY, false).tone, status.finesStatus([], TODAY, false).cta.action], ['neutral', { kind: 'add-fine' }]);
  assert.match(status.finesStatus([], TODAY, true).detail, /consulta os carros toda semana/);

  const resolved = fine({ notifiedAt: 'x', acknowledgedAt: 'x', indicatedAt: 'x', paidAt: '2026-11-01' });
  const done = status.finesStatus([resolved], TODAY, false);
  assert.deepEqual([done.tone, done.headline, done.cta], ['success', 'Nenhuma multa em aberto', null]);

  const open = status.finesStatus([fine(), fine({ id: 'f2', amount: 88.38 }), resolved], TODAY, false);
  assert.deepEqual([open.tone, open.headline], ['warning', '2 multas em aberto']);
  assert.match(open.detail, /R\$\s218,54 a pagar em 2 multas/);

  const urgent = status.finesStatus([fine({ id: 'a', indicationDeadline: '2026-11-20' }), fine({ id: 'b', indicationDeadline: '2026-11-18' })], TODAY, false);
  assert.deepEqual([urgent.tone, urgent.headline, urgent.cta], ['danger', '2 multas com prazo para indicar o condutor acabando', null]);

  const late = status.finesStatus([fine({ indicationDeadline: '2026-11-01' })], TODAY, false);
  assert.equal(late.headline, '1 multa passou do prazo de indicar o condutor');

  const mixed = status.finesStatus([fine({ id: 'a', indicationDeadline: '2026-11-01' }), fine({ id: 'b', indicationDeadline: '2026-11-18' })], TODAY, false);
  assert.equal(mixed.headline, '1 multa passou do prazo de indicar o condutor', 'only the overdue ones are counted in the headline');
  assert.match(mixed.detail, /^1 está com o prazo acabando\. R\$/);
});

test('a fine already paid but not yet resolved does not count as owed', () => {
  const card = status.finesStatus([fine({ paidAt: '2026-11-10' })], TODAY, false);
  assert.equal(card.detail, 'Nada a pagar agora.');
});

test('the side panel lists the papers soonest first, expired ones included, and the last lookup is the latest', () => {
  const cars = [car({ id: 'a', plate: 'AAA1A11', licensingDue: '2027-03-01', insuranceDue: '2026-12-01' }), car({ id: 'b', plate: 'BBB2B22', licensingDue: '2026-10-01' })];
  assert.deepEqual(status.nextDues(cars, TODAY).map((item) => [item.plate, item.label, item.state]), [
    ['BBB2B22', 'Licenciamento', 'overdue'],
    ['AAA1A11', 'Seguro', 'soon'],
    ['AAA1A11', 'Licenciamento', 'ok'],
  ]);
  assert.equal(status.nextDues(cars, TODAY, 1).length, 1);
  assert.equal(status.lastLookup([{ finesCheckedAt: null }, { finesCheckedAt: '2026-11-10T10:00:00.000Z' }, { finesCheckedAt: '2026-11-12T10:00:00.000Z' }]), '2026-11-12T10:00:00.000Z');
  assert.equal(status.lastLookup([{ finesCheckedAt: null }]), null);
});

test('the automation says where the weekly lookup stands: not granted, not set up or on', () => {
  const lookup = (extra) => status.automationState({ enabled: true, configured: true, nextAutomatic: '2026-11-22', ...extra });
  assert.deepEqual([lookup({ enabled: false }).tone, lookup({ enabled: false }).headline], ['neutral', 'Consulta automática desligada']);
  assert.deepEqual([lookup({ configured: false }).tone, lookup({ configured: false }).headline], ['warning', 'Consulta automática ainda não configurada']);
  const on = lookup({});
  assert.deepEqual([on.tone, on.headline, on.detail], ['success', 'Verificação semanal ligada', 'Todo domingo, sozinha. Próxima: domingo, 22/11.']);
  assert.equal(lookup({ enabled: false, configured: false }).tone, 'neutral', 'not granted wins over everything');
});

test('a car says how its own lookup is doing', () => {
  const car = (extra) => ({ finesCheckStatus: null, finesCheckMessage: null, finesCheckedAt: null, ...extra });
  assert.equal(status.carLookupSituation(car({ finesCheckStatus: 'ok' }), false).text, 'Consulta automática desligada para a empresa.');
  assert.deepEqual(status.carLookupSituation(car({ finesCheckStatus: 'ok', finesCheckedAt: '2026-11-15T11:00:00.000Z' }), true), { tone: 'success', text: 'Consultado em 15/11. Sem pendência.' });
  assert.equal(status.carLookupSituation(car({ finesCheckStatus: 'missing_data', finesCheckMessage: 'Informe o Renavam.' }), true).text, 'Informe o Renavam.');
  assert.equal(status.carLookupSituation(car({ finesCheckStatus: 'error', finesCheckMessage: 'Detran fora do ar.' }), true).tone, 'danger');
  assert.equal(status.carLookupSituation(car({ finesCheckStatus: 'partial', finesCheckMessage: 'Só a PRF.', finesCheckedAt: '2026-11-15T11:00:00.000Z' }), true).text, 'Só a PRF. (15/11)');
  assert.equal(status.carLookupSituation(car(), true).tone, 'neutral');
  // Data that is missing is said at once, before any lookup ran.
  const noData = status.carLookupSituation(car({ renavam: null, state: null }), true);
  assert.deepEqual([noData.tone, /Falta o Renavam e o estado/.test(noData.text)], ['warning', true]);
  assert.match(status.carLookupSituation(car({ renavam: '12345678901', state: 'MS' }), true).text, /parece errado/);
  assert.equal(status.carLookupSituation(car({ renavam: '12345678900', state: 'MS' }), true).tone, 'neutral', 'good data and nothing looked up yet');
  assert.equal(status.carLookupSituation(car({ renavam: null, state: null }), false).tone, 'neutral', 'with the lookup off nobody is asked for data');
});
