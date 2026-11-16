// Run with: node scripts/test-vehicle-fines-flow.cjs
// The fines of the Carros app against the development database, on test companies of their own ("zz-fines-*"):
// registering a fine, telling the driver, the driver's answer, progress until resolved, isolation between companies,
// soft delete and the bell. The test companies are removed for good at the end.
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
const vehicles = require('../lib/vehicles/store.ts');
const fines = require('../lib/vehicles/fines-store.ts');
const rules = require('../lib/vehicles/fines-rules.ts');
const carRules = require('../lib/vehicles/rules.ts');
const notices = require('../lib/vehicles/notices.ts');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const stamp = Date.now();
const orgs = [];
let actor;
let other;
let ana;
let bruno;
let car;
let otherCar;

const newOrg = async (suffix) => {
  const id = (await sql`INSERT INTO organizations (slug, name, status) VALUES (${`zz-fines-${stamp}${suffix}`}, 'Teste multas', 'active') RETURNING id`)[0].id;
  orgs.push(id);
  return id;
};
const technician = async (org, name) =>
  (await sql`INSERT INTO technicians (organization_id, name, email, status) VALUES (${org}, ${name}, ${`${name.toLowerCase()}-${stamp}@exemplo.com`}, 'active') RETURNING id`)[0].id;
const register = (extra = {}, who = actor, vehicleId = car) =>
  fines.createFine(who, rules.parseFineInput({ vehicleId, infractionAt: '2026-11-10T14:30', description: 'Excesso de velocidade', amount: '130,16', ...extra }).value);
const list = async (who = actor) => (await fines.loadFines(who.organizationId)).fines;
const find = async (id, who = actor) => (await list(who)).find((fine) => fine.id === id);
const rejects = async (promise, status, message) => {
  await assert.rejects(promise, (error) => error instanceof vehicles.VehicleError && error.status === status && message.test(error.message));
};

test('setup: two test companies, technicians, a car for each', { skip: !hasDatabase }, async () => {
  const orgA = await newOrg('a');
  const orgB = await newOrg('b');
  actor = { organizationId: orgA, userId: null, role: 'admin', impersonationId: null };
  other = { organizationId: orgB, userId: null, role: 'admin', impersonationId: null };
  ana = await technician(orgA, 'Ana');
  bruno = await technician(orgA, 'Bruno');
  car = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'ABC1D23' }).value, null);
  otherCar = await vehicles.createVehicle(other, carRules.parseVehicleInput({ plate: 'ABC1D23' }).value, null);
});

test('a fine is registered with its data and starts at "define the driver"', { skip: !hasDatabase }, async () => {
  const id = await register({ aitNumber: 'a123456', receivedOn: '2026-11-12', points: '4' });
  const fine = await find(id);
  assert.deepEqual(
    [fine.plate, fine.amount, fine.aitNumber, fine.points, fine.receivedOn, fine.indicationDeadline, fine.stage, fine.technicianId],
    ['ABC1D23', 130.16, 'A123456', 4, '2026-11-12', '2026-12-12', 'to_identify', null],
  );
  assert.equal(fine.infractionAt, '2026-11-10T17:30:00.000Z', 'the moment is Brasília time');
});

test('the same notification (AIT) cannot be registered twice in a company, but can in another one', { skip: !hasDatabase }, async () => {
  await rejects(register({ aitNumber: 'A123456' }), 409, /já está cadastrada/);
  await register({ aitNumber: 'A123456' }, other, otherCar);
  assert.equal((await list(other)).length, 1);
});

test('a fine only takes a car and a driver of its own company', { skip: !hasDatabase }, async () => {
  await rejects(register({}, actor, otherCar), 404, /Carro não encontrado/);
  const stranger = await technician(other.organizationId, 'Estranho');
  await rejects(register({ technicianId: stranger }), 400, /técnico da sua empresa/);
  assert.equal((await list()).length, 1, 'the refused fines were not created');
});

test('telling the driver needs a driver, then marks the fine as told', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await rejects(fines.notifyDriver(actor, fine.id), 400, /Defina o condutor/);
  await fines.updateFine(actor, fine.id, { technicianId: ana });
  assert.equal((await find(fine.id)).stage, 'to_notify');
  const result = await fines.notifyDriver(actor, fine.id);
  assert.equal(result.outcome, 'off', 'the WhatsApp notice is off by default');
  const told = await find(fine.id);
  assert.equal(told.stage, 'awaiting_ack');
  assert.ok(told.notifiedAt);
});

test('a technician only sees the fines he was told about, and never the internal notes', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await fines.updateFine(actor, fine.id, { notes: 'conversar com o RH' });
  const untold = await register({ aitNumber: 'B777', technicianId: ana });
  const mine = await fines.listMyFines(actor.organizationId, ana);
  assert.deepEqual(mine.map((item) => item.id), [fine.id], 'the fine not told yet stays hidden');
  assert.equal('notes' in mine[0], false);
  assert.equal(mine[0].status, 'to_answer');
  assert.deepEqual(await fines.listMyFines(actor.organizationId, bruno), []);
  assert.equal(await fines.technicianHasFleet(actor.organizationId, ana), true);
  assert.equal(await fines.technicianHasFleet(actor.organizationId, bruno), false);
  await fines.removeFine(actor, untold);
});

