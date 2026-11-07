// Run with: node scripts/test-porto-retry.cjs
// Pure logic of the unattended-run retry (worker/job-retry.ts) — no browser, no database, no waiting.
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
const { retryReason, runWithRetries, AUTO_RETRY_DELAYS_MS } = require('../worker/job-retry.ts');

test('retryReason: what is worth another attempt', () => {
  assert.match(retryReason({ status: 'error', error: 'Não foi possível abrir a página de login do Porto.' }), /página de login/);
  assert.match(retryReason({ status: 'error', error: 'Erro inesperado ao importar horas do Porto: A busca de serviços do Porto não terminou em tempo hábil.' }), /busca/);
  assert.ok(retryReason({ status: 'error' }), 'an error with no detail is still retried');
  assert.ok(retryReason({ status: 'success', layout_suspect: true }));
  assert.ok(retryReason({ status: 'partial', layout_suspect: true }));
  assert.match(retryReason({ status: 'partial', summary: { service_detail_failed: 2 } }), /2 serviço/);
});

const REJECTED = 'O Porto recusou o login desta vez. Pode ser uma instabilidade do portal: o robô tenta de novo sozinho. Se continuar, confira o CPF e a senha em “Alterar”. (url=...)';

test('retryReason: a rejected login is repeated only when the credentials worked recently', () => {
  assert.equal(retryReason({ status: 'error', error: REJECTED }), null);
  assert.ok(retryReason({ status: 'error', error: REJECTED }, { retryLoginRejection: true }));
  // The wording stored before 07/11/2026 is the same situation.
  const old = 'O Porto não aceitou o CPF ou a senha. Se você trocou a senha no Portal do Prestador, atualize aqui em “Alterar”. (url=...)';
  assert.ok(retryReason({ status: 'error', error: old }, { retryLoginRejection: true }));
  // Expired password, block and missing QRA never repeat, even with the flag on.
  const M = require('../lib/porto-login-errors.ts').PORTO_LOGIN_MESSAGES;
  for (const reason of ['password_expired', 'blocked', 'no_qra', 'session_not_opened', 'no_confirmation']) {
    assert.equal(retryReason({ status: 'error', error: `${M[reason]} (url=x)` }, { retryLoginRejection: true }), null, reason);
  }
});

test('loginRejectionLooksTransient: needs a login that worked after the credentials were saved, within 48 h', () => {
  const { loginRejectionLooksTransient } = require('../worker/job-retry.ts');
  const now = Date.parse('2026-11-06T23:00:00Z');
  const hoursAgo = (hours) => new Date(now - hours * 3600_000).toISOString();
  assert.equal(loginRejectionLooksTransient({ lastWorkingLoginAt: hoursAgo(3), credentialsSavedAt: hoursAgo(10), now }), true);
  assert.equal(loginRejectionLooksTransient({ lastWorkingLoginAt: hoursAgo(3), credentialsSavedAt: null, now }), true);
  assert.equal(loginRejectionLooksTransient({ lastWorkingLoginAt: null, credentialsSavedAt: hoursAgo(10), now }), false);
  assert.equal(loginRejectionLooksTransient({ lastWorkingLoginAt: hoursAgo(49), credentialsSavedAt: hoursAgo(80), now }), false);
  // The password was saved again after the last working login: that proof is about the old password.
  assert.equal(loginRejectionLooksTransient({ lastWorkingLoginAt: hoursAgo(10), credentialsSavedAt: hoursAgo(3), now }), false);
});

