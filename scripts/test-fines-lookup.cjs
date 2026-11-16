// Run with: node scripts/test-fines-lookup.cjs
// The automatic lookup of fines: how the provider's answers are read (no database), and the weekly round against the
// development database on test companies of their own ("zz-lookup-*"), with a fake provider (nothing is ever called for real).
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
const provider = require('../lib/vehicles/fines-provider.ts');
const sync = require('../lib/vehicles/fines-sync.ts');
const vehicles = require('../lib/vehicles/store.ts');
const carRules = require('../lib/vehicles/rules.ts');

const hasDatabase = Boolean(process.env.DATABASE_URL);

// ------------------------------------------------------------------------------------------------ reading the answers

test('dates from the provider are read as Brasília time', () => {
  assert.equal(provider.parseProviderDate('16/11/2026 14:30'), '2026-11-16T17:30:00.000Z');
  assert.equal(provider.parseProviderDate('16/11/2026 14:30:15'), '2026-11-16T17:30:15.000Z');
  assert.equal(provider.parseProviderDate('2026-11-16 14:30:00'), '2026-11-16T17:30:00.000Z');
  assert.equal(provider.parseProviderDate('2026-11-16T14:30:00Z'), '2026-11-16T14:30:00.000Z');
  assert.equal(provider.parseProviderDate('2026-11-16T14:30:00-03:00'), '2026-11-16T17:30:00.000Z');
  assert.equal(provider.parseProviderDate('16/11/2026'), '2026-11-16T15:00:00.000Z', 'a date alone means midday');
  assert.equal(provider.parseProviderDate('ontem'), null);
  assert.equal(provider.parseProviderDate(''), null);
});

test('the Detran-MS answer becomes our fines', () => {
  const { sources } = provider.sourcesFor('MS');
  assert.deepEqual(sources.map((source) => source.key), ['detran-ms', 'prf']);
  const fines = sources[0].parse({
    quantidade_multas: 2,
    multas: [
      { auto: 'ms123', datahora: '10/11/2026 09:15', descricao_infracao: 'Excesso de velocidade', local: 'BR-163 km 10', municipio: 'Campo Grande', valor: 'R$ 130,16', normalizado_valor: 130.16, pontos: '4' },
      { auto: '', descricao_infracao: 'sem número' },
    ],
  });
  assert.deepEqual(fines, [
    { ait: 'MS123', infractionAt: '2026-11-10T12:15:00.000Z', description: 'Excesso de velocidade', amount: 130.16, points: 4, location: 'BR-163 km 10 - Campo Grande', authority: 'Detran-MS', paymentDue: null },
  ]);
  assert.deepEqual(sources[0].parse({ multas: [] }), [], 'no fines is an empty list');
  assert.deepEqual(sources[0].parse({}), []);
});

test('the PRF answer becomes our fines, with the amount still owed and the boleto due date', () => {
  const prf = provider.sourcesFor('RJ').sources[0];
  assert.equal(prf.key, 'prf');
  const [fine] = prf.parse({ infracoes: [{ ait: 'P999', datahora: '2026-11-01 08:00:00', local: 'BR-116', descricao: 'Estacionar em local proibido', valor: '195,23', valor_devido: '195,23', pontos: 5, boleto_vencimento: '30/11/2026' }] });
  assert.deepEqual(fine, { ait: 'P999', infractionAt: '2026-11-01T11:00:00.000Z', description: 'Estacionar em local proibido', amount: 195.23, points: 5, location: 'BR-116', authority: 'PRF', paymentDue: '2026-11-30' });
});

test('a state without its Detran integrated is looked up only on the federal highways', () => {
  const result = provider.sourcesFor('SP');
  assert.deepEqual([result.sources.map((source) => source.key), result.detranCovered], [['prf'], false]);
  assert.equal(provider.sourcesFor('ms').detranCovered, true, 'the state is read in any case');
});

