// Run with: node scripts/test-legal-certificate.cjs
// The certificate of acceptance: the pure pieces (code, masks, dates, the PDF itself), then the whole path in the development database on
// test companies of their own ("zz-teste-certificado-*"; purge afterwards with purge-test-orgs.mjs). The Blob store is always replaced by a
// fake: nothing is uploaded anywhere. Real companies are never read or written.
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);
const cert = require('../lib/legal/certificate.ts');
const { sql } = require('../lib/db.ts');

const stamp = Date.now();
const rows = [
  { document: 'terms', version: '2026-10-26', acceptedAt: '2026-11-04T17:53:44.000Z', who: 'Maria Teste', role: 'admin', ip: '187.122.137.45' },
  { document: 'privacy', version: '2026-10-26', acceptedAt: '2026-11-04T17:53:44.500Z', who: 'Maria Teste', role: 'admin', ip: '187.122.137.45' },
  { document: 'dpa', version: '2026-11-05', acceptedAt: '2026-11-04T17:53:45.000Z', who: 'Maria Teste', role: 'admin', ip: '187.122.137.45' },
];

// ------------------------------------------------------------------------------------------------------------- pure pieces

test('the verification code is the start of the SHA-256 of the canonical lines', () => {
  const expected = crypto.createHash('sha256').update(rows.map((row) => `${row.document}|${row.version}|${row.acceptedAt}`).join('\n'), 'utf8').digest('hex').slice(0, 16).toUpperCase();
  assert.equal(cert.verificationCode(rows), expected);
  assert.match(cert.verificationCode(rows), /^[0-9A-F]{16}$/);
  assert.notEqual(cert.verificationCode(rows), cert.verificationCode(rows.slice(1)), 'another set of acceptances, another code');
});

test('the time is shown in Brasília, not in UTC', () => {
  assert.equal(cert.formatBrasilia('2026-11-04T17:53:44.000Z'), '04/11/2026 às 14:53:44');
  assert.equal(cert.formatBrasilia('2026-11-04T17:53:44.000Z', false), '04/11/2026 às 14:53');
});

test('the IP loses its last number and the CNPJ is formatted', () => {
  assert.equal(cert.maskIp('187.122.137.45'), '187.122.137.xxx');
  assert.equal(cert.maskIp(null), 'não registrado');
  assert.equal(cert.maskIp('2001:db8::1'), 'registrado');
  assert.equal(cert.formatCnpj('12345678000195'), '12.345.678/0001-95');
  assert.equal(cert.formatCnpj(null), '—');
});

test('the PDF is made and it does not show the whole IP', () => {
  const bytes = cert.buildCertificatePdf({ company: { name: 'Empresa Teste', legalName: 'Empresa Teste LTDA', document: '12345678000195', slug: 'empresa-teste' }, rows, issuedAt: '2026-11-17T12:00:00.000Z' });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), '%PDF-');
  assert.ok(bytes.length > 2000);
  assert.ok(!Buffer.from(bytes).toString('latin1').includes('187.122.137.45'));
});

// ------------------------------------------------------------------------------------------------------------- the whole path

const created = [];
const uploads = [];
const fakeStore = async (pathname, bytes) => {
  uploads.push({ pathname, size: bytes.length });
  return { url: `https://blob.test/${pathname}` };
};

async function makeOrg(suffix) {
  const slug = `zz-teste-certificado-${suffix}-${stamp}`;
  const [org] = await sql`INSERT INTO organizations (slug, name, status, legal_name, document) VALUES (${slug}, ${`Teste certificado ${suffix}`}, 'active', 'Teste Certificado LTDA', '12345678000195') RETURNING id`;
  const [user] = await sql`INSERT INTO users (organization_id, email, name, role, password_hash) VALUES (${org.id}, ${`cert-${suffix}-${stamp}@exemplo.com`}, 'Carla Certificado', 'admin', 'x') RETURNING id`;
  created.push(org.id);
  return { id: org.id, userId: user.id };
}

async function accept(org, document, version = '2026-10-26', source = 'app') {
  await sql`INSERT INTO legal_acceptances (organization_id, user_id, document, version, ip, source) VALUES (${org.id}, ${org.userId}, ${document}, ${version}, '10.0.0.7', ${source})`;
}

