// Run with: node scripts/test-services-inactive-flow.cjs
// Needs the development database (.env). On a test company of its own ("zz-teste-inativos"): the admin's OS list
// (app/api/services/route.ts) leaves out the OS of inactive technicians, says how many it left out (`withHidden`),
// shows them when asked (`includeInactive`), and the bulk delete only touches the OS of active technicians.
// At the end purge it for real: node scripts/purge-test-orgs.mjs --apply (after purge-test-blobs.mjs --apply).
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
const auth = require('../lib/auth.ts');
const servicesRoute = require('../app/api/services/route.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-inativos';
let org;
let admin;
let active;
let inactive;
let token;

const get = async (query = '') => {
  const response = await servicesRoute.GET(new Request(`http://nextrotta.test/api/services${query}`, { headers: { cookie: `auth-token=${token}` } }));
  return { status: response.status, data: await response.json() };
};

const insertService = (code, technician, date) => sql`
  INSERT INTO services (organization_id, order_code, technician_id, service_type, value, date_performed, time_performed, competence_month)
  VALUES (${org}, ${code}, ${technician.id}, 'Eletrica', 100, ${date}, '10:00', ${date.slice(0, 7)})`;

test('setup: a test company with an admin, an active and an inactive technician', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status, is_test) VALUES (${SLUG}, 'Teste inativos', 'active', true) RETURNING id`)[0].id;
  await sql`UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = ${org}`;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;

  const email = `${SLUG}@example.test`;
  admin = (await sql`SELECT id, email FROM users WHERE email = ${email}`)[0];
  if (!admin) admin = (await sql`INSERT INTO users (organization_id, email, name, password_hash, role) VALUES (${org}, ${email}, 'Admin inativos', 'x', 'admin') RETURNING id, email`)[0];
  await sql`UPDATE users SET status = 'active', deleted_at = NULL, organization_id = ${org} WHERE id = ${admin.id}`;

  const technician = async (qra, name, status) => {
    const found = (await sql`SELECT id FROM technicians WHERE organization_id = ${org} AND qra = ${qra}`)[0];
    const id = found?.id ?? (await sql`INSERT INTO technicians (organization_id, qra, name) VALUES (${org}, ${qra}, ${name}) RETURNING id`)[0].id;
    await sql`UPDATE technicians SET status = ${status}, deleted_at = NULL WHERE id = ${id}`;
    return { id };
  };
  active = await technician('ZZ-ATIVO', 'Tecnico Ativo', 'active');
  inactive = await technician('ZZ-INATIVO', 'Tecnico Inativo', 'inactive');
  token = await auth.createToken({ userId: admin.id, email: admin.email, role: 'admin', organizationId: org, organizationSlug: SLUG });

  await insertService('ZZA-1', active, '2026-10-05');
  await insertService('ZZA-2', active, '2026-11-05');
  await insertService('ZZI-1', inactive, '2026-10-06');
  await insertService('ZZI-2', inactive, '2026-10-07');
  await insertService('ZZI-3', inactive, '2026-09-30');
});

test('the plain list leaves out the OS of the inactive technician and does not count them', async () => {
  const { status, data } = await get();
  assert.equal(status, 200);
  assert.deepEqual(data.services.map((service) => service.order_code).sort(), ['ZZA-1', 'ZZA-2']);
  assert.equal(data.hiddenInactive, undefined);
});

test('withHidden tells how many OS the list leaves out', async () => {
  const { data } = await get('?withHidden=1');
  assert.deepEqual(data.services.map((service) => service.order_code).sort(), ['ZZA-1', 'ZZA-2']);
  assert.equal(data.hiddenInactive, 3);
});

test('includeInactive shows them, each with the status of its technician', async () => {
  const { data } = await get('?includeInactive=1&withHidden=1');
  assert.deepEqual(data.services.map((service) => service.order_code).sort(), ['ZZA-1', 'ZZA-2', 'ZZI-1', 'ZZI-2', 'ZZI-3']);
  assert.equal(data.hiddenInactive, undefined, 'nothing is hidden, so nothing to count');
  const byCode = Object.fromEntries(data.services.map((service) => [service.order_code, service.technician_status]));
  assert.deepEqual([byCode['ZZA-1'], byCode['ZZI-1']], ['active', 'inactive']);
});

test('an archived technician stays out even when inactive ones are included', async () => {
  await sql`UPDATE technicians SET deleted_at = NOW() WHERE id = ${inactive.id}`;
  const { data } = await get('?includeInactive=1');
  assert.deepEqual(data.services.map((service) => service.order_code).sort(), ['ZZA-1', 'ZZA-2']);
  await sql`UPDATE technicians SET deleted_at = NULL WHERE id = ${inactive.id}`;
});

test('a technician session never gets the inactive technicians, whatever it asks for', async () => {
  const techUser = (await sql`SELECT id, email FROM users WHERE organization_id = ${org} AND role = 'technician' LIMIT 1`)[0]
    ?? (await sql`INSERT INTO users (organization_id, email, name, password_hash, role) VALUES (${org}, ${`${SLUG}-tec@example.test`}, 'Tecnico', 'x', 'technician') RETURNING id, email`)[0];
  await sql`UPDATE technicians SET user_id = ${techUser.id} WHERE id = ${active.id}`;
  const techToken = await auth.createToken({ userId: techUser.id, email: techUser.email, role: 'technician', organizationId: org, organizationSlug: SLUG });
  const response = await servicesRoute.GET(new Request(`http://nextrotta.test/api/services?technicianId=${inactive.id}&includeInactive=1&withHidden=1`, { headers: { cookie: `auth-token=${techToken}` } }));
  const data = await response.json();
  // A technician only ever sees their own OS: the id in the request is replaced by their own.
  assert.deepEqual((data.services ?? []).map((service) => service.order_code).sort(), ['ZZA-1', 'ZZA-2']);
  assert.equal(data.hiddenInactive, undefined);
});

test('the bulk delete only touches the OS of active technicians', async () => {
  const response = await servicesRoute.DELETE(new Request('http://nextrotta.test/api/services?mode=bulk&competenceMonth=2026-10&period=monthly&confirmation=DELETAR%20OS', {
    method: 'DELETE',
    headers: { cookie: `auth-token=${token}` },
  }));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.deleted, 1, 'only ZZA-1 (October, active technician)');
  const left = await sql`SELECT order_code FROM services WHERE organization_id = ${org} AND deleted_at IS NULL ORDER BY order_code`;
  assert.deepEqual(left.map((row) => row.order_code), ['ZZA-2', 'ZZI-1', 'ZZI-2', 'ZZI-3']);
});

after(async () => {
  if (!org) return;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
