// Run with: node scripts/test-builder-plan.cjs
// The builder ("Monte o seu"): the base plus the modules the company chose. The price math is pure;
// the checkout quote and the feature check read the database (the writes run inside a transaction
// that is rolled back, so nothing is left behind). The database parts are skipped without DATABASE_URL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

for (const name of ['.env.local', '.env']) {
  const file = path.join(__dirname, '..', name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { quoteBuilder, annualFactor } = require('../lib/plans.ts');

const base = { monthlyPrice: 217, annualPrice: 2170, setupFee: 600, features: ['technicians', 'library'] };
const offers = [
  { key: 'porto', name: 'Porto', description: null, monthlyPrice: 80, setupFee: 200 },
  { key: 'whatsapp', name: 'WhatsApp', description: null, monthlyPrice: 35, setupFee: 60 },
];

test('the annual factor follows the base plan (10 payments for "2 months free")', () => {
  assert.equal(annualFactor(base), 10);
  assert.equal(annualFactor({ monthlyPrice: 0, annualPrice: 0 }), 12);
});

test('monthly: base plus the modules, setup fees added', () => {
  const quote = quoteBuilder(base, offers, ['porto', 'whatsapp'], 'monthly');
  assert.equal(quote.basePrice, 332);
  assert.equal(quote.setupFee, 860);
  assert.deepEqual(quote.modules.map((module) => [module.key, module.price]), [['porto', 80], ['whatsapp', 35]]);
});

test('annual: each module costs its monthly price times the base factor', () => {
  const quote = quoteBuilder(base, offers, ['porto', 'whatsapp'], 'annual');
  assert.equal(quote.basePrice, 2170 + 800 + 350);
  assert.equal(quote.modules.find((module) => module.key === 'porto').price, 800);
});

test('what the base already includes is free; unknown keys are reported and not charged; duplicates count once', () => {
  const quote = quoteBuilder(base, offers, ['library', 'porto', 'porto', 'banana'], 'monthly');
  assert.equal(quote.basePrice, 297);
  assert.deepEqual(quote.unknown, ['banana']);
  assert.deepEqual(quote.modules.map((module) => module.key), ['porto']);
});

test('no modules: just the base', () => {
  const quote = quoteBuilder(base, offers, [], 'annual');
  assert.equal(quote.basePrice, 2170);
  assert.equal(quote.setupFee, 600);
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

test('checkout quote for the builder reads the real prices', { skip: !hasDatabase }, async () => {
  const { quoteSignup } = require('../lib/signup.ts');
  const quote = await quoteSignup('montagem', 'monthly', 10, ['porto', 'whatsapp']);
  assert.equal(quote.plan.kind, 'builder');
  assert.equal(quote.basePrice, quote.plan.monthlyPrice + 80 + 35);
  assert.equal(quote.setupFee, quote.plan.setupFee + 200 + 60);
  assert.equal(quote.recurring, quote.basePrice);
  assert.deepEqual(quote.moduleDetails.map((module) => module.name).length, 2);

  await assert.rejects(quoteSignup('montagem', 'monthly', 10, ['nao_existe']), /indisponível/);
  await assert.rejects(quoteSignup('sob_medida', 'monthly', 10, []), /indisponível/); // archived
  const pro = await quoteSignup('pro', 'monthly', 10, ['porto']); // a package ignores modules
  assert.equal(pro.basePrice, pro.plan.monthlyPrice);
  assert.deepEqual(pro.modules, []);
});

test('a chosen module unlocks its feature in SQL, and only that one (rolled back)', { skip: !hasDatabase }, async () => {
  const { Pool, neonConfig } = require('@neondatabase/serverless');
  const { featureAllowedSql } = require('../lib/billing/entitlements.ts');
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = await client.query(`INSERT INTO organizations (slug, name, status) VALUES ('zz-builder-test', 'Teste montagem', 'active') RETURNING id`);
    const plan = await client.query(`SELECT id FROM plans WHERE kind = 'builder'`);
    await client.query(
      `INSERT INTO subscriptions (organization_id, plan_id, cycle, base_price, modules)
       VALUES ($1, $2, 'monthly', 297, '[{"key":"porto","price":80,"setupFee":200}]'::jsonb)`,
      [org.rows[0].id, plan.rows[0].id],
    );
    const allowed = async (feature) =>
      (await client.query(`SELECT ${featureAllowedSql('o', feature)} AS ok FROM organizations o WHERE o.id = $1`, [org.rows[0].id])).rows[0].ok;
    assert.equal(await allowed('porto'), true, 'the module the company chose');
    assert.equal(await allowed('whatsapp'), false, 'a module it did not choose');
    assert.equal(await allowed('payroll'), true, 'the base');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});

test('the real customer keeps her price and the old "Sob medida" is off', { skip: !hasDatabase }, async () => {
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  const subs = await sql`SELECT o.slug, s.base_price::float AS price, s.modules FROM subscriptions s JOIN organizations o ON o.id = s.organization_id WHERE o.slug = 'kappa'`;
  if (subs[0]) {
    assert.equal(subs[0].price, 3970);
    assert.deepEqual(subs[0].modules, []);
  }
  const [sob] = await sql`SELECT archived_at, visible FROM plans WHERE key = 'sob_medida'`;
  assert.ok(!sob || (sob.archived_at && !sob.visible));
  const [builder] = await sql`SELECT kind, visible, archived_at FROM plans WHERE key = 'montagem'`;
  assert.equal(builder.kind, 'builder');
  assert.equal(builder.visible, false);
  assert.equal(builder.archived_at, null);
});
