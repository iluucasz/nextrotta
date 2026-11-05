// Run with: node scripts/test-porto-recovery.cjs
// When a failed Porto import has to be redone (lib/porto-recovery.ts): pure, no browser or database.
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
const r = require('../lib/porto-recovery.ts');

// "Today" is 05/11 at noon in Brasília.
const NOW = new Date('2026-11-05T15:00:00Z');
const at = (day, hour = '23:00') => `${day}T${hour}:00Z`; // 20:00 Brasília = 23:00Z
const log = (job_type, status, started_at, patch = {}) => ({ job_type, status, started_at, error_message: status === 'error' ? 'Login no Porto falhou — x' : null, ...patch });
const find = (logs, patch = {}) => r.findPortoRecovery({ logs, now: NOW, live: true, loginFailed: false, loginOkAt: null, ...patch });

test('nothing to recover when the last runs worked, or only warned', () => {
  assert.equal(find([log('hours', 'success', at('2026-11-04')), log('schedule', 'success', at('2026-11-04'))]).state, 'none');
  assert.equal(find([log('hours', 'partial', at('2026-11-04'))]).state, 'none');
  assert.equal(find([]).state, 'none');
});

test('a failure of yesterday or today is recoverable; an older one is not', () => {
  assert.equal(find([log('hours', 'error', at('2026-11-04'))]).state, 'failed');
  assert.equal(find([log('hours', 'error', at('2026-11-05', '14:00'))]).state, 'failed');
  assert.equal(find([log('hours', 'error', at('2026-11-02'))]).state, 'none');
});

test('a later success recovers it', () => {
  assert.equal(find([log('hours', 'success', at('2026-11-05', '14:00')), log('hours', 'error', at('2026-11-04'))]).state, 'none');
});

test('only an import that writes for real, and only without a login problem', () => {
  assert.equal(find([log('hours', 'error', at('2026-11-04'))], { live: false }).state, 'none');
  assert.equal(find([log('hours', 'error', at('2026-11-04'))], { loginFailed: true }).state, 'none');
  assert.equal(find([log('hours', 'dry_run', at('2026-11-04')), log('hours', 'skipped', at('2026-11-05', '10:00'))]).state, 'none');
});

test('login fixed after the failure and nothing ran since: it starts on its own, hours first', () => {
  const logs = [log('hours', 'error', at('2026-11-04')), log('schedule', 'error', at('2026-11-04', '23:30'))];
  const found = find(logs, { loginOkAt: '2026-11-05T14:00:00Z' });
  assert.equal(found.state, 'auto');
  assert.deepEqual(found.jobs.map((job) => job.job), ['hours', 'schedule']);
  assert.equal(found.jobs[0].start, '2026-11-04');
  assert.equal(found.jobs[1].start, null, 'the escala is redone as a whole');
});

test('the days to redo come from the failed runs (range when the run recorded one)', () => {
  const found = find(
    [log('hours', 'error', at('2026-11-05', '14:00')), log('hours', 'error', at('2026-11-04'), { range_start: '2026-11-03', range_end: '2026-11-04' })],
    { loginOkAt: '2026-11-05T14:30:00Z' },
  );
  assert.equal(found.state, 'auto');
  assert.deepEqual([found.jobs[0].start, found.jobs[0].end], ['2026-11-03', '2026-11-05']);
  assert.equal(r.recoveryJobLabel(found.jobs[0]), 'as horas de 03/11 a 05/11');
  assert.equal(r.recoveryJobLabel({ job: 'hours', start: '2026-11-04', end: '2026-11-04', failedAt: '' }), 'as horas de 04/11');
  assert.equal(r.recoveryJobLabel({ job: 'schedule', start: null, end: null, failedAt: '' }), 'a escala');
});

test('while a recovery run is going it says running; a stuck one does not', () => {
  const failed = log('hours', 'error', at('2026-11-04'));
  assert.equal(find([log('hours', 'running', '2026-11-05T14:50:00Z'), failed], { loginOkAt: '2026-11-05T14:40:00Z' }).state, 'running');
  assert.equal(find([log('hours', 'running', '2026-11-05T09:00:00Z'), failed], { loginOkAt: '2026-11-05T08:00:00Z' }).state, 'failed', 'running for 6 hours is stuck');
});

test('the retry failed again: needs a person, and says to open a ticket', () => {
  const found = find(
    [log('hours', 'error', '2026-11-05T14:40:00Z', { error_message: 'Erro inesperado ao importar horas do Porto: frame.selectOption: Timeout 30000ms exceeded.' }), log('hours', 'error', at('2026-11-04'))],
    { loginOkAt: '2026-11-05T14:00:00Z' },
  );
  assert.equal(found.state, 'failed');
  assert.equal(found.retried, true);
  assert.equal(found.support, true);
  assert.doesNotMatch(found.message, /selectOption/);
});

test('the escala is still to do after the hours were recovered', () => {
  const found = find(
    [log('hours', 'success', '2026-11-05T14:40:00Z'), log('hours', 'error', at('2026-11-04')), log('schedule', 'error', at('2026-11-04', '23:30'))],
    { loginOkAt: '2026-11-05T14:00:00Z' },
  );
  assert.equal(found.state, 'auto');
  assert.deepEqual(found.jobs.map((job) => job.job), ['schedule']);
});

test('a failure the fixed password does not explain (login was fine before) waits for a person', () => {
  const found = find([log('hours', 'error', at('2026-11-04'), { error_message: 'Erro inesperado ao importar horas do Porto: frame.selectOption: Timeout 30000ms exceeded.' })], { loginOkAt: '2026-11-03T10:00:00Z' });
  assert.equal(found.state, 'failed');
  assert.equal(found.retried, false);
  assert.equal(found.support, true);
});
