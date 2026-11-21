// Run with: node scripts/test-add-module.cjs
// "Adicionar módulo" in Assinatura: a company on "Monte o seu" adds a module itself. Test companies of their own
// ("zz-addmod-*", purge them afterwards with purge-test-orgs.mjs) in the development database; the payment gateway is a stub,
// nothing leaves this machine.
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
const subscriptionUpdates = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('asaas.com')) {
    const path = String(url).split('/v3')[1];
    gatewayCalls.push(`${init.method ?? 'GET'} ${path}`);
    const body = init.body ? JSON.parse(init.body) : {};
    let answer = { data: [] };
    if (init.method === 'POST' && path === '/payments') {
      answer = { id: `pay_addmod_${payments.length + 1}`, status: 'PENDING', billingType: 'UNDEFINED', invoiceUrl: 'https://example.test/fatura', ...body };
      payments.push(body);
    } else if (init.method === 'PUT' && /^\/subscriptions\//.test(path)) {
      answer = { id: path.split('/')[2], ...body };
      subscriptionUpdates.push(body);
    }
    return { ok: true, status: 200, json: async () => answer };
  }
  return realFetch(url, init);
};

const { sql } = require('../lib/db.ts');
const { addModule, listAddableModules } = require('../lib/billing/modules.ts');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const orgs = [];

async function company(label, planKey, cycle) {
  const org = (await sql`INSERT INTO organizations (slug, name, status) VALUES (${`zz-addmod-${stamp}-${label}`}, ${`Teste módulo ${label}`}, 'active') RETURNING id`)[0].id;
  orgs.push(org);
  const user = (await sql`INSERT INTO users (organization_id, email, name, role, password_hash) VALUES (${org}, ${`addmod-${stamp}-${label}@exemplo.com`}, 'Admin Teste', 'admin', 'x') RETURNING id`)[0].id;
  const [plan] = await sql`SELECT id, monthly_price, annual_price FROM plans WHERE key = ${planKey}`;
  const base = cycle === 'annual' ? Number(plan.annual_price) : Number(plan.monthly_price);
  await sql`
    INSERT INTO subscriptions (organization_id, plan_id, cycle, base_price, setup_fee_status, billing_day, asaas_customer_id, asaas_subscription_id)
    VALUES (${org}, ${plan.id}, ${cycle}, ${base}, 'paid', 10, 'cus_addmod', ${`sub_addmod_${label}`})
  `;
  return { org, user, base };
}

const price = async (key) => Number((await sql`SELECT module_price FROM features WHERE key = ${key}`)[0].module_price);
const setup = async (key) => Number((await sql`SELECT module_setup_fee FROM features WHERE key = ${key}`)[0].module_setup_fee);

test('a company on "Monte o seu" is offered the modules it does not have, at the price of its cycle', { skip: !hasDatabase }, async () => {
  const monthly = await company('m', 'montagem', 'monthly');
  const list = await listAddableModules(monthly.org);
  assert.equal(list.available, true);
  const whatsapp = list.modules.find((module) => module.key === 'whatsapp');
  assert.equal(whatsapp.price, await price('whatsapp'));
  assert.equal(whatsapp.setupFee, await setup('whatsapp'));
  assert.ok(!list.modules.some((module) => ['technicians', 'services', 'payroll'].includes(module.key)), 'the base is never sold apart');

  const annual = await company('a', 'montagem', 'annual');
  const yearly = (await listAddableModules(annual.org)).modules.find((module) => module.key === 'whatsapp');
  assert.equal(yearly.price, Math.round((await price('whatsapp')) * 10 * 100) / 100, 'annual = monthly x the plan factor (10)');
});

