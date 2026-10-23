// Run with: node scripts/test-porto-queue-retry.cjs
// How an automatic run's retries behave in the multi-organization queue (worker/porto-queue.ts uses
// the same pieces): the Porto lock is taken per attempt, so a retry queues behind the organizations
// already waiting and the pause between attempts holds no browser slot. No browser, no database.
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
const { runWithRetries } = require('../worker/job-retry.ts');
const { setMaxBrowsers, waitForPortoLock, runWithPortoLock, portoLockInfo, PortoBusyError } = require('../worker/porto-lock.ts');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a retry does not jump the other organizations and keeps their data apart', async () => {
  setMaxBrowsers(1);
  const events = [];
  const results = {};

  // Each organization "imports" its own rows; org A fails on its first attempt.
  function job(org, outcomes) {
    let call = 0;
    return runWithRetries({
      delaysMs: [20, 20],
      sleep,
      run: () =>
        waitForPortoLock(org, `horas ${org}`, async () => {
          const outcome = outcomes[call++];
          events.push(`${org}${call}`);
          await sleep(10);
          if (outcome === 'error') return { status: 'error', error: 'A busca de serviços do Porto não terminou em tempo hábil.' };
          results[org] = { rows: `rows-of-${org}` };
          return { status: 'success' };
        }),
    });
  }

  const [a, b, c] = await Promise.all([job('A', ['error', 'ok']), job('B', ['ok']), job('C', ['ok'])]);
  assert.deepEqual(events, ['A1', 'B1', 'C1', 'A2'], 'B and C were already waiting: A\'s retry goes after them');
  assert.equal(a.attempts, 2);
  assert.equal(b.attempts, 1);
  assert.equal(c.attempts, 1);
  assert.deepEqual(results, { A: { rows: 'rows-of-A' }, B: { rows: 'rows-of-B' }, C: { rows: 'rows-of-C' } });
});

test('the pause between attempts holds neither the browser slot nor the organization lock', async () => {
  setMaxBrowsers(1);
  let adminRan = false;
  const retrying = runWithRetries({
    delaysMs: [60],
    sleep,
    run: (() => {
      let call = 0;
      return () => waitForPortoLock('D', 'horas D', async () => (++call === 1 ? { status: 'error', error: 'x' } : { status: 'success' }));
    })(),
  });
  await sleep(25); // first attempt over, D is in its pause
  // An admin action of the same organization runs during the pause (it would be refused if the lock were held).
  await runWithPortoLock('D', 'teste de login', async () => {
    adminRan = true;
  });
  assert.equal(adminRan, true);
  const { attempts } = await retrying;
  assert.equal(attempts, 2);
  await assert.rejects(
    (async () => {
      let release;
      const held = waitForPortoLock('E', 'longa', () => new Promise((resolve) => (release = resolve)));
      await sleep(5);
      try {
        await runWithPortoLock('E', 'outra', async () => undefined);
      } finally {
        release();
        await held;
      }
    })(),
    PortoBusyError,
  );
});

test('organizations waiting for a browser are not "running", so the stuck-run watchdog ignores them', async () => {
  setMaxBrowsers(2);
  const releases = {};
  const hold = (org) => waitForPortoLock(org, `horas ${org}`, () => new Promise((resolve) => (releases[org] = resolve)));
  const [a, b, c] = [hold('F1'), hold('F2'), hold('F3')]; // 3 organizations, 2 browsers
  await sleep(10);
  const info = Object.fromEntries(portoLockInfo().map((item) => [item.organizationId, item]));
  assert.equal(info.F1.running, true);
  assert.equal(info.F2.running, true);
  assert.equal(info.F3.running, false, 'F3 holds its own lock but is still queued');
  assert.equal(info.F3.heldForMs, 0, 'a queued run never accumulates "held for" time');
  releases.F1();
  await a;
  await sleep(10);
  const after = Object.fromEntries(portoLockInfo().map((item) => [item.organizationId, item]));
  assert.equal(after.F3.running, true, 'it starts running once a slot frees');
  releases.F2();
  releases.F3();
  await Promise.all([b, c]);
  assert.deepEqual(portoLockInfo().filter((item) => item.organizationId.startsWith('F')), []);
});
