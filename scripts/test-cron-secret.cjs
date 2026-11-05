// Run with: node scripts/test-cron-secret.cjs
// Who may call the scheduled routes (Vercel Cron): only a request with the exact CRON_SECRET; no secret set closes the route.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
const { isCronAuthorized } = require('../lib/cron-secret.ts');

const SECRET = 'a-long-random-secret-123456';

test('only the exact bearer secret passes', () => {
  assert.equal(isCronAuthorized(`Bearer ${SECRET}`, SECRET), true);
  assert.equal(isCronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
  assert.equal(isCronAuthorized(`bearer ${SECRET}`, SECRET), false);
  assert.equal(isCronAuthorized(SECRET, SECRET), false);
  assert.equal(isCronAuthorized('', SECRET), false);
  assert.equal(isCronAuthorized(null, SECRET), false);
});

test('no secret, or a weak one, authorizes nothing (the route stays closed)', () => {
  assert.equal(isCronAuthorized('Bearer undefined', undefined), false);
  assert.equal(isCronAuthorized('Bearer ', ''), false);
  assert.equal(isCronAuthorized('Bearer short', 'short'), false);
});
