// Run with: node scripts/test-billing-release.cjs
// Needs the development database (.env). On a test company of its own ("zz-teste-cobranca", left archived): a company
// suspended for non-payment is released the moment its overdue charge shows as paid (what "Verificar pagamento" ends up
// doing), while one suspended by the owner is never released by a payment, and one with another charge still overdue stays locked.
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);
const { sql } = require('../lib/db.ts');
const { evaluateBillingStatus } = require('../lib/billing/billing.ts');
const { getAccessById } = require('../lib/organization-access.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-cobranca';
let org;
const stamp = Date.now();

const suspend = (source) => sql`UPDATE organizations SET status = 'suspended', status_source = ${source}, status_reason = 'teste', status_changed_at = NOW(), deleted_at = NULL, unbilled = DEFAULT WHERE id = ${org}`;
const charge = async (suffix, status) => {
  await sql`
    INSERT INTO billing_charges (organization_id, asaas_payment_id, kind, description, value, due_date, status)
    VALUES (${org}, ${`pay_teste_${stamp}_${suffix}`}, 'subscription', 'Mensalidade de teste', 100, '2026-10-01', ${status})
    ON CONFLICT (asaas_payment_id) DO UPDATE SET status = EXCLUDED.status
  `;
};
const level = async () => (await getAccessById(org)).level;

test('setup: a test company', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste cobranca', 'active') RETURNING id`)[0].id;
  await sql`UPDATE billing_charges SET status = 'RECEIVED' WHERE organization_id = ${org} AND status = 'OVERDUE'`;
});

test('suspended for non-payment: locked while the charge is overdue, released at once when it is paid', async () => {
  await suspend('billing');
  await charge('a', 'OVERDUE');
  await evaluateBillingStatus(org);
  assert.equal(await level(), 'export_only', 'still locked: the charge is overdue');

  await charge('a', 'RECEIVED');
  await evaluateBillingStatus(org);
  assert.equal(await level(), 'full', 'released as soon as nothing is overdue');
  const [row] = await sql`SELECT status, status_reason FROM organizations WHERE id = ${org}`;
  assert.deepEqual([row.status, row.status_reason], ['active', null]);
});

test('another charge still overdue keeps it locked', async () => {
  await suspend('billing');
  await charge('b', 'OVERDUE');
  await charge('c', 'OVERDUE');
  await charge('b', 'RECEIVED');
  await evaluateBillingStatus(org);
  assert.equal(await level(), 'export_only');
  await charge('c', 'RECEIVED');
  await evaluateBillingStatus(org);
  assert.equal(await level(), 'full');
});

test('a suspension by the owner is never lifted by a payment', async () => {
  await suspend('owner');
  await charge('d', 'RECEIVED');
  await evaluateBillingStatus(org);
  assert.equal(await level(), 'export_only');
});

after(async () => {
  await sql`UPDATE billing_charges SET status = 'RECEIVED' WHERE organization_id = ${org} AND status = 'OVERDUE'`;
  await sql`UPDATE organizations SET status = 'canceled', deleted_at = NOW() WHERE id = ${org}`;
});
