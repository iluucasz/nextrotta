// Run with: node scripts/test-vehicle-fines.cjs
// The pure rules of the fines of the Carros app (no database): the stage of a fine, the deadline to name the driver,
// who was driving, the form's parsing and the technician's answer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);

const rules = require('../lib/vehicles/fines-rules.ts');

const base = {
  technicianId: 't1',
  notifiedAt: null,
  acknowledgedAt: null,
  indicatedAt: null,
  appealStatus: 'none',
  paidAt: null,
  indicationDeadline: '2026-12-10',
};

test('a fine goes through its stages in the order the work is done', () => {
  assert.equal(rules.fineStage({ ...base, technicianId: null }), 'to_identify');
  assert.equal(rules.fineStage(base), 'to_notify');
  assert.equal(rules.fineStage({ ...base, notifiedAt: 'x' }), 'awaiting_ack');
  assert.equal(rules.fineStage({ ...base, notifiedAt: 'x', acknowledgedAt: 'x' }), 'to_indicate');
  assert.equal(rules.fineStage({ ...base, notifiedAt: 'x', acknowledgedAt: 'x', indicatedAt: 'x' }), 'to_pay');
  assert.equal(rules.fineStage({ ...base, notifiedAt: 'x', acknowledgedAt: 'x', indicatedAt: 'x', paidAt: '2026-12-01' }), 'resolved');
});

test('an appeal in progress holds the payment; a lost one goes back to paying; a won one resolves the fine', () => {
  const done = { ...base, notifiedAt: 'x', acknowledgedAt: 'x', indicatedAt: 'x' };
  assert.equal(rules.fineStage({ ...done, appealStatus: 'planned' }), 'appeal');
  assert.equal(rules.fineStage({ ...done, appealStatus: 'filed' }), 'appeal');
  assert.equal(rules.fineStage({ ...done, appealStatus: 'lost' }), 'to_pay');
  assert.equal(rules.fineStage({ ...base, appealStatus: 'won' }), 'resolved', 'a won appeal resolves the fine at any point');
});

test('the deadline to name the driver is only watched while the driver is not named', () => {
  assert.equal(rules.indicationState(base, '2026-11-01'), 'ok');
  assert.equal(rules.indicationState(base, '2026-12-06'), 'soon');
  assert.equal(rules.indicationState(base, '2026-12-11'), 'overdue');
  assert.equal(rules.indicationState({ ...base, indicatedAt: 'x' }, '2026-12-11'), 'none');
  assert.equal(rules.indicationState({ ...base, appealStatus: 'won' }, '2026-12-11'), 'none');
  assert.equal(rules.indicationState({ ...base, indicationDeadline: null }, '2026-12-11'), 'none');
});

test('who was driving comes from the car history at the moment of the infraction', () => {
  const history = [
    { technicianId: 'ana', assignedAt: '2026-01-01T12:00:00.000Z', releasedAt: '2026-06-01T12:00:00.000Z' },
    { technicianId: 'bruno', assignedAt: '2026-06-01T12:00:00.000Z', releasedAt: null },
  ];
  assert.equal(rules.suggestDriver(history, '2026-03-10T15:00:00.000Z'), 'ana');
  assert.equal(rules.suggestDriver(history, '2026-06-01T12:00:00.000Z'), 'bruno', 'the hand-over instant belongs to the one who took it');
  assert.equal(rules.suggestDriver(history, '2026-09-10T15:00:00.000Z'), 'bruno', 'an open stretch lasts until today');
  assert.equal(rules.suggestDriver(history, '2025-12-31T23:00:00.000Z'), null, 'nobody had the car yet');
  assert.equal(rules.suggestDriver(history, 'not a date'), null);
});

test('the summary counts what is open, what is urgent and what is left to pay', () => {
  const fines = [
    { ...base, amount: 130.16 },
    { ...base, amount: 88.38, notifiedAt: 'x', acknowledgedAt: 'x', indicatedAt: 'x', paidAt: '2026-11-01' },
    { ...base, amount: 200, appealStatus: 'won' },
    { ...base, amount: 50, indicationDeadline: '2026-11-17' },
  ];
  assert.deepEqual(rules.summarizeFines(fines, '2026-11-16'), { open: 2, urgent: 1, toPay: 2, toPayAmount: 180.16 });
});

