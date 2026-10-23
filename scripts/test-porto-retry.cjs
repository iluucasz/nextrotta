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

test('retryReason: what must never be repeated', () => {
  // A rejected login is already tried twice inside a run; more tries risk locking the account.
  assert.equal(retryReason({ status: 'error', error: 'Login no Porto falhou — verifique CPF e senha, ou o portal pode ter mudado. (url=...)' }), null);
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