test('adding a module unlocks it, raises the price, charges its setup fee and tells the team', { skip: !hasDatabase }, async () => {
  const { org, user, base } = await company('add', 'montagem', 'monthly');
  payments.length = 0;
  subscriptionUpdates.length = 0;
  const result = await addModule(org, 'whatsapp', { userId: user, impersonating: false });

  assert.equal(result.module.key, 'whatsapp');
  assert.equal(result.price, await price('whatsapp'));
  const [subscription] = await sql`SELECT base_price, modules FROM subscriptions WHERE organization_id = ${org}`;
  assert.equal(Number(subscription.base_price), Math.round((base + (await price('whatsapp'))) * 100) / 100, 'base_price already holds base + modules');
  assert.deepEqual(subscription.modules.map((module) => module.key), ['whatsapp']);

  // the setup fee is one charge now; the new monthly value goes to the gateway for the next charge
  assert.equal(payments.length, 1);
  assert.equal(payments[0].value, await setup('whatsapp'));
  assert.equal(payments[0].externalReference, `${org}:module:whatsapp`);
  assert.ok(subscriptionUpdates.some((update) => Number(update.value) === Number(subscription.base_price)), 'the gateway subscription takes the new value');
  assert.equal(result.invoiceUrl, 'https://example.test/fatura');

  const [ticket] = await sql`SELECT title FROM bug_reports WHERE organization_id = ${org}`;
  assert.match(ticket.title, /Módulo adicionado/);
  const audit = await sql`SELECT details FROM audit_events WHERE organization_id = ${org} AND action = 'subscription.module_added'`;
  assert.equal(audit.length, 1);

  // the company now has the module (the feature check reads the subscription's modules)
  const { featureAllowedSql } = require('../lib/billing/entitlements.ts');
  assert.equal(typeof featureAllowedSql, 'function');
  const again = await listAddableModules(org);
  assert.ok(!again.modules.some((module) => module.key === 'whatsapp'), 'no longer offered');
  assert.deepEqual(again.current, ['whatsapp']);
});

test('the same module is never added twice', { skip: !hasDatabase }, async () => {
  const { org, user } = await company('dup', 'montagem', 'monthly');
  await addModule(org, 'billing_report', { userId: user, impersonating: false });
  const [before] = await sql`SELECT base_price FROM subscriptions WHERE organization_id = ${org}`;
  await assert.rejects(addModule(org, 'billing_report', { userId: user, impersonating: false }), /já tem esse módulo/);
  const [after] = await sql`SELECT base_price, modules FROM subscriptions WHERE organization_id = ${org}`;
  assert.equal(Number(after.base_price), Number(before.base_price));
  assert.equal(after.modules.length, 1);
});

test('a module that is not on sale, or part of the base, is refused', { skip: !hasDatabase }, async () => {
  const { org, user } = await company('bad', 'montagem', 'monthly');
  await assert.rejects(addModule(org, 'payroll', { userId: user, impersonating: false }), /não está à venda/);
  await assert.rejects(addModule(org, 'nao_existe', { userId: user, impersonating: false }), /não está à venda/);
});

test('annual companies add it at the annual price', { skip: !hasDatabase }, async () => {
  const { org, user, base } = await company('year', 'montagem', 'annual');
  payments.length = 0;
  const result = await addModule(org, 'finance', { userId: user, impersonating: false });
  const expected = Math.round((await price('finance')) * 10 * 100) / 100;
  assert.equal(result.price, expected);
  const [subscription] = await sql`SELECT base_price FROM subscriptions WHERE organization_id = ${org}`;
  assert.equal(Number(subscription.base_price), Math.round((base + expected) * 100) / 100);
  assert.equal(payments[0].value, await setup('finance'), 'the setup fee is the same one-off, whatever the cycle');
});

test('a company on a package (Essencial, Pro) is sent to the upgrade instead', { skip: !hasDatabase }, async () => {
  const { org, user } = await company('pkg', 'essencial', 'monthly');
  const list = await listAddableModules(org);
  assert.equal(list.available, false);
  assert.deepEqual(list.modules, []);
  await assert.rejects(addModule(org, 'whatsapp', { userId: user, impersonating: false }), /pacote pronto/);
});

test('lifetime and test companies are changed by the owner, not by themselves', { skip: !hasDatabase }, async () => {
  const { org, user } = await company('life', 'montagem', 'monthly');
  await sql`UPDATE organizations SET lifetime = TRUE WHERE id = ${org}`;
  assert.equal((await listAddableModules(org)).available, false);
  await assert.rejects(addModule(org, 'whatsapp', { userId: user, impersonating: false }), /suporte do NextRotta/);
});

after(async () => {
  for (const id of orgs) await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${id}`;
});