test('the infraction moment is read as Brasília time', () => {
  assert.equal(rules.parseInfractionMoment('2026-11-16T14:30'), '2026-11-16T17:30:00.000Z');
  assert.equal(rules.parseInfractionMoment('2026-11-16T14:30:00.000Z'), '2026-11-16T14:30:00.000Z');
  assert.equal(rules.parseInfractionMoment(''), null);
  assert.equal(rules.parseInfractionMoment('amanhã'), null);
});

test('the amount accepts Brazilian and plain notation', () => {
  assert.equal(rules.parseAmount('130,16'), 130.16);
  assert.equal(rules.parseAmount('1.234,56'), 1234.56);
  assert.equal(rules.parseAmount('R$ 88,38'), 88.38);
  assert.equal(rules.parseAmount('130.16'), 130.16);
  assert.equal(rules.parseAmount('-5'), null);
  assert.equal(rules.parseAmount('abc'), null);
  assert.equal(rules.parseAmount(''), null);
});

test('a new fine needs the car, the moment, the infraction and the amount', () => {
  const ok = { vehicleId: 'v1', infractionAt: '2026-11-16T14:30', description: 'Excesso de velocidade', amount: '130,16' };
  assert.equal('value' in rules.parseFineInput(ok), true);
  for (const missing of ['vehicleId', 'infractionAt', 'description', 'amount']) {
    const { [missing]: _removed, ...rest } = ok;
    assert.equal('error' in rules.parseFineInput(rest), true, `${missing} is required`);
  }
  assert.equal('error' in rules.parseFineInput({ ...ok, points: '25' }), true);
  assert.equal('error' in rules.parseFineInput({ ...ok, receivedOn: '31/12/2026' }), true);
  assert.equal('error' in rules.parseFineInput({ ...ok, appealStatus: 'maybe' }), true);
});

test('the deadline defaults to 30 days after the notification, unless one was written', () => {
  const ok = { vehicleId: 'v1', infractionAt: '2026-11-16T14:30', description: 'x', amount: '10', receivedOn: '2026-11-20' };
  assert.equal(rules.parseFineInput(ok).value.indicationDeadline, '2026-12-20');
  assert.equal(rules.parseFineInput({ ...ok, indicationDeadline: '2026-12-05' }).value.indicationDeadline, '2026-12-05');
  assert.equal(rules.parseFineInput({ ...ok, receivedOn: '' }).value.indicationDeadline, undefined);
});

test('a step (partial edit) only checks what came', () => {
  assert.deepEqual(rules.parseFineInput({ indicated: true }, true).value, { indicated: true });
  assert.deepEqual(rules.parseFineInput({ paid: true, paidOn: '2026-11-10' }, true).value, { paid: true, paidOn: '2026-11-10' });
  assert.deepEqual(rules.parseFineInput({ aitNumber: ' ab123 ' }, true).value, { aitNumber: 'AB123' });
  assert.equal('error' in rules.parseFineInput({ amount: 'x' }, true), true);
});

test('the technician agrees, or disputes and says why', () => {
  assert.deepEqual(rules.parseDriverResponse({ stance: 'agrees' }).value, { stance: 'agrees', note: null });
  assert.equal('error' in rules.parseDriverResponse({ stance: 'disputes' }), true);
  assert.equal('error' in rules.parseDriverResponse({ stance: 'disputes', note: 'ab' }), true);
  assert.deepEqual(rules.parseDriverResponse({ stance: 'disputes', note: 'Eu estava de folga' }).value, { stance: 'disputes', note: 'Eu estava de folga' });
  assert.equal('error' in rules.parseDriverResponse({ stance: 'maybe' }), true);
});

test('the reminder to look up the fines is once per week (the Monday of the week)', () => {
  assert.equal(rules.weekStart('2026-11-16'), '2026-11-16'); // a Monday
  assert.equal(rules.weekStart('2026-11-22'), '2026-11-16'); // the Sunday before the next Monday
  assert.equal(rules.weekStart('2026-11-23'), '2026-11-23');
  assert.equal(rules.weekStart('2026-11-18'), '2026-11-16');
});
