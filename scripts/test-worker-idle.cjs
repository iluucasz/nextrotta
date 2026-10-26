// Run with: node scripts/test-worker-idle.cjs
// The worker lives on memory between its maintenance ticks so Neon can sleep (see worker/cached-reads.ts):
// the cache only goes back to the database after an invalidation and keeps serving the last value when
// the reload fails; notifications only touch the database when one of them is in its window.
// No database is reached: the DATABASE_URL below is never connected to.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost/none';
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
const { cached, invalidateCachedReads } = require('../worker/cached-reads.ts');
const { hasScheduledNotificationInWindow } = require('../lib/whatsapp/notifications.ts');
const { NOTIFICATION_TYPES } = require('../lib/whatsapp/notification-types.ts');

test('a cached read hits the database once until it is invalidated', async () => {
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await cached('a', load), 1);
  assert.equal(await cached('a', load), 1);
  assert.equal(await cached('a', load), 1);
  invalidateCachedReads();
  assert.equal(await cached('a', load), 2);
  assert.equal(await cached('a', load), 2);
});

test('a failed reload keeps serving the last known value, a first failure is thrown', async () => {
  await assert.rejects(cached('never-loaded', async () => { throw new Error('db down'); }), /db down/);
  assert.equal(await cached('b', async () => 'old'), 'old');
  invalidateCachedReads();
  assert.equal(await cached('b', async () => { throw new Error('quota'); }), 'old');
  assert.equal(await cached('b', async () => 'new'), 'new');
});

// 2026-10-26 is a Monday; Brasília is UTC-3, so 12:03Z is 09:03.
const at = (hhmmUtc) => new Date(`2026-10-26T${hhmmUtc}:00Z`);

function config(overrides = {}) {
  const notifications = {};
  for (const type of NOTIFICATION_TYPES) notifications[type] = { enabled: false, time: '08:00', dayOfMonth: 5, template: '' };
  return { enabled: true, notifications: { ...notifications, ...overrides } };
}

test('a notification is picked up only inside its window', () => {
  const cfg = config({ next_day_shift: { enabled: true, time: '09:00', dayOfMonth: 5, template: '' } });
  assert.equal(hasScheduledNotificationInWindow(cfg, 5, at('11:59')), false); // 08:59, before
  assert.equal(hasScheduledNotificationInWindow(cfg, 5, at('12:03')), true); // 09:03, first check
  assert.equal(hasScheduledNotificationInWindow(cfg, 5, at('12:07')), false); // 09:07, first check is over
  assert.equal(hasScheduledNotificationInWindow(cfg, 180, at('12:30')), true); // catch-up still open
  assert.equal(hasScheduledNotificationInWindow(cfg, 180, at('15:30')), false); // 12:30, closed
});

test('a disabled configuration or no enabled notification never touches the database', () => {
  const cfg = config({ next_day_shift: { enabled: true, time: '09:00', dayOfMonth: 5, template: '' } });
  assert.equal(hasScheduledNotificationInWindow({ ...cfg, enabled: false }, 180, at('12:03')), false);
  assert.equal(hasScheduledNotificationInWindow(config(), 180, at('12:03')), false);
});
