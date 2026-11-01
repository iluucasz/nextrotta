// Run with: node scripts/test-porto-status.cjs
// What the Config. Porto screen says (lib/porto-status.ts): where the robot stands, what is left to set up, what needs
// attention, when it runs next and how a run reads for a person.
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
const p = require('../lib/porto-status.ts');

// 31/10/2026 22:30 in Brasília (UTC-3)
const NOW = new Date('2026-11-01T01:30:00Z');
const times = { hours: '23:00', schedule: '03:00' };
const config = (patch = {}) => ({ cpf: '12345678901', has_password: true, automation_enabled: true, dry_run_only: false, last_login_test_ok: true, last_login_test_at: '2026-10-31T12:00:00Z', ...patch });
const log = (patch = {}) => ({ id: String(Math.random()), job_type: 'hours', started_at: '2026-10-31T01:00:00Z', finished_at: '2026-10-31T01:10:00Z', status: 'success', technicians_processed: 10, rows_written: 9, error_message: null, details: [], run_trigger: 'auto', ...patch });
const tech = (name, qra = 'T1') => ({ id: name, name, qra, status: 'active' });
const build = (patch = {}) => p.buildPortoStatus({ config: config(), logs: [log()], technicians: [tech('Ana'), tech('Beto')], times, now: NOW, ...patch });

test('the mode is read from the two flags, and "off" never turns straight into writing', () => {
  assert.equal(p.modeOf({ automation_enabled: false, dry_run_only: false }), 'off');
  assert.equal(p.modeOf({ automation_enabled: true, dry_run_only: true }), 'test');
  assert.equal(p.modeOf({ automation_enabled: true, dry_run_only: false }), 'live');
  assert.deepEqual(p.modeFlags('off'), { automation_enabled: false, dry_run_only: true });
  assert.deepEqual(p.modeFlags('test'), { automation_enabled: true, dry_run_only: true });
  assert.deepEqual(p.modeFlags('live'), { automation_enabled: true, dry_run_only: false });
});

test('the clock speaks in Brasília: today, yesterday, a date, and the next run', () => {
  assert.equal(p.whenLabel('2026-11-01T01:06:00Z', NOW), 'hoje às 22:06');
  assert.equal(p.whenLabel('2026-10-31T01:00:00Z', NOW), 'ontem às 22:00', '22:00 of the 30th in Brasília');
  assert.equal(p.whenLabel('2026-10-20T15:00:00Z', NOW), '20/10 às 12:00');
  assert.equal(p.whenLabel(null, NOW), 'nunca');
  assert.equal(p.nextRunLabel('23:00', NOW), 'hoje às 23:00');
  assert.equal(p.nextRunLabel('03:00', NOW), 'amanhã às 03:00');
});

test('no credentials: it is not set up, and the first step is the account', () => {
  const status = build({ config: config({ cpf: '', has_password: false }) });
  assert.equal(status.overall, 'not_set_up');
  assert.equal(status.steps.find((step) => step.current).key, 'account');
  assert.equal(status.setupComplete, false);
});

test('the account step is done only after a login that worked', () => {
  assert.equal(build({ config: config({ last_login_test_ok: null }) }).steps[0].done, false);
  assert.equal(build({ config: config({ last_login_test_ok: true }) }).steps[0].done, true);
  const refused = build({ config: config({ last_login_test_ok: false }) });
  assert.equal(refused.problems[0].key, 'login');
  assert.equal(refused.problems[0].action, 'account');
  assert.equal(refused.overall, 'attention');
});

test('off, test and live each say what they mean', () => {
  assert.equal(build({ config: config({ automation_enabled: false }) }).overall, 'off');
  assert.equal(build({ config: config({ dry_run_only: true }) }).overall, 'testing');
  const live = build();
  assert.equal(live.overall, 'ok');
  assert.equal(live.tone, 'success');
  assert.match(live.detail, /Última importação de horas ontem às 22:00: 10 técnicos · 9 dias gravados/);
  assert.equal(live.setupComplete, true);
});

test('next runs only exist while the robot is on', () => {
  assert.deepEqual(build().nextRun, { hours: 'hoje às 23:00', schedule: 'amanhã às 03:00' });
  assert.deepEqual(build({ config: config({ automation_enabled: false }) }).nextRun, { hours: null, schedule: null });
});

