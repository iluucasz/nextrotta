// Run with: node scripts/test-porto-technician-import.cjs
// Rules of "Importar do Porto" (technicians page): which socorristas become technicians and how.
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
const { planPortoImport, tidyPortoName, portoStatusIsActive } = require('../lib/porto-technician-import.ts');

test('tidyPortoName capitalizes UPPERCASE names and keeps the small words down', () => {
  assert.equal(tidyPortoName('JOÃO DA SILVA DOS SANTOS'), 'João da Silva dos Santos');
  assert.equal(tidyPortoName('  MARIA   DE  SOUZA '), 'Maria de Souza');
  assert.equal(tidyPortoName('Ana Paula'), 'Ana Paula');
});

test('portoStatusIsActive only accepts an explicit active status', () => {
  assert.equal(portoStatusIsActive('ATIVO'), true);
  assert.equal(portoStatusIsActive('Ativo'), true);
  assert.equal(portoStatusIsActive('INATIVO'), false);
  assert.equal(portoStatusIsActive('BLOQUEADO'), false);
  assert.equal(portoStatusIsActive(undefined), false);
});

test('planPortoImport creates new ones, keeping the Porto name as the hint', () => {
  const { toCreate, skipped } = planPortoImport(
    [{ qra: '12345', name: 'CARLOS EDUARDO', status: 'ATIVO' }, { qra: '67890', name: 'PEDRO LIMA', status: 'INATIVO' }],
    new Set(),
  );
  assert.deepEqual(toCreate, [
    { qra: '12345', portoName: 'CARLOS EDUARDO', name: 'Carlos Eduardo', status: 'active' },
    { qra: '67890', portoName: 'PEDRO LIMA', name: 'Pedro Lima', status: 'inactive' },
  ]);
  assert.deepEqual(skipped, []);
});

test('planPortoImport skips a QRA that an active technician already holds', () => {
  const { toCreate, skipped } = planPortoImport([{ qra: '12345', name: 'CARLOS', status: 'ATIVO' }], new Set(['12345']));
  assert.equal(toCreate.length, 0);
  assert.deepEqual(skipped.map((item) => item.reason), ['already_registered']);
});

test('planPortoImport skips repeated QRAs in the same request and invalid rows', () => {
  const { toCreate, skipped } = planPortoImport(
    [
      { qra: '12345', name: 'A', status: 'ATIVO' },
      { qra: '12345', name: 'A de novo', status: 'ATIVO' },
      { qra: 'abc', name: 'Sem QRA', status: 'ATIVO' },
      { qra: '99999', name: '   ', status: 'ATIVO' },
    ],
    new Set(),
  );
  assert.equal(toCreate.length, 1);
  assert.deepEqual(skipped.map((item) => item.reason), ['duplicate_in_request', 'invalid', 'invalid']);
});