test('the provider call sends the token and the car, reads the answer and never leaks the token in a failure', async () => {
  const calls = [];
  const answer = (body, status = 200) => async (url, init) => {
    calls.push({ url, body: String(init.body) });
    return { status, json: async () => body };
  };
  const car = { plate: 'ABC1D23', renavam: '12345678901', state: 'MS' };
  const source = provider.sourcesFor('MS').sources[0];

  const ok = await provider.createProviderFetcher('SEGREDO', answer({ code: 200, data: [{ multas: [{ auto: 'A1', datahora: '10/11/2026 09:00', valor: '100,00' }] }] }))(source, car);
  assert.equal(ok.ok, true);
  assert.equal(ok.fines.length, 1);
  assert.match(calls[0].url, /\/consultas\/detran\/ms\/multas$/);
  const sent = new URLSearchParams(calls[0].body);
  assert.deepEqual([sent.get('token'), sent.get('placa'), sent.get('renavam')], ['SEGREDO', 'ABC1D23', '12345678901']);

  const refused = await provider.createProviderFetcher('SEGREDO', answer({ code: 612, code_message: 'Renavam não encontrado' }))(source, car);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Renavam não encontrado/);
  assert.doesNotMatch(refused.message, /SEGREDO/);

  const broken = await provider.createProviderFetcher('SEGREDO', async () => { throw new Error('boom SEGREDO'); })(source, car);
  assert.equal(broken.ok, false);
  assert.doesNotMatch(broken.message, /SEGREDO|boom/);

  const garbage = await provider.createProviderFetcher('SEGREDO', async () => ({ status: 502, json: async () => { throw new Error('html'); } }))(source, car);
  assert.equal(garbage.ok, false);
  assert.match(garbage.message, /inesperada/);
});

// ------------------------------------------------------------------------------------------------------ the weekly round

const stamp = Date.now();
const orgs = [];
let actor;
let ana;
let carMs;
let carNoData;

const newOrg = async (suffix) => {
  const id = (await sql`INSERT INTO organizations (slug, name, status) VALUES (${`zz-lookup-${stamp}${suffix}`}, 'Teste consulta', 'active') RETURNING id`)[0].id;
  orgs.push(id);
  return id;
};
const fines = async () => sql`SELECT ait_number, technician_id, source, amount, payment_due::text AS payment_due FROM vehicle_fines WHERE organization_id = ${actor.organizationId} AND deleted_at IS NULL ORDER BY ait_number`;
const car = async (id) => (await sql`SELECT fines_checked_at, fines_check_status, fines_check_message FROM vehicles WHERE id = ${id}`)[0];

// A fake provider: what each source answers is set by the test; every call is counted (each one costs money for real).
let calls = [];
let answers = {};
const fetcher = async (source, target) => {
  calls.push(`${source.key}:${target.plate}`);
  return answers[source.key] ?? { ok: true, fines: [] };
};
const msFine = { ait: 'MS100', infractionAt: '2026-10-20T12:00:00.000Z', description: 'Excesso de velocidade', amount: 130.16, points: 4, location: 'BR-163', authority: 'Detran-MS', paymentDue: null };

test('setup: a company with a car that has its data, one that does not, and a history that names the driver', { skip: !hasDatabase }, async () => {
  const org = await newOrg('a');
  actor = { organizationId: org, userId: null, role: 'admin', impersonationId: null };
  ana = (await sql`INSERT INTO technicians (organization_id, name, email, status) VALUES (${org}, 'Ana', ${`ana-${stamp}@exemplo.com`}, 'active') RETURNING id`)[0].id;
  carMs = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'ABC1D23', renavam: '12345678901', state: 'ms' }).value, null);
  carNoData = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'XYZ9K88' }).value, null);
  await sql`INSERT INTO vehicle_assignments (organization_id, vehicle_id, technician_id, assigned_at, released_at) VALUES (${org}, ${carMs}, ${ana}, '2026-09-01T12:00:00Z', '2026-11-01T12:00:00Z')`;
});

test('new fines are registered on their own with the driver from the history; cars without data are flagged, not billed', { skip: !hasDatabase }, async () => {
  answers = { 'detran-ms': { ok: true, fines: [msFine] } };
  const summary = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-11-16', minIntervalMinutes: sync.SCHEDULED_INTERVAL_MINUTES });
  assert.deepEqual([summary.cars, summary.created, summary.failed], [1, 1, 0]);
  assert.deepEqual(calls, ['detran-ms:ABC1D23', 'prf:ABC1D23'], 'the Detran and the federal highways, once each; the car without data is not asked');
  const [fine] = await fines();
  assert.deepEqual([fine.ait_number, fine.technician_id, fine.source, Number(fine.amount)], ['MS100', ana, 'auto', 130.16]);
  assert.equal((await car(carMs)).fines_check_status, 'ok');
  assert.equal((await car(carNoData)).fines_check_status, 'missing_data');
  const notice = await sql`SELECT title FROM notifications WHERE organization_id = ${actor.organizationId} AND dedupe_key LIKE 'fleet:found:%'`;
  assert.equal(notice.length, 1);
});

