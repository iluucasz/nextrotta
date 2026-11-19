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

test('the automatic lookup only complains about cars when the company has it on, and reads what is missing from the car, not from an old result', () => {
  const data = (extra) => car({ renavam: '12345678900', state: 'MS', ...extra });
  const cars = [
    data({ id: 'a', plate: 'AAA1A11', renavam: null }),
    data({ id: 'b', plate: 'BBB2B22', state: null }),
    data({ id: 'c', plate: 'CCC3C33', renavam: '12345678901' }),
    // An old "missing data" mark on a car that has its data now is not a problem any more.
    data({ id: 'd', plate: 'DDD4D44', finesCheckStatus: 'missing_data', finesCheckMessage: 'Informe o Renavam.' }),
    data({ id: 'e', plate: 'EEE5E55', finesCheckStatus: 'partial', finesCheckMessage: 'Só a PRF.' }),
    data({ id: 'f', plate: 'FFF6F66', finesCheckStatus: 'error', finesCheckMessage: 'PRF: o órgão demorou para responder.' }),
  ];
  assert.deepEqual(problems(cars, [], false), [], 'lookup off: nothing to complain about');
  const on = problems(cars, [], true);
  assert.deepEqual(on.map((problem) => [problem.group, problem.title]), [
    ['lookup', '2 carros sem Renavam ou estado: a consulta automática não os alcança'],
    ['lookup', 'A placa ou o Renavam de CCC-3C33 parece errado: confira no documento do carro'],
    ['lookup', 'FFF-6F66: PRF: o órgão demorou para responder.'],
  ], 'the missing ones share one row; a partial lookup is only information');
  assert.deepEqual(on[0].cars.map((item) => item.id), ['a', 'b'], 'and the row lists its cars to open one by one');
  assert.deepEqual([on[0].actionLabel, on[0].action], ['Completar', { kind: 'car', carId: 'a' }]);
  assert.equal(problems([data({ id: 'x', plate: 'XXX9X99', renavam: null })], [], true)[0].title, 'XXX-9X99 está sem Renavam ou estado: a consulta automática não o alcança');
});

test('a car the agency refused is flagged as wrong data, with the reason on its own page', () => {
  const refused = car({ id: 'r', plate: 'RRR1R11', renavam: '12345678900', state: 'SP', finesCheckStatus: 'refused', finesCheckMessage: 'PRF: o órgão recusou os dados deste carro (Renavam incorreto).' });
  const list = problems([refused], [], true);
  assert.deepEqual(list.map((problem) => [problem.group, problem.title]), [['lookup', 'A placa ou o Renavam de RRR-1R11 parece errado: confira no documento do carro']]);
  const situation = status.carLookupSituation(refused, true);
  assert.deepEqual([situation.tone, situation.text], ['warning', 'PRF: o órgão recusou os dados deste carro (Renavam incorreto).']);
  assert.deepEqual(problems([refused], [], false), [], 'lookup off: nothing to complain about');
});

test('every problem belongs to a section of the Avisos tab', () => {
  const list = problems(
    [car({ licensingDue: '2026-10-01' }), car({ id: 'c2', plate: 'XYZ9K88', renavam: null, state: null })],
    [fine({ id: 'late', indicationDeadline: '2026-11-10' })],
    true,
  );
  assert.deepEqual([...new Set(list.map((problem) => problem.group))].sort(), ['deadlines', 'lookup', 'papers']);
  assert.deepEqual(Object.keys(status.PROBLEM_GROUP_LABEL).sort(), ['deadlines', 'lookup', 'papers']);
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
  // An old "missing data" mark does not outlive the data that was filled in.
  const stale = status.carLookupSituation(car({ renavam: '12345678900', state: 'MS', finesCheckStatus: 'missing_data', finesCheckMessage: 'Informe o Renavam.' }), true);
  assert.deepEqual([stale.tone, stale.text], ['neutral', 'Dados completos. O carro entra na próxima verificação.']);
  // Data that is missing is said at once, before any lookup ran.
  const noData = status.carLookupSituation(car({ renavam: null, state: null }), true);
  assert.deepEqual([noData.tone, /Falta o Renavam e o estado/.test(noData.text)], ['warning', true]);
  assert.match(status.carLookupSituation(car({ renavam: '12345678901', state: 'MS' }), true).text, /parece errado/);
  assert.equal(status.carLookupSituation(car({ renavam: '12345678900', state: 'MS' }), true).tone, 'neutral', 'good data and nothing looked up yet');
  assert.equal(status.carLookupSituation(car({ renavam: null, state: null }), false).tone, 'neutral', 'with the lookup off nobody is asked for data');
});

