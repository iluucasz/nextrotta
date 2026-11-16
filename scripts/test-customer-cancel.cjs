// Run with: node scripts/test-customer-cancel.cjs
// Setup-fee instalments (pure) and the customer's own cancellation, on a test company of its own ("zz-cancel-*", left
// archived) in the development database. The payment gateway is replaced by a stub: nothing leaves this machine except
// the closing copy of the (empty) test company that cancelling always makes.
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
process.env.ASAAS_API_KEY = 'test-key';
process.env.ASAAS_ENVIRONMENT = 'sandbox';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);

const gatewayCalls = [];
const payments = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('asaas.com')) {
    const path = String(url).split('/v3')[1];
    gatewayCalls.push(`${init.method ?? 'GET'} ${path}`);
    const body = init.body ? JSON.parse(init.body) : {};
    let answer = { deleted: true };
    if (init.method === 'POST' && path === '/payments') {
      answer = { id: `pay_stub_${payments.length + 1}`, status: 'PENDING', billingType: 'UNDEFINED', ...body };
      payments.push(body);
    } else if (init.method === 'POST' && path === '/subscriptions') answer = { id: 'sub_stub', ...body };
    else if (init.method === 'GET') answer = { data: [] };
    return { ok: true, status: 200, json: async () => answer };
  }
  return realFetch(url, init);
};

const { splitSetupFee } = require('../lib/plans.ts');
const { sql } = require('../lib/db.ts');
const { cancelSubscriptionByCustomer, getBillingNotice, createSetupCharge, startSubscriptionAfterSetup } = require('../lib/billing/billing.ts');

test('the setup fee splits into whole cents and always adds up', () => {
  assert.deepEqual(splitSetupFee(999, 3), [333, 333, 333]);
  assert.deepEqual(splitSetupFee(799, 2), [399.5, 399.5]);
  assert.deepEqual(splitSetupFee(1000, 3), [333.33, 333.33, 333.34]);
  assert.deepEqual(splitSetupFee(799, 1), [799]);
  for (const [total, count] of [[819, 3], [799.99, 2], [1234.56, 7], [10, 12]]) {
    const parts = splitSetupFee(total, count);
    assert.equal(parts.length, count);
    assert.equal(Math.round(parts.reduce((sum, part) => sum + part, 0) * 100), Math.round(total * 100));
  }
  assert.deepEqual(splitSetupFee(500, 0), [500], 'nonsense counts fall back to one payment');
});

const hasDatabase = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
let org;
const charge = (suffix, kind, status, due, ref) => sql`
  INSERT INTO billing_charges (organization_id, asaas_payment_id, kind, description, value, due_date, status)
  VALUES (${org}, ${`pay_cancel_${stamp}_${suffix}`}, ${kind}, ${ref}, 333, ${due}, ${status})
`;
const statusOf = async (suffix) => (await sql`SELECT status FROM billing_charges WHERE asaas_payment_id = ${`pay_cancel_${stamp}_${suffix}`}`)[0].status;

test('setup: a company in its trial (3x setup, first instalment paid)', { skip: !hasDatabase }, async () => {
  org = (await sql`INSERT INTO organizations (slug, name, status) VALUES (${`zz-cancel-${stamp}`}, 'Teste cancelamento', 'active') RETURNING id`)[0].id;
  const [plan] = await sql`SELECT id FROM plans WHERE key = 'pro'`;
  await sql`
    INSERT INTO subscriptions (organization_id, plan_id, cycle, base_price, setup_fee, setup_fee_status, setup_installments, asaas_subscription_id)
    VALUES (${org}, ${plan.id}, 'monthly', 549.99, 999, 'paid', 3, 'sub_cancel_test')
  `;
  await charge('s1', 'setup', 'RECEIVED', '2026-11-01', 'parcela 1 de 3');
  await charge('s2', 'setup', 'PENDING', '2099-12-10', 'parcela 2 de 3');
  await charge('s3', 'setup', 'PENDING', '2100-01-10', 'parcela 3 de 3');
  await charge('m1', 'subscription', 'PENDING', '2099-12-10', 'mensalidade');
});

