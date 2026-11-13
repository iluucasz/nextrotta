// Run with: node scripts/test-pay-calendar-flow.cjs
// Needs the development database (.env). On a test company of its own ("zz-teste-calendario", left archived): the OS import
// route (app/api/services/import/route.ts) in both ways a company can cut its months.
//   - by the service's date: each OS goes to the month of its own date (and the fortnight of its day), a repeated file adds
//     nothing, and an OS of a technician whose folha for that month is already closed is held back unless the admin allows it;
//   - by batch (the rule every company had before): the whole file takes the month and fortnight chosen for it.
// Everything the test writes is logically deleted at the end.
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
// The route imports "@/lib/...": the app's alias for the repository root.
const root = path.resolve(__dirname, '..');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...rest);
};

const { sql } = require('../lib/db.ts');
const auth = require('../lib/auth.ts');
const { DEFAULT_ORGANIZATION_SETTINGS } = require('../lib/organization-settings.ts');
const { saveOrganizationSettings } = require('../lib/organization-settings-store.ts');
const importRoute = require('../app/api/services/import/route.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-calendario';
const stamp = Date.now();
let org;
let admin;
let anna;
let bruno;
let token;

const setSource = (competenceSource) =>
  saveOrganizationSettings(org, { ...DEFAULT_ORGANIZATION_SETTINGS, competenceSource }, admin.id);

const row = (code, technician, date, value = 100) => ({
  order_code: `${code}-${stamp}`,
  technician_id: technician.id,
  service_type: 'Eletrica',
  value,
  date_performed: date,
  time_performed: '10:00',
});

const post = async (body) => {
  const response = await importRoute.POST(new Request('http://nextrotta.test/api/services/import', {
    method: 'POST',
    headers: { cookie: `auth-token=${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json() };
};

const stored = async (code) => (await sql`
  SELECT competence_month, fortnight_period, technician_id FROM services
  WHERE organization_id = ${org} AND order_code = ${`${code}-${stamp}`} AND deleted_at IS NULL
`)[0];

test('setup: a test company with an admin and two technicians', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste calendario', 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = ${org}`;
  // Start from a clean month: no folha closed and no OS left by an earlier run (or by someone testing the screens by hand).
  await sql`UPDATE payroll SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;

  const email = `${SLUG}@example.test`;
  admin = (await sql`SELECT id, email FROM users WHERE email = ${email}`)[0];
  if (!admin) admin = (await sql`INSERT INTO users (organization_id, email, name, password_hash, role) VALUES (${org}, ${email}, 'Admin calendario', 'x', 'admin') RETURNING id, email`)[0];
  await sql`UPDATE users SET status = 'active', deleted_at = NULL, organization_id = ${org} WHERE id = ${admin.id}`;

  const technician = async (qra, name) => {
    const found = (await sql`SELECT id FROM technicians WHERE organization_id = ${org} AND qra = ${qra}`)[0];
    const id = found?.id ?? (await sql`INSERT INTO technicians (organization_id, qra, name) VALUES (${org}, ${qra}, ${name}) RETURNING id`)[0].id;
    await sql`UPDATE technicians SET status = 'active', deleted_at = NULL WHERE id = ${id}`;
    return { id };
  };
  anna = await technician('ZZ-ANNA', 'Anna Teste');
  bruno = await technician('ZZ-BRUNO', 'Bruno Teste');
  token = await auth.createToken({ userId: admin.id, email: admin.email, role: 'admin', organizationId: org, organizationSlug: SLUG });
});

test('by the service date: one spreadsheet with three months fills each month, with the fortnight of its day', async () => {
  await setSource('service_date');
  // The batch month and fortnight sent by an old screen are ignored: the date of each OS decides.
  const { status, data } = await post({
    services: [row('sep', anna, '2026-09-30'), row('oct1', anna, '2026-10-07'), row('oct2', bruno, '2026-10-23'), row('nov', anna, '2026-11-03')],
    competence_month: '2026-10',
    fortnight_period: 'Q1',
  });
  assert.equal(status, 200);
  assert.equal(data.imported, 4);
  assert.deepEqual(data.rejected, []);

  const seen = [];
  for (const code of ['sep', 'oct1', 'oct2', 'nov']) {
    const saved = await stored(code);
    seen.push([code, saved.competence_month, saved.fortnight_period]);
  }
  assert.deepEqual(seen, [['sep', '2026-09', 'Q2'], ['oct1', '2026-10', 'Q1'], ['oct2', '2026-10', 'Q2'], ['nov', '2026-11', 'Q1']]);
});

test('by the service date: no month and no fortnight needed in the request', async () => {
  const { status, data } = await post({ services: [row('bare', anna, '2026-10-15')] });
  assert.equal(status, 200);
  assert.equal(data.imported, 1);
  const saved = await stored('bare');
  assert.deepEqual([saved.competence_month, saved.fortnight_period], ['2026-10', 'Q1']);
});

test('the same file again adds nothing', async () => {
  const again = await post({ services: [{ ...row('oct1', anna, '2026-10-07') }, { ...row('nov', anna, '2026-11-03') }] });
  assert.equal(again.data.imported, 0);
  assert.equal(again.data.rejected.length, 2);
  assert.match(again.data.rejected[0].errors[0], /já cadastrada/);
});

test('a date that does not exist is rejected, the rest of the file goes in', async () => {
  const { data } = await post({ services: [row('bad', anna, '2026-02-30'), row('good', bruno, '2026-11-10')] });
  assert.equal(data.imported, 1);
  assert.equal(data.rejected.length, 1);
  assert.equal((await stored('good')).competence_month, '2026-11');
});

test('a closed folha is held back: that technician\'s OS waits for the admin, the other technician\'s goes in', async () => {
  await sql`
    INSERT INTO payroll (organization_id, technician_id, competence_month, status)
    VALUES (${org}, ${anna.id}, '2026-10', 'closed')
    ON CONFLICT (technician_id, competence_month) DO UPDATE SET status = 'closed', deleted_at = NULL
  `;
  const { data } = await post({ services: [row('late-anna', anna, '2026-10-20'), row('late-bruno', bruno, '2026-10-20'), row('nov-anna', anna, '2026-11-20')] });
  assert.equal(data.imported, 2, 'Bruno (no closed folha) and Anna in November');
  assert.equal(data.rejected.length, 1);
  assert.match(data.rejected[0].errors[0], /folha de 10\/2026 deste técnico já está fechada/);
  assert.equal(await stored('late-anna'), undefined);
  assert.equal((await stored('late-bruno')).competence_month, '2026-10');
});

test('the admin can allow the closed folha: the OS is listed there, the folha itself is not recalculated', async () => {
  const { data } = await post({ services: [row('late-anna', anna, '2026-10-20')], allow_closed_payroll: true });
  assert.equal(data.imported, 1);
  assert.equal((await stored('late-anna')).competence_month, '2026-10');
  const [payroll] = await sql`SELECT status, total_services_value::float AS total FROM payroll WHERE technician_id = ${anna.id} AND competence_month = '2026-10'`;
  assert.deepEqual([payroll.status, payroll.total], ['closed', 0]);
});

test('by batch (the old rule): the whole file takes the month and fortnight chosen for it', async () => {
  await setSource('batch');
  const { status, data } = await post({
    services: [row('b-oct', anna, '2026-10-07'), row('b-nov', bruno, '2026-11-03')],
    competence_month: '2026-12',
    fortnight_period: 'Q2',
  });
  assert.equal(status, 200);
  assert.equal(data.imported, 2);
  for (const code of ['b-oct', 'b-nov']) {
    const saved = await stored(code);
    assert.deepEqual([saved.competence_month, saved.fortnight_period], ['2026-12', 'Q2'], code);
  }
});

test('by batch: a file without month or fortnight is still refused', async () => {
  const noFortnight = await post({ services: [row('x1', anna, '2026-10-07')], competence_month: '2026-10' });
  assert.equal(noFortnight.status, 400);
  assert.match(noFortnight.data.error, /Q1 ou Q2/);
  const noMonth = await post({ services: [row('x2', anna, '2026-10-07')], fortnight_period: 'Q1' });
  assert.equal(noMonth.status, 400);
  assert.match(noMonth.data.error, /competência/i);
  assert.equal(await stored('x1'), undefined);
});

test('by batch: a closed folha does not block the import (nothing changes for companies on the old rule)', async () => {
  const { data } = await post({ services: [row('b-closed', anna, '2026-10-21')], competence_month: '2026-10', fortnight_period: 'Q2' });
  assert.equal(data.imported, 1);
});

after(async () => {
  if (!org) return;
  await setSource('batch').catch(() => {});
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE payroll SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