test('a car with a fine still open is flagged, red when the deadline to name the driver is near; resolved fines flag nothing', () => {
  const onCar = (vehicleId, extra = {}) => ({ vehicleId, technicianId: 't1', notifiedAt: null, acknowledgedAt: null, indicatedAt: null, appealStatus: 'none', paidAt: null, indicationDeadline: '2027-01-10', ...extra });
  const flagged = status.openFinesByCar(
    [
      onCar('a'),
      onCar('a', { indicationDeadline: '2026-11-18' }),
      onCar('b', { notifiedAt: '2026-10-30T12:00:00Z', acknowledgedAt: '2026-10-31T12:00:00Z', indicatedAt: '2026-11-01T12:00:00Z', paidAt: '2026-11-02T12:00:00Z' }),
      onCar('c', { appealStatus: 'won' }),
    ],
    TODAY,
  );
  assert.deepEqual([...flagged.keys()], ['a'], 'only the car with open fines');
  assert.deepEqual(flagged.get('a'), { open: 2, urgent: true });
  assert.deepEqual(status.openFinesByCar([onCar('d')], TODAY).get('d'), { open: 1, urgent: false });
});

test('a lookup in words: what each agency said, and the agencies not set up yet are left out of the company\'s view', () => {
  const source = (extra = {}) => ({ label: 'Detran-SP', result: 'ok', found: 0, created: [], message: null, ...extra });
  assert.deepEqual(status.describeSource(source()), { tone: 'success', text: 'Consultou: nenhuma multa.' });
  assert.deepEqual(status.describeSource(source({ found: 2, created: [{ ait: 'A1', description: 'x', amount: 1 }] })), { tone: 'warning', text: 'Consultou: 2 multas, 1 nova.' });
  assert.deepEqual(status.describeSource(source({ found: 1 })), { tone: 'success', text: 'Consultou: 1 multa, nenhuma nova (já estavam registradas).' });
  assert.deepEqual(status.describeSource(source({ result: 'failed', message: 'Detran-SP: o órgão demorou.' })), { tone: 'danger', text: 'o órgão demorou.' });
  assert.equal(status.describeSource(source({ result: 'deferred' })).tone, 'neutral');

  const details = {
    cars: [
      { plate: 'AAA1A11', sources: [source(), source({ label: 'PRF', result: 'unavailable' })] },
      { plate: 'BBB2B22', sources: [source({ label: 'PRF', result: 'unavailable' })] },
      { plate: 'CCC3C33', sources: [source({ result: 'failed', message: 'x' }), source({ label: 'PRF', result: 'unavailable' })] },
      { plate: 'DDD4D44', sources: [source({ found: 1, created: [{ ait: 'A2', description: 'y', amount: 2 }] })] },
    ],
  };
  assert.deepEqual(status.visibleSources(details.cars[0]).map((item) => item.label), ['Detran-SP'], 'the PRF not set up is not shown');
  assert.deepEqual(status.carsWithoutLookup(details).map((item) => item.plate), ['BBB2B22'], 'a car no agency could be asked about');
  assert.deepEqual(status.runHighlights(details), { withNewFines: 1, withFailures: 1 });
});
