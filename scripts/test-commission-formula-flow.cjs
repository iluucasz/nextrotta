// Run with: node scripts/test-commission-formula-flow.cjs
// Needs the development database (.env). On a test company of its own ("zz-teste-formula", left archived): the
// "Personalizado" commission goes through the real path: the formula is saved in organization_settings (jsonb), read
// back, and the folha the server calculates (lib/payroll-utils.ts) pays what the steps say. A technician with salary
// 2.000, VR 500, 30%, R$ 40 of his own per unit, and 3 OS of R$ 1.000.
// Everything the test writes is logically deleted at the end.
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
const { DEFAULT_ORGANIZATION_SETTINGS } = require('../lib/organization-settings.ts');
const { saveOrganizationSettings, getOrganizationSettings, forgetOrganizationSettings } = require('../lib/organization-settings-store.ts');
const { calculatePayroll } = require('../lib/payroll-utils.ts');
const f = require('../lib/commission-formula.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-formula';
const MONTH = '2026-10';
let org;
let admin;
let tech;

const src = (source) => ({ kind: 'source', source });
const num = (value) => ({ kind: 'number', value });
const configure = (changes) => saveOrganizationSettings(org, { ...DEFAULT_ORGANIZATION_SETTINGS, ...changes }, admin.id);
const folha = () => calculatePayroll({ organizationId: org, technicianId: tech, competenceMonth: MONTH });

test('setup: a test company, a technician (salary 2.000, VR 500, 30%, R$ 40) and 3 OS of R$ 1.000', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste formula', 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = ${org}`;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  const email = `${SLUG}@example.test`;
  admin = (await sql`SELECT id FROM users WHERE email = ${email}`)[0]
    ?? (await sql`INSERT INTO users (organization_id, email, name, password_hash, role) VALUES (${org}, ${email}, 'Admin formula', 'x', 'admin') RETURNING id`)[0];
  const found = (await sql`SELECT id FROM technicians WHERE organization_id = ${org} AND qra = 'ZZ-FORMULA'`)[0];
  tech = found?.id ?? (await sql`INSERT INTO technicians (organization_id, qra, name) VALUES (${org}, 'ZZ-FORMULA', 'Tecnico Formula') RETURNING id`)[0].id;
  await sql`UPDATE technicians SET status = 'active', deleted_at = NULL, commission_percentage = 30, commission_rate = 40, base_salary = 2000, vr_allowance = 500, va_allowance = 0 WHERE id = ${tech}`;
  for (const code of ['a', 'b', 'c']) {
    await sql`INSERT INTO services (organization_id, order_code, technician_id, service_type, value, date_performed, competence_month)
              VALUES (${org}, ${`${code}-${Date.now()}`}, ${tech}, 'Eletrica', 1000, '2026-10-10', ${MONTH})`;
  }
});

test('the formula is saved as jsonb and read back whole', async () => {
  const template = f.FORMULA_TEMPLATES.find((item) => item.id === 'tiers_os').build();
  const saved = await configure({ commissionMode: 'custom', commissionFormula: template });
  assert.deepEqual(saved.commissionFormula, template);
  forgetOrganizationSettings(org);
  const read = await getOrganizationSettings(org);
  assert.equal(read.commissionMode, 'custom');
  assert.deepEqual(read.commissionFormula, template);
});

test('tiers by OS: 3 OS at R$ 20 each', async () => {
  const result = await folha();
  assert.equal(result.commission_value, 60);
  assert.equal(result.details.commissionMode, 'custom');
  assert.equal(result.net_total, 2000 + 60);
});

test('the excess template pays what the fixed excess mode pays (30% of 3.000 = 900, less 2.000 and 500: nothing)', async () => {
  await configure({ commissionMode: 'custom', commissionFormula: f.FORMULA_TEMPLATES.find((item) => item.id === 'excess').build() });
  const custom = await folha();
  await configure({ commissionMode: 'excess' });
  const fixed = await folha();
  assert.equal(custom.commission_value, fixed.commission_value);
  assert.equal(custom.commission_value, 0);
});

test("the technician's own values reach the steps: R$ 40 × 3 OS, held by the company's cap", async () => {
  const perUnit = { steps: [{ id: 's1', label: 'Por OS', kind: 'multiply', of: src('services'), by: src('rate') }] };
  await configure({ commissionMode: 'custom', commissionFormula: perUnit });
  assert.equal((await folha()).commission_value, 120);
  await configure({ commissionMode: 'custom', commissionFormula: perUnit, commissionMaximum: 100 });
  assert.equal((await folha()).commission_value, 100);
  const byPercent = { steps: [{ id: 's1', label: 'Parte', kind: 'percent', of: src('production'), percent: src('percentage') }] };
  await configure({ commissionMode: 'custom', commissionFormula: byPercent });
  assert.equal((await folha()).commission_value, 900);
});

test('a condition: only after the goal', async () => {
  const goal = (limit) => ({
    steps: [
      { id: 's1', label: 'Parte', kind: 'percent', of: src('production'), percent: num(20) },
      { id: 's2', label: 'Comissão', kind: 'condition', left: src('production'), op: 'gte', right: num(limit), then: { kind: 'step', step: 's1' }, otherwise: num(0) },
    ],
  });
  await configure({ commissionMode: 'custom', commissionFormula: goal(3000) });
  assert.equal((await folha()).commission_value, 600);
  await configure({ commissionMode: 'custom', commissionFormula: goal(3001) });
  assert.equal((await folha()).commission_value, 0);
});

test('an empty formula cannot be saved as the way of paying (the API check), but pays 0 if it is already stored', async () => {
  const { parseOrganizationSettingsInput } = require('../lib/organization-settings.ts');
  const refused = parseOrganizationSettingsInput({ ...DEFAULT_ORGANIZATION_SETTINGS, commissionMode: 'custom', commissionFormula: { steps: [] } });
  assert.match(refused.error, /Cálculo personalizado/);
  await configure({ commissionMode: 'custom', commissionFormula: { steps: [] } });
  assert.equal((await folha()).commission_value, 0);
});

after(async () => {
  if (!org) return;
  await configure({ commissionMode: 'excess' }).catch(() => {});
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
