// Run with: node scripts/test-porto-service-search.cjs
// Uses the worker's installed Chromium. All portal requests are intercepted locally.
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
const { searchServicosByDateRange } = require('../lib/porto-integration/servicos.ts');
const { isPortoLayoutError } = require('../lib/porto-layout.ts');

const searchUrl = 'https://wwws.portoseguro.com.br/integracoesportaldeprestadores/click/ConServCons.xhtml?portal=2';
const form = `<form method="post" action="${searchUrl}">
  <select id="tipoData"><option value="1">Combinada com Cliente</option></select>
  <input name="dataInicialInputDate" value="01/10/2026">
  <input name="dataFinalInputDate" value="08/10/2026">
  <input type="submit" name="pesquisar" value="Pesquisar">
</form>`;
const results = `${form}<table><tr>
  <td><a onclick="changeUrlAW(this, 26, 1234567)">1234567/26</a></td>
  <!-- Nome Tratamento --><td>TECNICO TESTE</td>
  <td><span id="cap_dataProgramadaAtendimento">08/10/2026</span></td>
  <td><span id="cap_horaAtendimento">08:00</span></td>
  <td>Concluído com Sucesso</td>
</tr></table>`;
const range = { startDateKey: '2026-10-01', endDateKey: '2026-10-08' };

test('Porto search waits for results and reports HTTP failures', async (t) => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}) });
  t.after(() => browser.close());

  async function portal(postResponse) {
    const context = await browser.newContext();
    t.after(() => context.close());
    await context.route('**/*', async (route) => {
      const req = route.request();
      if (req.url().startsWith('https://prestador.portoseguro.com.br/pdp/iframe?')) {
        return route.fulfill({ contentType: 'text/html', body: `<iframe src="${searchUrl}"></iframe>` });
      }
      if (req.url().startsWith(searchUrl)) {
        if (req.method() === 'POST') return postResponse(route);
        return route.fulfill({ contentType: 'text/html', body: form });
      }
      return route.abort();
    });
    return context.newPage();
  }

  await t.test('a response after the former 20s limit must not become zero services', async () => {
    const page = await portal(async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 21000));
      await route.fulfill({ contentType: 'text/html', body: results });
    });
    const rows = await searchServicosByDateRange(page, range);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].numeroServico, '1234567');
    assert.equal(rows[0].dataProgramada, '08/10/2026');
    await page.close();
  });

  await t.test('an HTTP error must not become zero services or a layout warning', async () => {
    const page = await portal((route) => route.fulfill({ status: 503, contentType: 'text/html', body: form }));
    await assert.rejects(searchServicosByDateRange(page, range), (error) => {
      assert.match(error.message, /HTTP 503/);
      assert.equal(isPortoLayoutError(error), false);
      return true;
    });
    await page.close();
  });
});
