// Run with: node scripts/test-pay-preset-flow.cjs
// Needs the development database (.env). The "settings" provisioning step (createInitialSettings in lib/platform/organizations.ts):
// the pay preset chosen when the owner creates a company fills its settings, and repeating the step never overwrites them.
// Each run creates its own test companies ("zz-preset-*"), archived at the end.
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...rest);
};

const { sql } = require('../lib/db.ts');
const { DEFAULT_ORGANIZATION_SETTINGS } = require('../lib/organization-settings.ts');
const { getOrganizationSettings, saveOrganizationSettings } = require('../lib/organization-settings-store.ts');
const { createInitialSettings, createOrganization } = require('../lib/platform/organizations.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const stamp = Date.now();
const created = [];
let owner;

const newCompany = async (label) => {
  const slug = `zz-preset-${label}-${stamp}`;
  const [{ id }] = await sql`INSERT INTO organizations (slug, name, status) VALUES (${slug}, ${`Teste preset ${label}`}, 'active') RETURNING id`;
  created.push(id);
  return id;
};

test('setup: an owner to sign the changes', async () => {
  owner = (await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL LIMIT 1`)[0]?.id;
  assert.ok(owner, 'no platform owner in the development database');
});

test('monthly: no fortnights and the month of each OS comes from its date', async () => {
  const id = await newCompany('mensal');
  assert.equal(await createInitialSettings(id, 'monthly', owner), 'monthly');
  const settings = await getOrganizationSettings(id);
  assert.deepEqual(settings.periodCutDays, []);
  assert.equal(settings.competenceSource, 'service_date');
  assert.equal(settings.settlePreviousMonthUntilDay, 0);
  // The rest stays as every new company gets it.
  assert.equal(settings.commissionMode, DEFAULT_ORGANIZATION_SETTINGS.commissionMode);
  assert.equal(settings.vaDeductsFromCommission, DEFAULT_ORGANIZATION_SETTINGS.vaDeductsFromCommission);
});

test('fortnightly: the usual Q1/Q2 split, month of the batch', async () => {
  const id = await newCompany('quinzenal');
  assert.equal(await createInitialSettings(id, 'fortnightly', owner), 'fortnightly');
  const settings = await getOrganizationSettings(id);
  assert.deepEqual(settings.periodCutDays, [15]);
  assert.equal(settings.competenceSource, 'batch');
});

test('no preset keeps the defaults', async () => {
  const id = await newCompany('nenhum');
  assert.equal(await createInitialSettings(id, null, owner), null);
  const settings = await getOrganizationSettings(id);
  assert.deepEqual(settings.periodCutDays, DEFAULT_ORGANIZATION_SETTINGS.periodCutDays);
  assert.equal(settings.competenceSource, DEFAULT_ORGANIZATION_SETTINGS.competenceSource);
});

test('repeating the step does not overwrite what the admin changed afterwards', async () => {
  const id = await newCompany('repetir');
  await createInitialSettings(id, 'monthly', owner);
  await saveOrganizationSettings(id, { ...(await getOrganizationSettings(id)), periodCutDays: [10, 20], settlePreviousMonthUntilDay: 5 }, owner);
  assert.equal(await createInitialSettings(id, 'monthly', owner), null, 'the row already exists: nothing is applied');
  const settings = await getOrganizationSettings(id);
  assert.deepEqual(settings.periodCutDays, [10, 20]);
  assert.equal(settings.settlePreviousMonthUntilDay, 5);
});

test('creating a company rejects an unknown preset and remembers a valid one', async () => {
  const slug = `zz-preset-api-${stamp}`;
  const input = { name: 'Teste preset api', slug, admin: { name: 'Admin Teste', email: `${slug}@example.test` } };
  await assert.rejects(() => createOrganization({ ...input, payPreset: 'weekly' }, { id: owner }), /Forma de pagamento inicial/);
  const organization = await createOrganization({ ...input, payPreset: 'monthly' }, { id: owner });
  created.push(organization.id);
  const [row] = await sql`SELECT pay_preset FROM organization_provisioning WHERE organization_id = ${organization.id}`;
  assert.equal(row.pay_preset, 'monthly');
});

after(async () => {
  for (const id of created) await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${id}`;
});
