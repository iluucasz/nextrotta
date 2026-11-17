// Run with: node scripts/test-billing-simulation.cjs
// The payment dashboard of a test company: instalments made locally, paid and undone by hand, never touching the gateway.
// Pure schedule first, then the whole path on test companies of their own ("zz-teste-simulacao-*"; purge afterwards with purge-test-orgs.mjs).
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
const simulation = require('../lib/billing/simulation.ts');
const { sql } = require('../lib/db.ts');

const stamp = Date.now();
const created = [];

test('the schedule: setup in parcels first, then twelve monthly charges', () => {
  const rows = simulation.simulatedSchedule({ today: '2026-11-17', billingDay: 10, value: 549.99, cycle: 'monthly', setupFee: 999, setupInstallments: 3 });
  const setup = rows.filter((row) => row.kind === 'setup');
  const monthly = rows.filter((row) => row.kind === 'subscription');
  assert.equal(setup.length, 3);
  assert.equal(Math.round(setup.reduce((total, row) => total + row.value, 0) * 100), 99900, 'the parcels add up to the fee');
  assert.equal(setup[0].dueDate, '2026-11-20', 'the first parcel falls due in 3 days');
  assert.equal(monthly.length, 12);
  assert.equal(monthly[0].dueDate, '2026-12-10', 'the first month is free: the first charge is next month');
  assert.equal(monthly[1].dueDate, '2027-01-10');
});

test('the schedule: no setup fee, annual cycle', () => {
  const rows = simulation.simulatedSchedule({ today: '2026-11-17', billingDay: 5, value: 5000, cycle: 'annual', setupFee: 0, setupInstallments: 1 });
  assert.equal(rows.every((row) => row.kind === 'subscription'), true);
  assert.deepEqual(rows.map((row) => row.dueDate), ['2026-12-05', '2027-12-05', '2028-12-05']);
});

async function makeOrg(suffix, { testOrg = true, setupFee = 600, installments = 2 } = {}) {
  const slug = `zz-teste-simulacao-${suffix}-${stamp}`;
  const [{ id: planId }] = await sql`SELECT id FROM plans WHERE key = 'essencial'`;
  const [org] = await sql`INSERT INTO organizations (slug, name, status, is_test) VALUES (${slug}, ${`Teste simulacao ${suffix}`}, 'active', ${testOrg}) RETURNING id`;
  await sql`
    INSERT INTO subscriptions (organization_id, plan_id, cycle, base_price, extra_technician_price, included_technicians, setup_fee, setup_fee_status, setup_installments, billing_day)
    VALUES (${org.id}, ${planId}, 'monthly', 217, 0, 5, ${setupFee}, ${setupFee > 0 ? 'pending' : 'none'}, ${installments}, 10)
  `;
  created.push(org.id);
  return org.id;
}

test('flow: a test company gets its simulated instalments once', async () => {
  const org = await makeOrg('a');
  await simulation.ensureSimulatedSchedule(org);
  await simulation.ensureSimulatedSchedule(org);
  const rows = await sql`SELECT kind, status, billing_type FROM billing_charges WHERE organization_id = ${org}`;
  assert.equal(rows.length, 2 + 12);
  assert.ok(rows.every((row) => row.billing_type === 'SIMULATED' && row.status === 'PENDING'));
});

test('flow: a real company never gets simulated instalments, nor can it use the simulation', async () => {
  const org = await makeOrg('b', { testOrg: false });
  await simulation.ensureSimulatedSchedule(org);
  assert.equal((await sql`SELECT 1 FROM billing_charges WHERE organization_id = ${org}`).length, 0);
  await assert.rejects(simulation.setSimulatedPayment(org, '00000000-0000-4000-8000-000000000000', true, null), /conta de teste/);
});

test('flow: paying every setup parcel pays the setup fee, undoing one brings it back', async () => {
  const org = await makeOrg('c');
  await simulation.ensureSimulatedSchedule(org);
  const parcels = await sql`SELECT id FROM billing_charges WHERE organization_id = ${org} AND kind = 'setup' ORDER BY due_date`;
  const statusOf = async () => (await sql`SELECT setup_fee_status FROM subscriptions WHERE organization_id = ${org}`)[0].setup_fee_status;

  await simulation.setSimulatedPayment(org, parcels[0].id, true, null);
  assert.equal(await statusOf(), 'pending', 'one parcel of two is not enough');
  await simulation.setSimulatedPayment(org, parcels[1].id, true, null);
  assert.equal(await statusOf(), 'paid');
  const [paid] = await sql`SELECT status, paid_at FROM billing_charges WHERE id = ${parcels[1].id}`;
  assert.equal(paid.status, 'RECEIVED');
  assert.ok(paid.paid_at);

  await simulation.setSimulatedPayment(org, parcels[1].id, false, null);
  assert.equal(await statusOf(), 'pending');
  const [back] = await sql`SELECT status, paid_at FROM billing_charges WHERE id = ${parcels[1].id}`;
  assert.deepEqual([back.status, back.paid_at], ['PENDING', null]);
});

test('flow: a charge of another company cannot be paid', async () => {
  const mine = await makeOrg('d');
  const other = await makeOrg('e');
  await simulation.ensureSimulatedSchedule(other);
  const [charge] = await sql`SELECT id FROM billing_charges WHERE organization_id = ${other} LIMIT 1`;
  await assert.rejects(simulation.setSimulatedPayment(mine, charge.id, true, null), /não encontrada/);
});

test('flow: a payment link is refused for a test company, and a company with no CNPJ cannot become a gateway customer (nothing reaches the gateway)', async () => {
  const testOrg = await makeOrg('f');
  const realOrg = await makeOrg('g', { testOrg: false });
  const billing = require('../lib/billing/billing.ts');
  await assert.rejects(billing.createPaymentLink(testOrg, { kind: 'setup' }, { id: null }), /teste/);
  await assert.rejects(billing.createPaymentLink(realOrg, { kind: 'setup' }, { id: null }), /CNPJ/);
  await assert.rejects(billing.createPaymentLink(testOrg, { kind: 'setup' }, { id: null }, { allowTest: true }), /CNPJ/, 'sandbox test company: asks for the CNPJ before any gateway call');
});

test('flow: making a charge in a test company creates a simulated one; the setup defaults to what is missing', async () => {
  const org = await makeOrg('h', { setupFee: 600, installments: 2 });
  await simulation.ensureSimulatedSchedule(org); // both parcels of the fee are already charged
  await assert.rejects(simulation.createSimulatedCharge(org, { kind: 'setup' }, null), /já está toda cobrada/);
  const extra = await simulation.createSimulatedCharge(org, { kind: 'one_off', value: 150, description: 'Treinamento' }, null);
  assert.equal(extra.invoiceUrl, null);
  const [row] = await sql`SELECT kind, value::float AS value, status, billing_type FROM billing_charges WHERE organization_id = ${org} AND description = 'Treinamento'`;
  assert.deepEqual([row.kind, row.value, row.status, row.billing_type], ['one_off', 150, 'PENDING', 'SIMULATED']);
  await assert.rejects(simulation.createSimulatedCharge(org, { kind: 'one_off' }, null), /valor/i);
  const real = await makeOrg('i', { testOrg: false });
  await assert.rejects(simulation.createSimulatedCharge(real, { kind: 'one_off', value: 10 }, null), /conta de teste/);
});

after(() => {
  if (created.length) console.log(`test companies: ${created.length} (zz-teste-simulacao-*-${stamp})`);
});
