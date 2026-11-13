// Run with: node scripts/test-benefit-rules-flow.cjs
// Needs the development database (.env). On a test company of its own ("zz-teste-vales", left archived): the folha the server
// calculates (lib/payroll-utils.ts, the same function the Folha screen and the preview call) follows the company's voucher
// rules. A technician with salary 2.047, VR 500, who takes 100% of the production:
//   - the original rule (VR deducts): commission = production - 2.047 - 500;
//   - VR paid apart and not deducting: commission = production - 2.047;
//   - production under the salary: no commission, the salary stays, and the advance comes off it (2.047 - 1.500 = 547).
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
const { saveOrganizationSettings } = require('../lib/organization-settings-store.ts');
const { calculatePayroll } = require('../lib/payroll-utils.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-vales';
const MONTH = '2026-10';
let org;
let admin;
let tech;

const configure = (changes) => saveOrganizationSettings(org, { ...DEFAULT_ORGANIZATION_SETTINGS, commissionMode: 'excess', ...changes }, admin.id);
const addService = (code, value) => sql`
  INSERT INTO services (organization_id, order_code, technician_id, service_type, value, date_performed, competence_month)
  VALUES (${org}, ${`${code}-${Date.now()}`}, ${tech}, 'Eletrica', ${value}, '2026-10-10', ${MONTH})
`;
const folha = () => calculatePayroll({ organizationId: org, technicianId: tech, competenceMonth: MONTH });

test('setup: a test company, a technician (salary 2.047, VR 500, 100%) and 3.000 of production', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste vales', 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = ${org}`;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  const email = `${SLUG}@example.test`;
  admin = (await sql`SELECT id FROM users WHERE email = ${email}`)[0]
    ?? (await sql`INSERT INTO users (organization_id, email, name, password_hash, role) VALUES (${org}, ${email}, 'Admin vales', 'x', 'admin') RETURNING id`)[0];
  const found = (await sql`SELECT id FROM technicians WHERE organization_id = ${org} AND qra = 'ZZ-VALES'`)[0];
  tech = found?.id ?? (await sql`INSERT INTO technicians (organization_id, qra, name) VALUES (${org}, 'ZZ-VALES', 'Tecnico Vales') RETURNING id`)[0].id;
  await sql`UPDATE technicians SET status = 'active', deleted_at = NULL, commission_percentage = 100, base_salary = 2047, vr_allowance = 500, va_allowance = 0 WHERE id = ${tech}`;
  for (const code of ['a', 'b', 'c']) await addService(code, 1000);
});

test('the original rule: the VR is a fixed cost and comes off the commission', async () => {
  await configure({});
  const result = await folha();
  assert.equal(result.total_services_value, 3000);
  assert.equal(result.vr_deduction, 500);
  assert.equal(result.commission_value, 453, '3.000 - 2.047 - 500');
  assert.equal(result.net_total, 2047 + 453, 'salary + commission: the VR is paid on the card, outside this amount');
});

test('VR paid apart and not deducting: the commission is the production over the salary only', async () => {
  await configure({ vrDeductsFromCommission: false, vrPayment: 'cash' });
  const result = await folha();
  assert.equal(result.commission_value, 953, '3.000 - 2.047');
  assert.equal(result.net_total, 3000, 'the technician takes the whole production');
  assert.equal(result.vr_deduction, 500, 'the VR is still on the folha, as a cost paid in cash apart');
});

test('VA deducting while VR does not: each voucher follows its own rule', async () => {
  await sql`UPDATE technicians SET va_allowance = 300 WHERE id = ${tech}`;
  await configure({ vrDeductsFromCommission: false });
  assert.equal((await folha()).commission_value, 953 - 300, 'the VA still comes off: 3.000 - 2.047 - 300');
  await configure({ vaDeductsFromCommission: false, vrDeductsFromCommission: false });
  assert.equal((await folha()).commission_value, 953);
  await sql`UPDATE technicians SET va_allowance = 0 WHERE id = ${tech}`;
});

test('production under the salary: no commission, the salary stays', async () => {
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await addService('d', 1500);
  await configure({ vrDeductsFromCommission: false, vrPayment: 'cash' });
  const result = await folha();
  assert.equal(result.commission_value, 0);
  assert.equal(result.net_total, 2047, 'the salary; an advance of 1.500 leaves 547 (see test-payroll-rules)');
});

test('the other commission modes never deduct, whatever the switch says', async () => {
  await configure({ commissionMode: 'percentage', vrDeductsFromCommission: true });
  assert.equal((await folha()).commission_value, 1500, '100% of 1.500');
});

after(async () => {
  if (!org) return;
  await configure({}).catch(() => {});
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
