// Run with: node scripts/test-porto-breaks.cjs
// The partial indisponibilidades Porto lists on a day are kept as returned and only shown on the escala:
// they never change a row's status or times, and what is shown is exactly what Porto said.
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
const { normalizePortoBreaks, describePortoBreaks } = require('../lib/porto-breaks.ts');
const { getScheduleObservation, getScheduleBreaksLabel } = require('../lib/schedule-display.ts');

test('keeps the reason and times exactly as Porto returned them, in time order', () => {
  const result = normalizePortoBreaks([
    { start: '16:00', end: '20:00', reason: 'PARADA AUTORIZADA PELO GESTOR' },
    { start: '12:30', end: '13:30', reason: 'ALMOCO' },
  ]);
  assert.deepEqual(result, [
    { start: '12:30', end: '13:30', reason: 'ALMOCO' },
    { start: '16:00', end: '20:00', reason: 'PARADA AUTORIZADA PELO GESTOR' },
  ]);
});

test('pads single-digit hours, trims the reason and drops duplicates and malformed items', () => {
  const result = normalizePortoBreaks([
    { start: '8:00', end: '10:30', reason: '  ASSUNTO PESSOAL ' },
    { start: '08:00', end: '10:30', reason: 'ASSUNTO PESSOAL' },
    { start: 'x', end: '10:30', reason: 'BAD' },
    { start: '09:00', reason: 'NO END' },
    null,
    'text',
  ]);
  assert.deepEqual(result, [{ start: '08:00', end: '10:30', reason: 'ASSUNTO PESSOAL' }]);
});

test('anything that is not a list gives an empty list', () => {
  for (const value of [null, undefined, {}, 'ALMOCO', 3]) assert.deepEqual(normalizePortoBreaks(value), []);
  assert.equal(describePortoBreaks(null), '');
});

test('describes the day in one line, with several breaks', () => {
  assert.equal(
    describePortoBreaks([
      { start: '16:30', end: '17:30', reason: 'ALMOCO' },
      { start: '18:00', end: '20:00', reason: 'PARADA AUTORIZADA PELO GESTOR' },
    ]),
    'ALMOCO 16:30–17:30 · PARADA AUTORIZADA PELO GESTOR 18:00–20:00',
  );
  assert.equal(describePortoBreaks([{ start: '09:00', end: '10:00', reason: '' }]), 'Indisponível 09:00–10:00');
});

test('the records observation appends the breaks and leaves a row without them untouched', () => {
  const base = { id: '1', technician_id: 't', date: '2026-11-20', start_time: '08:00', end_time: '18:00', status: 'scheduled', created_at: '' };
  const withBreaks = { ...base, notes: 'Importado do Porto: escala normal', porto_breaks: [{ start: '12:30', end: '13:30', reason: 'ALMOCO' }] };
  assert.equal(getScheduleObservation(withBreaks), 'Importado do Porto: escala normal · ALMOCO 12:30–13:30');
  assert.equal(getScheduleObservation({ ...base, notes: 'Importado do Porto: escala normal', porto_breaks: null }), 'Importado do Porto: escala normal');
  assert.equal(getScheduleObservation({ ...base, notes: undefined }), '-');
  assert.equal(getScheduleBreaksLabel(undefined), '');
});

test('a manual apontamento keeps its own observation, without the Porto breaks', () => {
  const manual = {
    id: '2', technician_id: 't', date: '2026-11-20', start_time: '08:00', end_time: '18:00', status: 'scheduled', created_at: '',
    notes: 'Apontamento manual: folga; previsto=08:00-18:00; obs=Consulta',
    porto_breaks: [{ start: '12:30', end: '13:30', reason: 'ALMOCO' }],
  };
  assert.equal(getScheduleObservation(manual), 'Consulta');
});
