// Run with: node scripts/test-vehicles-flow.cjs
// The Carros app against the development database, on a test company of its own ("zz-vehicles-*"): adding a car,
// handing it to a technician, the history, isolation between companies, soft delete. The test company is removed
// for good at the end (it never leaves rows behind).
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
const store = require('../lib/vehicles/store.ts');
const rules = require('../lib/vehicles/rules.ts');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const orgs = [];
let actor;
let other;
let ana;
let bruno;
let inactive;

const newOrg = async (suffix) => {
  const id = (await sql`INSERT INTO organizations (slug, name, status) VALUES (${`zz-vehicles-${stamp}${suffix}`}, 'Teste carros', 'active') RETURNING id`)[0].id;
  orgs.push(id);
  return id;
};
const technician = async (org, name, status = 'active') =>
  (await sql`INSERT INTO technicians (organization_id, name, email, status) VALUES (${org}, ${name}, ${`${name.toLowerCase()}-${stamp}@exemplo.com`}, ${status}) RETURNING id`)[0].id;
const create = (input, technicianId = null, who = actor) =>
  store.createVehicle(who, rules.parseVehicleInput({ model: 'Strada', ...input }).value, technicianId);
const fleet = async (who = actor) => (await store.loadFleet(who.organizationId)).vehicles;
const rejects = async (promise, status, message) => {
  await assert.rejects(promise, (error) => error instanceof store.VehicleError && error.status === status && message.test(error.message));
};

test('setup: two test companies, technicians, and an actor for each', { skip: !hasDatabase }, async () => {
  const orgA = await newOrg('a');
  const orgB = await newOrg('b');
  actor = { organizationId: orgA, userId: null, role: 'admin', impersonationId: null };
  other = { organizationId: orgB, userId: null, role: 'admin', impersonationId: null };
  ana = await technician(orgA, 'Ana');
  bruno = await technician(orgA, 'Bruno');
  inactive = await technician(orgA, 'Inativo', 'inactive');
});

test('a car is added with its data, without a technician', { skip: !hasDatabase }, async () => {
  const id = await create({ plate: 'abc-1d23', brand: 'Fiat', year: 2023, licensingDue: '2027-01-31', odometer: 12000 });
  const [car] = await fleet();
  assert.deepEqual([car.id, car.plate, car.model, car.year, car.licensingDue, car.odometer, car.technicianId], [id, 'ABC1D23', 'Strada', 2023, '2027-01-31', 12000, null]);
});

test('the same plate cannot be used twice in a company, but can in another one', { skip: !hasDatabase }, async () => {
  await rejects(create({ plate: 'ABC1D23' }), 409, /placa/);
  await create({ plate: 'ABC1D23' }, null, other);
  assert.equal((await fleet(other)).length, 1);
});

test('handing a car to a technician records the history and moving it closes the previous stretch', { skip: !hasDatabase }, async () => {
  const [car] = await fleet();
  await store.updateVehicle(actor, car.id, {}, ana);
  assert.equal((await fleet())[0].technicianName, 'Ana');
  await store.updateVehicle(actor, car.id, { odometer: 12500 }, bruno);
  const now = (await fleet())[0];
  assert.deepEqual([now.technicianName, now.odometer], ['Bruno', 12500]);
  const history = await store.vehicleHistory(actor.organizationId, car.id);
  assert.deepEqual(history.map((row) => [row.technicianName, row.releasedAt === null]), [['Bruno', true], ['Ana', false]]);
  await store.updateVehicle(actor, car.id, {}, bruno);
  assert.equal((await store.vehicleHistory(actor.organizationId, car.id)).length, 2, 'giving it to the same technician again changes nothing');
});

test('an edit without technicianId keeps the technician; null takes the car back', { skip: !hasDatabase }, async () => {
  const [car] = await fleet();
  await store.updateVehicle(actor, car.id, { color: 'Branco', notes: null }, undefined);
  const edited = (await fleet())[0];
  assert.deepEqual([edited.color, edited.technicianName, edited.model], ['Branco', 'Bruno', 'Strada']);
  await store.updateVehicle(actor, car.id, {}, null);
  const free = (await fleet())[0];
  assert.equal(free.technicianId, null);
  assert.equal((await store.vehicleHistory(actor.organizationId, car.id))[0].releasedAt !== null, true);
});

test('only an active technician of the same company can have a car', { skip: !hasDatabase }, async () => {
  const [car] = await fleet();
  const stranger = await technician(other.organizationId, 'Estranho');
  await rejects(store.updateVehicle(actor, car.id, {}, inactive), 400, /técnico ativo/);
  await rejects(store.updateVehicle(actor, car.id, {}, stranger), 400, /técnico ativo/);
  await rejects(create({ plate: 'XYZ9K88' }, stranger), 400, /técnico ativo/);
  assert.equal((await fleet()).length, 1, 'the refused car was not created');
});

test('a company never sees or touches the cars of another', { skip: !hasDatabase }, async () => {
  const [mine] = await fleet();
  const [theirs] = await fleet(other);
  await rejects(store.updateVehicle(other, mine.id, { color: 'Preto' }, undefined), 404, /não encontrado/);
  await rejects(store.removeVehicle(other, mine.id), 404, /não encontrado/);
  await rejects(store.vehicleHistory(other.organizationId, mine.id), 404, /não encontrado/);
  assert.notEqual(theirs.id, mine.id);
  assert.equal((await fleet())[0].color, 'Branco');
});

test('removing a car is a soft delete: it leaves the list, frees the plate and keeps the history', { skip: !hasDatabase }, async () => {
  const [car] = await fleet();
  await store.updateVehicle(actor, car.id, {}, ana);
  await store.removeVehicle(actor, car.id);
  assert.equal((await fleet()).length, 0);
  const [row] = await sql`SELECT deleted_at, technician_id FROM vehicles WHERE id = ${car.id}`;
  assert.ok(row.deleted_at);
  assert.equal(row.technician_id, null);
  const open = await sql`SELECT 1 FROM vehicle_assignments WHERE vehicle_id = ${car.id} AND released_at IS NULL`;
  assert.equal(open.length, 0, 'nobody is left holding a removed car');
  await create({ plate: 'ABC1D23' });
  assert.equal((await fleet()).length, 1, 'the plate is free again');
});

after(async () => {
  if (!orgs.length) return;
  for (const table of ['audit_events', 'vehicle_assignments', 'vehicles', 'technicians']) {
    await sql.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  }
  await sql`DELETE FROM organizations WHERE id = ANY(${orgs}::uuid[])`;
});
