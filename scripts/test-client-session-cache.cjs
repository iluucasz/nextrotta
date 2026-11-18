// Run with: node scripts/test-client-session-cache.cjs
// Screens ask "who is logged in?" every time they open. lib/client-auth.ts reuses a recent answer so moving
// between screens costs no request, but it must never remember a sign-out, never share state on the server,
// and must forget the answer when told to (logout).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);

const USER = { userId: 'u1', email: 'a@b.c', name: 'Ana', role: 'admin', organizationSlug: 'kappa' };

let calls = 0;
let answer;
let realNow = Date.now;
let clock = 1_000_000;

function load() {
  delete require.cache[require.resolve('../lib/client-auth.ts')];
  return require('../lib/client-auth.ts');
}

beforeEach(() => {
  calls = 0;
  answer = { ok: true, user: USER };
  clock = 1_000_000;
  Date.now = () => clock;
  globalThis.window = {};
  globalThis.fetch = async () => {
    calls += 1;
    if (!answer.ok) return { ok: false, headers: { get: () => '' } };
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ user: answer.user }) };
  };
});

test.after(() => {
  Date.now = realNow;
  delete globalThis.window;
});

test('a second screen opening right after reuses the answer without a request', async () => {
  const auth = load();
  assert.equal(auth.peekSessionUser(), null);
  assert.deepEqual(await auth.getSessionUser(), USER);
  assert.deepEqual(auth.peekSessionUser(), USER);
  assert.deepEqual(await auth.getSessionUser(), USER);
  assert.equal(calls, 1);
});

test('asking twice at the same moment shares one request', async () => {
  const auth = load();
  const [first, second] = await Promise.all([auth.getSessionUser(), auth.getSessionUser()]);
  assert.deepEqual(first, USER);
  assert.deepEqual(second, USER);
  assert.equal(calls, 1);
});

test('the answer expires after 30 seconds', async () => {
  const auth = load();
  await auth.getSessionUser();
  clock += 29_000;
  await auth.getSessionUser();
  assert.equal(calls, 1);
  clock += 2_000;
  assert.equal(auth.peekSessionUser(), null);
  await auth.getSessionUser();
  assert.equal(calls, 2);
});

test('a signed-out answer is never remembered', async () => {
  const auth = load();
  answer = { ok: false };
  assert.equal(await auth.getSessionUser(), null);
  assert.equal(auth.peekSessionUser(), null);
  answer = { ok: true, user: USER };
  assert.deepEqual(await auth.getSessionUser(), USER);
  assert.equal(calls, 2);
});

test('a failed request is not remembered and can be retried', async () => {
  const auth = load();
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('offline');
  };
  await assert.rejects(auth.getSessionUser(), /offline/);
  assert.equal(auth.peekSessionUser(), null);
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ user: USER }) };
  };
  assert.deepEqual(await auth.getSessionUser(), USER);
});

test('clearSessionCache forgets the answer (logout)', async () => {
  const auth = load();
  await auth.getSessionUser();
  auth.clearSessionCache();
  assert.equal(auth.peekSessionUser(), null);
  await auth.getSessionUser();
  assert.equal(calls, 2);
});

test('the server never keeps a session between requests', async () => {
  const auth = load();
  await auth.getSessionUser();
  delete globalThis.window;
  assert.equal(auth.peekSessionUser(), null);
});
