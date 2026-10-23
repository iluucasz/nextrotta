// Run with: node scripts/test-porto-login.cjs
// Opening the Porto login page, against a locally intercepted portal (no real request leaves).
// PW_CHANNEL=chrome uses the installed Chrome when the worker's Chromium isn't installed.
// Takes about a minute: it waits out the real 30s navigation limit twice.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { createRequire } = require('node:module');
const path = require('node:path');
const workerRequire = createRequire(path.resolve(__dirname, '../worker/package.json'));
const { chromium } = workerRequire('playwright-core');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { openLoginPage, PortoLoginError } = require('../lib/porto-integration/login.ts');

const loginUrl = 'https://prestador.portoseguro.com.br/portal/site/pdp/template.LOGIN/';

test('Porto login page', async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  t.after(() => browser.close());

  async function newPage(handler) {
    const context = await browser.newContext();
    t.after(() => context.close());
    await context.route('**/*', handler);
    return context.newPage();
  }

  await t.test('opens normally', async () => {
    const page = await newPage((route) => route.fulfill({ contentType: 'text/html', body: '<input id="cpf">' }));
    await openLoginPage(page);
    assert.equal(await page.locator('#cpf').isVisible(), true);
  });

  await t.test('goes on when the network never goes idle but the form is on screen', async () => {
    const page = await newPage((route) => {
      if (route.request().url().startsWith(loginUrl)) {
        return route.fulfill({ contentType: 'text/html', body: '<input id="cpf"><img src="https://prestador.portoseguro.com.br/never-answers.png">' });
      }
      // Deliberately left pending: the request never completes.
    });
    await openLoginPage(page);
    assert.equal(await page.locator('#cpf').isVisible(), true);
  });

  await t.test('still fails when the page does not open at all', async () => {
    const page = await newPage((route) => route.abort('connectionrefused'));
    await assert.rejects(openLoginPage(page), (error) => {
      assert.ok(error instanceof PortoLoginError);
      assert.match(error.message, /página de login/);
      return true;
    });
  });
});