test('runWithRetries: a hiccup rejection waits 15, 20 and 30 minutes, then gives up with the last result', async () => {
  const { LOGIN_REJECTION_RETRY_DELAYS_MS } = require('../worker/job-retry.ts');
  assert.deepEqual(LOGIN_REJECTION_RETRY_DELAYS_MS, [15 * 60_000, 20 * 60_000, 30 * 60_000]);
  const rejected = { status: 'error', error: REJECTED };
  const recovered = scripted([rejected, rejected, { status: 'success' }]);
  const slept = [];
  const first = await runWithRetries({ run: recovered.run, retryLoginRejection: true, sleep: async (ms) => void slept.push(ms) });
  assert.equal(first.result.status, 'success');
  assert.equal(first.attempts, 3);
  assert.deepEqual(slept, [15 * 60_000, 20 * 60_000]);

  const persistent = scripted([rejected, rejected, rejected, rejected, rejected]);
  const sleptAll = [];
  const retries = [];
  const last = await runWithRetries({ run: persistent.run, retryLoginRejection: true, sleep: async (ms) => void sleptAll.push(ms), onRetry: (info) => retries.push([info.attempt, info.maxAttempts]) });
  assert.equal(last.attempts, 4);
  assert.equal(persistent.calls.length, 4);
  assert.deepEqual(sleptAll, [15 * 60_000, 20 * 60_000, 30 * 60_000]);
  assert.deepEqual(retries, [[1, 4], [2, 4], [3, 4]]);

  // Without the proof, a rejected login stops at once.
  const unproven = scripted([rejected]);
  const none = await runWithRetries({ run: unproven.run, sleep: async () => assert.fail('must not wait') });
  assert.equal(none.attempts, 1);
});

test('retryReason: what must never be repeated', () => {
  // A rejected login is already tried twice inside a run; more tries risk locking the account.
  assert.equal(retryReason({ status: 'error', error: 'Login no Porto falhou — verifique CPF e senha, ou o portal pode ter mudado. (url=...)' }), null);
  assert.equal(retryReason({ status: 'error', error: 'O Porto não aceitou o CPF ou a senha. Se você trocou a senha no Portal do Prestador, atualize aqui em “Alterar”. (url=...)' }), null);
  assert.equal(retryReason({ status: 'error', error: 'Credenciais não configuradas.' }), null);
  assert.equal(retryReason({ status: 'skipped', error: 'Automação desligada.' }), null);
  assert.equal(retryReason({ status: 'dry_run', layout_suspect: true }), null);
  assert.equal(retryReason({ status: 'success', summary: { imported: 3, invalid_hours: 1, skipped_no_match: 2 } }), null);
  assert.equal(retryReason({ status: 'partial', summary: { no_services: 3 } }), null);
});

function scripted(outcomes) {
  const calls = [];
  const run = async () => {
    const outcome = outcomes[calls.length];
    calls.push(outcome);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { run, calls };
}

test('runWithRetries: succeeds on a later attempt and waits the configured delays', async () => {
  const { run, calls } = scripted([
    { status: 'error', error: 'Não foi possível abrir a página de login do Porto.' },
    { status: 'error', error: 'Erro inesperado ao importar horas do Porto: x' },
    { status: 'success', rows_written: 6 },
  ]);
  const slept = [];
  const retries = [];
  const { result, attempts } = await runWithRetries({ run, sleep: async (ms) => void slept.push(ms), onRetry: (info) => retries.push(info) });
  assert.equal(result.status, 'success');
  assert.equal(attempts, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(slept, AUTO_RETRY_DELAYS_MS);
  assert.deepEqual(retries.map((info) => [info.attempt, info.maxAttempts]), [[1, 3], [2, 3]]);
});

test('runWithRetries: a final result is returned as is after the last attempt', async () => {
  const { run, calls } = scripted([
    { status: 'error', error: 'timeout 1' },
    { status: 'error', error: 'timeout 2' },
    { status: 'error', error: 'timeout 3' },
  ]);
  const { result, attempts } = await runWithRetries({ run, sleep: async () => {} });
  assert.equal(result.error, 'timeout 3');
  assert.equal(attempts, 3);
  assert.equal(calls.length, 3);
});

test('runWithRetries: no retry when the first result is already final', async () => {
  const { run, calls } = scripted([{ status: 'error', error: 'Login no Porto falhou — verifique CPF e senha' }]);
  const { attempts } = await runWithRetries({ run, sleep: async () => assert.fail('must not wait') });
  assert.equal(attempts, 1);
  assert.equal(calls.length, 1);
});

test('runWithRetries: an exception (database blip) is retried, and rethrown when it persists', async () => {
  const recovered = scripted([new Error('NeonDbError: fetch failed'), { status: 'success' }]);
  const first = await runWithRetries({ run: recovered.run, sleep: async () => {} });
  assert.equal(first.result.status, 'success');
  assert.equal(first.attempts, 2);

  const broken = scripted([new Error('a'), new Error('b'), new Error('c')]);
  await assert.rejects(runWithRetries({ run: broken.run, sleep: async () => {} }), /^Error: c$/);
  assert.equal(broken.calls.length, 3);
});