test('the top notice shows the next charge and that this is the trial', { skip: !hasDatabase }, async () => {
  const notice = await getBillingNotice(org);
  assert.equal(notice.trial, true);
  assert.equal(notice.dueDate, '2099-12-10');
  assert.equal(notice.value, 666, 'the instalment and the monthly fee fall due the same day, so both count');
  assert.equal(notice.charges, 2);
  assert.equal(notice.invoiceUrl, null, 'two charges: paid one by one in Assinatura');
  assert.ok(notice.daysLeft > 30);
});

test('paying the second instalment ends the trial', { skip: !hasDatabase }, async () => {
  await sql`UPDATE billing_charges SET status = 'RECEIVED' WHERE asaas_payment_id = ${`pay_cancel_${stamp}_s2`}`;
  assert.equal((await getBillingNotice(org)).trial, false);
  await sql`UPDATE billing_charges SET status = 'PENDING' WHERE asaas_payment_id = ${`pay_cancel_${stamp}_s2`}`;
});

test('cancelling stops everything still to be paid and keeps what was paid', { skip: !hasDatabase }, async () => {
  const result = await cancelSubscriptionByCustomer(org, null);
  assert.equal(result.canceledCharges, 3);
  assert.equal(await statusOf('s1'), 'RECEIVED', 'the paid instalment stays');
  for (const suffix of ['s2', 's3', 'm1']) assert.equal(await statusOf(suffix), 'DELETED');
  const [organization] = await sql`SELECT status, status_reason FROM organizations WHERE id = ${org}`;
  assert.deepEqual([organization.status, organization.status_reason], ['canceled', 'Cancelado pelo cliente']);
  const [subscription] = await sql`SELECT asaas_subscription_id FROM subscriptions WHERE organization_id = ${org}`;
  assert.equal(subscription.asaas_subscription_id, null);
  assert.ok(gatewayCalls.includes('DELETE /subscriptions/sub_cancel_test'));
  assert.equal(gatewayCalls.filter((call) => call.startsWith('DELETE /payments/')).length, 3);
  assert.equal(await getBillingNotice(org), null, 'nothing more to announce');
});

test('signing up charges only the first instalment; the rest come once it is paid, with the monthly fee', { skip: !hasDatabase }, async () => {
  const slug = `zz-cancel-${stamp}-b`;
  const id = (await sql`INSERT INTO organizations (slug, name, status, onboarding_status) VALUES (${slug}, 'Teste parcelas', 'active', 'awaiting_payment') RETURNING id`)[0].id;
  const [plan] = await sql`SELECT id FROM plans WHERE key = 'pro'`;
  await sql`
    INSERT INTO subscriptions (organization_id, plan_id, cycle, base_price, setup_fee, setup_fee_status, billing_day, asaas_customer_id)
    VALUES (${id}, ${plan.id}, 'monthly', 549.99, 999, 'pending', 10, 'cus_stub')
  `;
  payments.length = 0;
  await createSetupCharge(id, 'cus_stub');
  assert.equal(payments.length, 1, 'only the first instalment is charged at signup');
  assert.equal(payments[0].value, 333);
  assert.equal(payments[0].externalReference, `${id}:setup`);
  assert.equal((await sql`SELECT setup_installments FROM subscriptions WHERE organization_id = ${id}`)[0].setup_installments, 3);

  await startSubscriptionAfterSetup(id);
  assert.equal(payments.length, 3, 'two more instalments once the first is paid');
  assert.deepEqual(payments.slice(1).map((payment) => payment.value), [333, 333]);
  assert.deepEqual(payments.slice(1).map((payment) => payment.externalReference), [`${id}:setup:2`, `${id}:setup:3`]);
  const [second, third] = payments.slice(1).map((payment) => payment.dueDate);
  assert.ok(second < third && second.endsWith('-10') && third.endsWith('-10'), 'monthly, on the billing day');
  const kinds = await sql`SELECT kind FROM billing_charges WHERE organization_id = ${id}`;
  assert.ok(kinds.every((row) => row.kind === 'setup'), 'later instalments are setup charges too');
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${id}`;
});

test('cancelling twice is refused', { skip: !hasDatabase }, async () => {
  await assert.rejects(cancelSubscriptionByCustomer(org, null), /já está cancelada/);
});

after(async () => {
  if (org) await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
