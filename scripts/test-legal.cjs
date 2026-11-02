// Run with: node scripts/test-legal.cjs
// The versioned legal documents: what is pending after a new version, what a signup accepts, and the login throttle keys.
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

const { LEGAL_DOCUMENTS, ACCOUNT_DOCUMENTS, pendingDocuments, isLegalDocument } = require('../lib/legal/versions.ts');

const current = (document) => ({ document, version: LEGAL_DOCUMENTS[document].version });

test('a company that accepted nothing has every account document pending', () => {
  assert.deepEqual(pendingDocuments([]), ACCOUNT_DOCUMENTS);
});

test('accepting the current version of each clears the pending list', () => {
  assert.deepEqual(pendingDocuments(ACCOUNT_DOCUMENTS.map(current)), []);
});

test('an older version does not count: a new text asks again', () => {
  const accepted = [current('terms'), current('privacy'), { document: 'dpa', version: '2020-01-01' }];
  assert.deepEqual(pendingDocuments(accepted), ['dpa']);
});

test('the AI notice is only required when asked for', () => {
  assert.deepEqual(pendingDocuments(ACCOUNT_DOCUMENTS.map(current)), []);
  assert.deepEqual(pendingDocuments(ACCOUNT_DOCUMENTS.map(current), ['ai_transfer']), ['ai_transfer']);
});

test('only known documents are accepted', () => {
  assert.equal(isLegalDocument('terms'), true);
  assert.equal(isLegalDocument('toString'), false);
  assert.equal(isLegalDocument('constructor'), false);
  assert.equal(isLegalDocument(42), false);
});

test('every request kind the database accepts has a label', () => {
  const { REQUEST_KIND_LABELS } = require('../lib/privacy/labels.ts');
  const migration = fs.readFileSync(require('node:path').join(__dirname, '..', 'db', 'migrations', '0035_security_lgpd.sql'), 'utf8');
  const kinds = migration.match(/kind\s+VARCHAR\(16\) NOT NULL CHECK \(kind IN \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map((item) => item.slice(1, -1));
  assert.ok(kinds.length >= 9);
  for (const kind of kinds) assert.ok(REQUEST_KIND_LABELS[kind], `missing label for ${kind}`);
  assert.equal(Object.keys(REQUEST_KIND_LABELS).length, kinds.length);
});

test('the public texts name every document and carry the version', () => {
  const { legalText } = require('../lib/legal/texts.ts');
  const company = { legalName: '', cnpj: '', email: '' };
  for (const document of ['terms', 'privacy', 'dpa']) {
    const text = legalText(document, company);
    assert.ok(text.includes(LEGAL_DOCUMENTS[document].version), `${document} shows its version`);
    assert.ok(text.includes('[CNPJ a informar]') || document === 'privacy', `${document} never invents a CNPJ`);
  }
  assert.ok(legalText('privacy', company).includes('[e-mail de contato a informar]'));
});
