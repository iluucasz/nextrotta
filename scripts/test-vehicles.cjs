// Run with: node scripts/test-vehicles.cjs
// The rules of the Carros app (lib/vehicles/rules.ts): plates, Renavam, chassis, due dates and the form parsing.
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
const rules = require('../lib/vehicles/rules.ts');

test('plates: normalized, old and Mercosul accepted, anything else refused', () => {
  assert.equal(rules.normalizePlate(' abc-1d23 '), 'ABC1D23');
  assert.ok(rules.isValidPlate('ABC1234'));
  assert.ok(rules.isValidPlate('ABC1D23'));
  assert.ok(!rules.isValidPlate('AB12345'));
  assert.ok(!rules.isValidPlate('ABCD123'));
  assert.ok(!rules.isValidPlate(''));
  assert.equal(rules.formatPlate('ABC1D23'), 'ABC-1D23');
});

test('due dates: none, ok, soon (inside 30 days, the limit day included) and overdue', () => {
  const today = '2026-11-16';
  assert.equal(rules.dueState(null, today), 'none');
  assert.equal(rules.dueState('2026-11-15', today), 'overdue');
  assert.equal(rules.dueState('2026-11-16', today), 'soon', 'due today is not overdue yet');
  assert.equal(rules.dueState('2026-12-16', today), 'soon');
  assert.equal(rules.dueState('2026-12-17', today), 'ok');
  assert.equal(rules.dueState('2027-03-01', today), 'ok');
});

test('a new car only needs a valid plate (the rest comes from the lookup) and what is sent is cleaned', () => {
  assert.match(rules.parseVehicleInput({ plate: 'xx', model: 'Strada' }).error, /Placa/);
  assert.deepEqual(rules.parseVehicleInput({ plate: 'abc1234' }).value, { plate: 'ABC1234' });
  assert.deepEqual(rules.parseVehicleInput({ plate: 'ABC1D23', model: '  ' }).value, { plate: 'ABC1D23', model: null });
  const ok = rules.parseVehicleInput({
    plate: 'abc-1d23', model: ' Strada ', brand: 'Fiat', year: '2023', odometer: '12.500', renavam: '123.456.789-01',
    chassis: '9bwzzz377vt004251', licensingDue: '2027-01-31', status: 'maintenance', color: '',
  });
  assert.deepEqual(ok.value, {
    plate: 'ABC1D23', model: 'Strada', brand: 'Fiat', year: 2023, odometer: 12500, renavam: '12345678901',
    chassis: '9BWZZZ377VT004251', licensingDue: '2027-01-31', status: 'maintenance', color: null,
  });
});

test('refuses what cannot be a car: year, km, Renavam, chassis, dates and status', () => {
  const base = { plate: 'ABC1234', model: 'Uno' };
  assert.match(rules.parseVehicleInput({ ...base, year: 1800 }).error, /Ano/);
  assert.match(rules.parseVehicleInput({ ...base, odometer: '-5' }).error, /Quilometragem/);
  assert.match(rules.parseVehicleInput({ ...base, renavam: '123' }).error, /Renavam/);
  assert.match(rules.parseVehicleInput({ ...base, chassis: 'ABC' }).error, /Chassi/);
  assert.match(rules.parseVehicleInput({ ...base, chassis: '9BWZZZ377VT00425O' }).error, /Chassi/, 'the letter O is not allowed');
  assert.match(rules.parseVehicleInput({ ...base, licensingDue: '31/01/2027' }).error, /licenciamento/);
  assert.match(rules.parseVehicleInput({ ...base, insuranceDue: '2027-13-40' }).error, /seguro/);
  assert.match(rules.parseVehicleInput({ ...base, status: 'sold' }).error, /Situação/);
});

test('an edit only checks and returns the fields that came', () => {
  assert.deepEqual(rules.parseVehicleInput({ odometer: '90000' }, true).value, { odometer: 90000 });
  assert.deepEqual(rules.parseVehicleInput({ renavam: '' }, true).value, { renavam: null });
  assert.match(rules.parseVehicleInput({ plate: 'zzz' }, true).error, /Placa/);
  assert.deepEqual(rules.parseVehicleInput({}, true).value, {});
});