test('technicians without a QRA are a problem the person can fix from the screen', () => {
  const status = build({ technicians: [tech('Ana'), tech('Beto', null), tech('Caio', ''), { id: 'x', name: 'Inativo', qra: null, status: 'inactive' }] });
  assert.equal(status.technicians.active, 3);
  assert.equal(status.technicians.linked, 1);
  assert.deepEqual(status.technicians.unlinked.map((item) => item.name), ['Beto', 'Caio']);
  const problem = status.problems.find((item) => item.key === 'unlinked');
  assert.equal(problem.action, 'match');
  assert.match(problem.title, /2 técnicos sem QRA/);
  assert.equal(status.steps[1].done, false);
});

test('a failed or partial last run, or a changed portal, needs attention; an older good run does not hide it', () => {
  const failed = build({ logs: [log({ status: 'error', error_message: 'Senha recusada', started_at: '2026-10-31T10:00:00Z' }), log({ started_at: '2026-10-30T01:00:00Z' })] });
  assert.equal(failed.overall, 'attention');
  assert.equal(failed.problems[0].key, 'error-hours');
  assert.match(failed.problems[0].detail, /Senha recusada/);

  const partial = build({ logs: [log({ status: 'partial' })] });
  assert.equal(partial.problems[0].tone, 'warning');

  const layout = build({ logs: [log({ layout_suspect: true })] });
  assert.equal(layout.problems[0].key, 'layout-hours');
  assert.equal(layout.problems[0].tone, 'danger');
});

test('the server being down is said, and the problems come most serious first', () => {
  const status = build({ serverDown: true, technicians: [tech('Ana', null)], config: config({ last_login_test_ok: false }) });
  assert.deepEqual(status.problems.map((item) => item.tone), ['danger', 'warning', 'warning']);
  assert.equal(status.problems[0].key, 'login');
});

test('a robot that has not run for two days is a warning', () => {
  const status = build({ logs: [log({ started_at: '2026-10-25T01:00:00Z' })] });
  assert.ok(status.problems.some((item) => item.key === 'stale'));
  assert.ok(!build().problems.some((item) => item.key === 'stale'));
});

test('warnings found inside a run lead to the screen that fixes them', () => {
  const details = [{ qra: 'Q1', action: 'skipped_no_match' }, { qra: 'Q2', action: 'skipped_no_match' }, { qra: 'Q3', action: 'imported' }];
  const status = build({ logs: [log({ details })] });
  assert.match(status.problems.find((item) => item.key === 'no-match').title, /2 socorristas do Porto sem técnico/);
  assert.equal(p.countWarnings(details), 2);
});

test('a run reads for a person, not for a developer', () => {
  const ok = p.describeRun(log(), NOW);
  assert.deepEqual([ok.title, ok.kind, ok.label, ok.summary, ok.trigger], ['Horas trabalhadas', 'ok', 'Tudo certo', '10 técnicos · 9 dias gravados', 'Automática']);
  const schedule = p.describeRun(log({ job_type: 'schedule', rows_written: 1, technicians_processed: 1 }), NOW);
  assert.equal(schedule.summary, '1 técnico · 1 dia de escala');
  const failed = p.describeRun(log({ status: 'error', error_message: 'Falhou o login' }), NOW);
  assert.deepEqual([failed.kind, failed.summary, failed.problem], ['error', 'Falhou o login', true]);
  const dry = p.describeRun(log({ status: 'dry_run', run_trigger: 'manual' }), NOW);
  assert.deepEqual([dry.kind, dry.label, dry.trigger], ['test', 'Teste: nada foi gravado', 'Teste']);
  assert.equal(p.describeRun(log({ status: 'running' }), NOW).kind, 'running');
  assert.equal(p.describeRun(log({ details: [{ action: 'invalid_hours' }] }), NOW).label, 'Com avisos');
});

test('suggesting a technician by name only when it is unambiguous', () => {
  const list = [{ id: '1', name: 'João da Silva', qra: null }, { id: '2', name: 'Maria Souza', qra: null }, { id: '3', name: 'Maria Souza', qra: null }];
  assert.equal(p.suggestTechnician('JOAO DA SILVA', list).id, '1');
  assert.equal(p.suggestTechnician('Maria Souza', list), null, 'two with the same name: no guess');
  assert.equal(p.suggestTechnician('Pedro', list), null);
});