test('the driver answers; nobody else can answer for him', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await rejects(fines.respondToFine(actor.organizationId, null, bruno, fine.id, { stance: 'agrees', note: null }), 404, /não encontrada/);
  await fines.respondToFine(actor.organizationId, null, ana, fine.id, { stance: 'disputes', note: 'Eu estava de folga' });
  const answered = await find(fine.id);
  assert.deepEqual([answered.stage, answered.driverStance, answered.driverNote, answered.acknowledgedBy], ['to_indicate', 'disputes', 'Eu estava de folga', 'technician']);
  assert.equal((await fines.listMyFines(actor.organizationId, ana))[0].status, 'answered');
});

test('progress is recorded step by step until the fine is resolved', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await fines.updateFine(actor, fine.id, { indicated: true });
  assert.equal((await find(fine.id)).stage, 'to_pay');
  await fines.updateFine(actor, fine.id, { appealStatus: 'filed' });
  assert.equal((await find(fine.id)).stage, 'appeal');
  await fines.updateFine(actor, fine.id, { appealStatus: 'lost' });
  await fines.updateFine(actor, fine.id, { paid: true, paidOn: '2026-11-14' });
  const done = await find(fine.id);
  assert.deepEqual([done.stage, done.paidAt], ['resolved', '2026-11-14']);
  await fines.updateFine(actor, fine.id, { paid: false });
  assert.equal((await find(fine.id)).stage, 'to_pay', 'unmarking the payment reopens the fine');
  assert.equal((await fines.listMyFines(actor.organizationId, ana))[0].status, 'answered');
});

test('a new driver starts over: he has not been told yet', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await fines.updateFine(actor, fine.id, { technicianId: bruno });
  const changed = await find(fine.id);
  assert.deepEqual([changed.technicianName, changed.notifiedAt, changed.acknowledgedAt, changed.driverStance, changed.stage], ['Bruno', null, null, null, 'to_notify']);
  await fines.updateFine(actor, fine.id, { technicianId: bruno });
  assert.equal((await find(fine.id)).stage, 'to_notify', 'choosing the same driver again changes nothing');
});

test('the admin can mark the driver as aware on his behalf', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await fines.notifyDriver(actor, fine.id);
  await fines.updateFine(actor, fine.id, { acknowledged: true });
  const aware = await find(fine.id);
  assert.deepEqual([aware.acknowledgedBy, aware.stage], ['admin', 'to_pay']);
  await fines.updateFine(actor, fine.id, { acknowledged: false });
  assert.equal((await find(fine.id)).stage, 'awaiting_ack');
});

test('a company never sees or touches the fines of another', { skip: !hasDatabase }, async () => {
  const [mine] = await list();
  await rejects(fines.updateFine(other, mine.id, { notes: 'x' }), 404, /não encontrada/);
  await rejects(fines.removeFine(other, mine.id), 404, /não encontrada/);
  await rejects(fines.notifyDriver(other, mine.id), 404, /não encontrada/);
  assert.equal((await list(other)).some((fine) => fine.id === mine.id), false);
});

test('the bell reminds once a week, warns of a deadline running out and of licensing about to expire', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  const today = '2026-12-10'; // two days before the 12/12 deadline of the fine
  await fines.updateFine(actor, fine.id, { indicated: false }); // earlier steps had named the driver already
  await vehicles.updateVehicle(actor, car, { licensingDue: '2026-12-20' }, undefined);
  await notices.checkFleet(actor.organizationId, today);
  await notices.checkFleet(actor.organizationId, today);
  const keys = (await sql`SELECT dedupe_key, severity, archived_at FROM notifications WHERE organization_id = ${actor.organizationId} ORDER BY dedupe_key`).map((row) => row.dedupe_key);
  assert.deepEqual(keys, [`fleet:fines-check:2026-12-07`, `fleet:indicate:${fine.id}:soon`, `fleet:licensing:${car}:2026-12-20`], 'each warning once, even when the check runs twice');

  await fines.updateFine(actor, fine.id, { indicated: true });
  await vehicles.updateVehicle(actor, car, { licensingDue: '2027-12-20' }, undefined);
  await notices.checkFleet(actor.organizationId, today);
  const open = (await sql`SELECT dedupe_key FROM notifications WHERE organization_id = ${actor.organizationId} AND archived_at IS NULL`).map((row) => row.dedupe_key);
  assert.deepEqual(open, ['fleet:fines-check:2026-12-07'], 'naming the driver and renewing the licensing take their warnings off the bell');
});

test('removing a fine is a soft delete', { skip: !hasDatabase }, async () => {
  const [fine] = await list();
  await fines.removeFine(actor, fine.id);
  assert.equal((await list()).length, 0);
  const [row] = await sql`SELECT deleted_at FROM vehicle_fines WHERE id = ${fine.id}`;
  assert.ok(row.deleted_at);
  assert.deepEqual(await fines.listMyFines(actor.organizationId, bruno), []);
});

after(async () => {
  if (!orgs.length) return;
  for (const table of ['audit_events', 'notifications', 'vehicle_fines', 'vehicle_assignments', 'vehicles', 'technicians']) {
    await sql.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  }
  await sql`DELETE FROM organizations WHERE id = ANY(${orgs}::uuid[])`;
});
