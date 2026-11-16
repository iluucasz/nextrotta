// Run with: node scripts/test-apps-catalog.cjs
// The Apps catalog (lib/apps/catalog.ts): category list and the search/category filter.
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
const { APP_CATALOG, appCategories, filterApps } = require('../lib/apps/catalog.ts');

const apps = [
  { id: 'a', name: 'Notificações no WhatsApp', summary: 'Avisos automáticos', category: 'Comunicação', status: 'available' },
  { id: 'b', name: 'Mercado Pago', summary: 'Receba pelas peças vendidas', category: 'Vendas', status: 'soon' },
  { id: 'c', name: 'Agenda do Google', summary: 'Escala no calendário', category: 'Comunicação', status: 'soon' },
];

test('the catalog starts empty and ids stay unique', () => {
  assert.ok(Array.isArray(APP_CATALOG));
  assert.equal(new Set(APP_CATALOG.map((app) => app.id)).size, APP_CATALOG.length);
});

test('categories keep the order of first appearance, without repeats', () => {
  assert.deepEqual(appCategories(apps), ['Comunicação', 'Vendas']);
  assert.deepEqual(appCategories([]), []);
});

test('search ignores accents and case and looks at name, summary and category', () => {
  assert.deepEqual(filterApps(apps, 'notificacoes', null).map((app) => app.id), ['a']);
  assert.deepEqual(filterApps(apps, 'PEÇAS', null).map((app) => app.id), ['b']);
  assert.deepEqual(filterApps(apps, 'comunicacao', null).map((app) => app.id), ['a', 'c']);
  assert.deepEqual(filterApps(apps, '   ', null).map((app) => app.id), ['a', 'b', 'c']);
});

test('the category filter combines with the search', () => {
  assert.deepEqual(filterApps(apps, '', 'Vendas').map((app) => app.id), ['b']);
  assert.deepEqual(filterApps(apps, 'agenda', 'Comunicação').map((app) => app.id), ['c']);
  assert.deepEqual(filterApps(apps, 'agenda', 'Vendas'), []);
});