test('flow: a company that accepted only part of the agreement gets no certificate', async () => {
  const org = await makeOrg('a');
  await accept(org, 'terms');
  await accept(org, 'privacy');
  assert.deepEqual(await cert.generateAcceptanceCertificate(org.id, { store: fakeStore }), { status: 'incomplete' });
  assert.deepEqual(await cert.listCertificates(org.id), []);
  assert.equal(uploads.length, 0);
});

test('flow: accepting the three documents makes one certificate in the Biblioteca, once per version', async () => {
  const org = await makeOrg('b');
  for (const document of ['terms', 'privacy', 'dpa']) await accept(org, document);
  const first = await cert.ensureAcceptanceCertificate(org.id, fakeStore);
  assert.equal(first.status, 'created');
  assert.equal(first.title, cert.certificateTitle('2026-10-26'));

  const [doc] = await sql`SELECT * FROM library_documents WHERE id = ${first.id}`;
  assert.equal(doc.organization_id, org.id);
  assert.equal(doc.audience, 'Administrativo');
  assert.equal(doc.category, cert.CERTIFICATE_CATEGORY);
  assert.equal(doc.type, 'PDF');
  assert.ok(Number(doc.file_size) > 2000);
  assert.ok(uploads.at(-1).pathname.startsWith(`library/${org.id}/`), 'kept in the company folder');

  const again = await cert.ensureAcceptanceCertificate(org.id, fakeStore);
  assert.deepEqual([again.status, again.id], ['exists', first.id]);
  assert.equal((await cert.listCertificates(org.id)).length, 1);
});

test('flow: asking again by force archives the earlier one, never erases it', async () => {
  const org = await makeOrg('c');
  for (const document of ['terms', 'privacy', 'dpa']) await accept(org, document);
  const first = await cert.generateAcceptanceCertificate(org.id, { store: fakeStore });
  const second = await cert.generateAcceptanceCertificate(org.id, { store: fakeStore, force: true, actorId: org.userId });
  assert.equal(second.status, 'created');
  assert.notEqual(second.id, first.id);
  const list = await cert.listCertificates(org.id);
  assert.deepEqual(list.map((item) => item.id), [second.id]);
  const [old] = await sql`SELECT deleted_at FROM library_documents WHERE id = ${first.id}`;
  assert.ok(old.deleted_at, 'the earlier certificate is in the trash, not gone');
  const audit = await sql`SELECT details FROM audit_events WHERE organization_id = ${org.id} AND action = 'legal.certificate_generated' ORDER BY created_at`;
  assert.equal(audit.length, 2);
});

test('flow: a new version of a document makes a new certificate and keeps the old one', async () => {
  const org = await makeOrg('d');
  for (const document of ['terms', 'privacy', 'dpa']) await accept(org, document);
  const first = await cert.generateAcceptanceCertificate(org.id, { store: fakeStore });
  await accept(org, 'dpa', '2099-01-01');
  const second = await cert.generateAcceptanceCertificate(org.id, { store: fakeStore });
  assert.equal(second.status, 'created');
  assert.equal(second.title, cert.certificateTitle('2099-01-01'));
  assert.deepEqual((await cert.listCertificates(org.id)).map((item) => item.id).sort(), [first.id, second.id].sort());
});

test('flow: a certificate is only reachable from its own company', async () => {
  const mine = await makeOrg('e');
  const other = await makeOrg('f');
  for (const document of ['terms', 'privacy', 'dpa']) await accept(mine, document);
  const made = await cert.generateAcceptanceCertificate(mine.id, { store: fakeStore });
  assert.ok(await cert.getCertificateFile(mine.id, made.id));
  assert.equal(await cert.getCertificateFile(other.id, made.id), null);
  assert.deepEqual(await cert.listCertificates(other.id), []);
});

test('flow: a failure in the store never throws out of the best-effort call', async () => {
  const org = await makeOrg('g');
  for (const document of ['terms', 'privacy', 'dpa']) await accept(org, document);
  const broken = async () => { throw new Error('blob down'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await cert.ensureAcceptanceCertificate(org.id, broken), null);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(await cert.listCertificates(org.id), [], 'nothing half-made is listed');
});

after(() => {
  // The test companies stay archived until purge-test-orgs.mjs removes them for good.
  if (created.length) console.log(`test companies: ${created.length} (zz-teste-certificado-*-${stamp})`);
});