test('looking up again within the week asks nobody and pays nothing; a fine already known is never registered twice', { skip: !hasDatabase }, async () => {
  calls = [];
  const again = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-11-17', minIntervalMinutes: sync.SCHEDULED_INTERVAL_MINUTES });
  assert.deepEqual([again.cars, again.skipped, calls.length], [0, 1, 0]);

  await sql`UPDATE vehicles SET fines_checked_at = NOW() - INTERVAL '8 days' WHERE id = ${carMs}`;
  const next = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-11-24', minIntervalMinutes: sync.SCHEDULED_INTERVAL_MINUTES });
  assert.deepEqual([next.cars, next.created], [1, 0], 'a week later the same fine is not duplicated');
  assert.equal((await fines()).length, 1);
});

test('a fine the company removed is not brought back by the next lookup', { skip: !hasDatabase }, async () => {
  await sql`UPDATE vehicle_fines SET deleted_at = NOW() WHERE organization_id = ${actor.organizationId}`;
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE id = ${carMs}`;
  const result = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-11-25', minIntervalMinutes: sync.SCHEDULED_INTERVAL_MINUTES });
  assert.equal(result.created, 0);
  assert.equal((await fines()).length, 0);
});

test('a failed lookup is recorded and tried again next round; a partial one is kept', { skip: !hasDatabase }, async () => {
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE id = ${carMs}`;
  answers = { 'detran-ms': { ok: false, message: 'Detran-MS: fora do ar (código 600).' }, prf: { ok: false, message: 'PRF: fora do ar.' } };
  const failed = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-12-01', minIntervalMinutes: sync.SCHEDULED_INTERVAL_MINUTES });
  assert.equal(failed.failed, 1);
  const row = await car(carMs);
  assert.deepEqual([row.fines_check_status, row.fines_checked_at], ['error', null], 'not marked as checked, so the next round tries again');
  assert.match(row.fines_check_message, /fora do ar/);

  answers = { 'detran-ms': { ok: true, fines: [{ ...msFine, ait: 'MS200' }] }, prf: { ok: false, message: 'PRF: fora do ar.' } };
  const partial = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-12-01', minIntervalMinutes: sync.SCHEDULED_INTERVAL_MINUTES });
  assert.deepEqual([partial.created, partial.failed], [1, 0]);
  assert.equal((await car(carMs)).fines_check_status, 'partial');
});

test('"consultar agora" stops at the limit and says more is waiting', { skip: !hasDatabase }, async () => {
  const second = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'DEF2G34', renavam: '98765432109', state: 'RJ' }).value, null);
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE organization_id = ${actor.organizationId}`;
  answers = {};
  const result = await sync.lookupOrganization(actor.organizationId, fetcher, { today: '2026-12-02', minIntervalMinutes: 30, maxCars: 1 });
  assert.deepEqual([result.cars, result.limited], [1, true]);
  assert.equal((await car(second)).fines_checked_at, null, 'the second car (by plate) is still waiting');
});

test('the round only reaches companies the owner granted the lookup to, and does nothing without the provider set up', { skip: !hasDatabase }, async () => {
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE organization_id = ${actor.organizationId}`;
  calls = [];
  const before = process.env.INFOSIMPLES_TOKEN;
  delete process.env.INFOSIMPLES_TOKEN;
  assert.equal((await sync.runFineLookups('2026-12-03')).configured, false, 'no token, no provider');

  const notGranted = await sync.runFineLookups('2026-12-03', fetcher);
  assert.equal(notGranted.configured, true);
  assert.equal(calls.length, 0, 'the company has no grant: nothing is asked (and nothing is paid)');

  const [{ ok }] = await sql`SELECT COUNT(*)::int AS ok FROM features WHERE key = ${sync.FINES_LOOKUP_FEATURE} AND scope = 'custom'`;
  assert.equal(ok, 1, 'the feature exists as a custom one');
  await sql`INSERT INTO organization_features (organization_id, feature_key) VALUES (${actor.organizationId}, ${sync.FINES_LOOKUP_FEATURE})`;
  const granted = await sync.runFineLookups('2026-12-03', fetcher);
  assert.ok(granted.companies >= 1);
  assert.ok(calls.length > 0, 'a granted company is looked up');
  if (before) process.env.INFOSIMPLES_TOKEN = before;
});

after(async () => {
  if (!orgs.length) return;
  for (const table of ['audit_events', 'notifications', 'organization_features', 'vehicle_fines', 'vehicle_assignments', 'vehicles', 'technicians']) {
    await sql.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  }
  await sql`DELETE FROM organizations WHERE id = ANY(${orgs}::uuid[])`;
});
