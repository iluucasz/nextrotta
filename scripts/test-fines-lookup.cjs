// Run with: node scripts/test-fines-lookup.cjs
// The automatic lookup of fines: how the provider's answers are read (no database), and the weekly round and the manual one against the
// development database on test companies of their own ("zz-lookup-*"), with a fake provider (nothing is ever called for real).
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
// The platform's real gov.br login must never reach a test: the tests that need one set a fake pair and put it back.
delete process.env.INFOSIMPLES_SP_CPF;
delete process.env.INFOSIMPLES_SP_SENHA;
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
const fineRules = require('../lib/vehicles/fines-rules.ts');
const statusRules = require('../lib/vehicles/status.ts');
const { brasiliaDateKey } = require('../lib/formatters.ts');

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

test('a Renavam is checked by its digit before a paid lookup is spent on it', () => {
  const { isValidRenavam } = carRules;
  assert.equal(isValidRenavam('639884962'), true, 'an old 9-digit Renavam');
  assert.equal(isValidRenavam('00639884962'), true);
  assert.equal(isValidRenavam('123.456.789-00'), true);
  assert.equal(isValidRenavam('12345678901'), false, 'the provider refused this one for its digit');
  assert.equal(isValidRenavam('1234'), false);
  assert.equal(isValidRenavam(''), false);
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
  const result = provider.sourcesFor('RJ');
  assert.deepEqual([result.sources.map((source) => source.key), result.detranCovered], [['prf'], false]);
  assert.equal(provider.sourcesFor('ms').detranCovered, true, 'the state is read in any case');
});

test('São Paulo is looked up in the Detran only when the platform has its gov.br login', () => {
  assert.deepEqual([provider.sourcesFor('SP').sources.map((source) => source.key), provider.sourcesFor('SP').detranCovered], [['prf'], false], 'no login: federal highways only, as before');
  process.env.INFOSIMPLES_SP_CPF = '123.456.789-09';
  process.env.INFOSIMPLES_SP_SENHA = 'fake-pass';
  try {
    assert.deepEqual(provider.govbrLogin(), { cpf: '12345678909', password: 'fake-pass' });
    const result = provider.sourcesFor('sp');
    assert.deepEqual([result.sources.map((source) => source.key), result.detranCovered], [['detran-sp', 'prf'], true]);
    const params = result.sources[0].params({ plate: 'ABC1D23', renavam: '12345678900', state: 'SP' });
    assert.deepEqual(params, { placa: 'ABC1D23', renavam: '12345678900', login_cpf: '12345678909', login_senha: 'fake-pass' });
    process.env.INFOSIMPLES_SP_CPF = '123';
    assert.equal(provider.govbrLogin(), null, 'a CPF that is not 11 digits is no login');
  } finally {
    delete process.env.INFOSIMPLES_SP_CPF;
    delete process.env.INFOSIMPLES_SP_SENHA;
  }
});

test('the Detran-SP answer becomes our fines', () => {
  process.env.INFOSIMPLES_SP_CPF = '12345678909';
  process.env.INFOSIMPLES_SP_SENHA = 'fake-pass';
  let source;
  try { source = provider.sourcesFor('SP').sources[0]; } finally { delete process.env.INFOSIMPLES_SP_CPF; delete process.env.INFOSIMPLES_SP_SENHA; }
  assert.equal(source.key, 'detran-sp');
  const fines = source.parse({
    debitos_multas: [
      { auto_infracao: 'abc1111111', data_infracao: '11/11/2026', hora_infracao: '23:53:00', data_vencimento: '20/12/2026', valor: 203.62, descricao: 'Estacionar em local proibido', local: 'Avenida Paulista, 1636', municipio: 'SAO PAULO / SP', orgao_autuador: { codigo: '111', nome: 'DSV - SP' } },
      { auto_infracao: 'xyz2', data_infracao: '12/11/2026', valor: '130,16' },
      { auto_infracao: '', descricao: 'sem número' },
    ],
    debitos_ipva: [{ exercicio: '2026', valor: 1160.07 }],
  });
  assert.deepEqual(fines, [
    { ait: 'ABC1111111', infractionAt: '2026-11-12T02:53:00.000Z', description: 'Estacionar em local proibido', amount: 203.62, points: null, location: 'Avenida Paulista, 1636 - SAO PAULO / SP', authority: 'DSV - SP', paymentDue: '2026-12-20' },
    { ait: 'XYZ2', infractionAt: '2026-11-12T15:00:00.000Z', description: 'Infração de trânsito', amount: 130.16, points: null, location: null, authority: 'Detran-SP', paymentDue: null },
  ]);
  // The real answer of a car with nothing owed (18/11/2026): empty lists, and no fines.
  assert.deepEqual(source.parse({ debitos_multas: [], debitos_ipva: [], debitos_licenciamento: [], multas_total: '0.0', restricao_financeira: 'Consta Gravame' }), []);
  assert.deepEqual(source.parse({}), []);
});

test('a Detran-SP query asks the provider for more time and a gov.br problem is told in plain words, without the platform account details', async () => {
  process.env.INFOSIMPLES_SP_CPF = '12345678909';
  process.env.INFOSIMPLES_SP_SENHA = 'fake-pass';
  let source;
  try { source = provider.sourcesFor('SP').sources[0]; } finally { delete process.env.INFOSIMPLES_SP_CPF; delete process.env.INFOSIMPLES_SP_SENHA; }
  const car = { plate: 'ABC1D23', renavam: '12345678900', state: 'SP' };
  const bodies = [];
  const answer = (body) => async (url, init) => { bodies.push(String(init.body)); return { status: 200, json: async () => body }; };

  // The login is read when the call is made, so the fake pair stays in the environment for these calls only.
  process.env.INFOSIMPLES_SP_CPF = '12345678909';
  process.env.INFOSIMPLES_SP_SENHA = 'fake-pass';
  after(() => { delete process.env.INFOSIMPLES_SP_CPF; delete process.env.INFOSIMPLES_SP_SENHA; });
  const missing = await provider.createProviderFetcher('SEGREDO', answer({ code: 606, code_message: 'Parâmetros obrigatórios não foram enviados.', errors: ["Um dos pares de parâmetros deve ser informado para login no gov.br: 'login_cpf'/'login_senha'"] }))(source, car);
  const sent = new URLSearchParams(bodies[0]);
  delete process.env.INFOSIMPLES_SP_CPF;
  delete process.env.INFOSIMPLES_SP_SENHA;
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Detran-SP: a consulta ainda não está pronta no NextRotta/);
  assert.doesNotMatch(missing.message, /gov\.br|login|606/);

  let calls = 0;
  const unauthorised = await provider.createProviderFetcher('SEGREDO', async (url, init) => {
    calls += 1;
    bodies.push(String(init.body));
    return { status: 200, json: async () => ({ code: 620, code_message: 'O site de origem emitiu um erro', errors: ['É necessário autorizar a primeira vez manualmente o gov.br (https://www.detran.sp.gov.br/x)'] }) };
  })(source, car);
  assert.equal(unauthorised.ok, false);
  assert.doesNotMatch(unauthorised.message, /gov\.br|detran\.sp\.gov\.br|620/);
  assert.equal(calls, 1, 'a charged error is not asked again');

  const other620 = await provider.createProviderFetcher('SEGREDO', answer({ code: 620, code_message: 'Erro do órgão', errors: ['Veículo não encontrado'] }))(source, car);
  assert.match(other620.message, /Veículo não encontrado.*620/, 'other 620 errors keep the provider text');

  assert.equal(sent.get('timeout'), '90');
  assert.equal(sent.get('login_cpf'), '12345678909');
  assert.equal(sent.get('placa'), 'ABC1D23');
  assert.doesNotMatch(JSON.stringify([missing, unauthorised, other620]), /fake-pass|SEGREDO|12345678909/, 'neither the token nor the login leaks into a message');
});

test('the provider call sends the token and the car, reads the answer and never leaks the token in a failure', async () => {
  const calls = [];
  const answer = (body, status = 200) => async (url, init) => {
    calls.push({ url, body: String(init.body) });
    return { status, json: async () => body };
  };
  const car = { plate: 'ABC1D23', renavam: '12345678900', state: 'MS' };
  const source = provider.sourcesFor('MS').sources[0];

  const ok = await provider.createProviderFetcher('SEGREDO', answer({ code: 200, data: [{ multas: [{ auto: 'A1', datahora: '10/11/2026 09:00', valor: '100,00' }] }] }))(source, car);
  assert.equal(ok.ok, true);
  assert.equal(ok.fines.length, 1);
  assert.match(calls[0].url, /\/consultas\/detran\/ms\/multas$/);
  const sent = new URLSearchParams(calls[0].body);
  assert.deepEqual([sent.get('token'), sent.get('placa'), sent.get('renavam')], ['SEGREDO', 'ABC1D23', '12345678900']);

  assert.equal(sent.get('timeout'), String(provider.PROVIDER_TIMEOUT_SECONDS), 'it asks the provider to wait for the agency up to the configured time');
  assert.ok(provider.PROVIDER_TIMEOUT_SECONDS >= 30 && provider.PROVIDER_TIMEOUT_SECONDS <= 60, 'a good answer takes 3-13 s one at a time: a short wait is enough (longer never helped)');
  assert.ok(sync.MANUAL_BUDGET_MS / 1000 + sync.MANUAL_ATTEMPTS * (provider.PROVIDER_TIMEOUT_SECONDS + 25) <= 300, 'the budget that stops new calls plus the call still in flight fits in the 300 s of the screen');

  const timedOut = await provider.createProviderFetcher('SEGREDO', answer({ code: 605, code_message: 'A consulta não foi realizada dentro do tempo de limite de timeout especificado.' }))(source, car);
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.message, /o órgão demorou para responder/);
  assert.doesNotMatch(timedOut.message, /605|timeout/, 'in plain words, without the provider\'s jargon');

  const notEnabled = await provider.createProviderFetcher('SEGREDO', answer({ code: 603, code_message: 'O token informado não tem autorização', errors: ["Consulta 'detran/ms/multas' não habilitada para a sua conta."] }))(source, car);
  assert.equal(notEnabled.ok, false);
  assert.match(notEnabled.message, /ainda não foi habilitada pelo NextRotta/);
  assert.doesNotMatch(notEnabled.message, /conta|SEGREDO/, 'the platform account details stay out of the company screen');

  const invalid = await provider.createProviderFetcher('SEGREDO', answer({ code: 607, code_message: 'Parâmetro(s) inválido(s).: placa, renavam.', errors: ['RENAVAM inválido'] }))(source, car);
  assert.match(invalid.message, /inválido\(s\).*RENAVAM inválido.*607/);

  const mismatch = await provider.createProviderFetcher('SEGREDO', answer({ code: 608, code_message: 'Os parâmetros foram recusados pelo site ou aplicativo de origem.', errors: ['Renavam incorreto.'] }))(source, car);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.message, /o órgão recusou os dados deste carro \(Renavam incorreto\)\. Confira a placa e o Renavam/);
  assert.equal(mismatch.refused, true, 'a refusal is marked, so it is not asked again');

  const refused = await provider.createProviderFetcher('SEGREDO', answer({ code: 612, code_message: 'Renavam não encontrado' }))(source, car);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /Renavam não encontrado/);
  assert.doesNotMatch(refused.message, /SEGREDO/);

  const broken = await provider.createProviderFetcher('SEGREDO', async () => { throw new Error('boom SEGREDO'); })(source, car);
  assert.equal(broken.ok, false);
  assert.doesNotMatch(broken.message, /SEGREDO|boom/);

  // A gateway error (HTTP 502, not JSON) is asked again; two failures in a row end with a message in plain words.
  let tries = 0;
  const gateway = await provider.createProviderFetcher('SEGREDO', async () => { tries += 1; return { status: 502, json: async () => { throw new Error('html'); } }; })(source, car);
  assert.equal(gateway.ok, false);
  assert.equal(tries, provider.MAX_ATTEMPTS, 'it asked again');
  let triesScreen = 0;
  await provider.createProviderFetcher('SEGREDO', async () => { triesScreen += 1; return { status: 502, json: async () => { throw new Error('html'); } }; }, { attempts: 2 })(source, car);
  assert.equal(triesScreen, 2, 'the screen asks fewer times than the worker');
  assert.match(gateway.message, /o provedor não respondeu \(erro 502\)/);

  // A timeout (605) that works on the second try is a success; a refusal is not asked again.
  let calls605 = 0;
  const second = await provider.createProviderFetcher('SEGREDO', async () => {
    calls605 += 1;
    return calls605 === 1
      ? { status: 200, json: async () => ({ code: 605, code_message: 'timeout' }) }
      : { status: 200, json: async () => ({ code: 200, data: [{ multas: [{ auto: 'A2', datahora: '10/11/2026 09:00', valor: '50,00' }] }] }) };
  })(source, car);
  assert.deepEqual([second.ok, calls605], [true, 2], 'the second attempt got the answer');
  let calls603 = 0;
  await provider.createProviderFetcher('SEGREDO', async () => { calls603 += 1; return { status: 200, json: async () => ({ code: 603, code_message: 'x', errors: ['y'] }) }; })(source, car);
  assert.equal(calls603, 1, 'a refusal is not asked again');

  // A page that is not a gateway error and not JSON is not worth asking again.
  let calls404 = 0;
  const odd = await provider.createProviderFetcher('SEGREDO', async () => { calls404 += 1; return { status: 404, json: async () => { throw new Error('html'); } }; })(source, car);
  assert.deepEqual([odd.ok, calls404], [false, 1]);
  assert.match(odd.message, /inesperada/);
});

test('the week starts on Sunday: the lookup day and the next one', () => {
  assert.equal(fineRules.sundayOnOrBefore('2026-11-22'), '2026-11-22', 'a Sunday is its own week start');
  assert.equal(fineRules.sundayOnOrBefore('2026-11-16'), '2026-11-15', 'a Monday goes back to the Sunday');
  assert.equal(fineRules.sundayOnOrBefore('2026-11-21'), '2026-11-15');
  assert.equal(fineRules.nextSunday('2026-11-16'), '2026-11-22');
  assert.equal(fineRules.nextSunday('2026-11-22'), '2026-11-29', 'on a Sunday the next one is the following week');
  assert.equal(fineRules.nextSunday('2026-12-30'), '2027-01-03', 'across the year');
});

test('a line of the history says who started it, when and what came of it', () => {
  const base = { kind: 'weekly', status: 'ok', startedAt: '2026-11-22T11:00:00.000Z', cars: 3, created: 0, failed: 0, message: null };
  const line = (extra) => statusRules.describeRun({ ...base, ...extra });
  assert.deepEqual(line({}), { title: 'Automática (domingo) · 22/11 08:00', detail: '3 carros consultados · nenhuma multa nova', tone: 'success' });
  assert.equal(line({ kind: 'manual', created: 2, cars: 1 }).detail, '1 carro consultado · 2 multas novas');
  assert.equal(line({ kind: 'manual' }).title, 'Manual · 22/11 08:00');
  assert.deepEqual([line({ status: 'partial', failed: 1 }).tone, line({ status: 'partial', failed: 1 }).detail], ['warning', '3 carros consultados · nenhuma multa nova · 1 sem resposta']);
  assert.deepEqual([line({ status: 'error', message: 'Detran fora do ar.' }).tone, line({ status: 'error', message: 'Detran fora do ar.' }).detail], ['danger', 'Detran fora do ar.']);
  assert.equal(line({ status: 'running' }).detail, 'Consultando…');
  assert.equal(line({ cars: 0, message: 'Nenhum carro com Renavam e estado para consultar.' }).detail, 'Nenhum carro com Renavam e estado para consultar.');
});

// ------------------------------------------------------------------------------------------------------ the rounds on the database

const stamp = Date.now();
const orgs = [];
let actor;
let ana;
let carMs;
let carNoData;
const today = brasiliaDateKey();
const weekStart = fineRules.sundayOnOrBefore(today);

const newOrg = async (suffix) => {
  const id = (await sql`INSERT INTO organizations (slug, name, status) VALUES (${`zz-lookup-${stamp}${suffix}`}, 'Teste consulta', 'active') RETURNING id`)[0].id;
  orgs.push(id);
  return id;
};
const fines = async () => sql`SELECT ait_number, technician_id, source, amount FROM vehicle_fines WHERE organization_id = ${actor.organizationId} AND deleted_at IS NULL ORDER BY ait_number`;
const car = async (id) => (await sql`SELECT fines_checked_at, fines_check_status, fines_check_message FROM vehicles WHERE id = ${id}`)[0];
const runs = async () => sql`SELECT kind, status, cars, created, failed, message, finished_at FROM fines_lookup_runs WHERE organization_id = ${actor.organizationId} ORDER BY started_at`;
/** Makes the car look like it was last looked up before this week's Sunday (so the weekly round is due for it). */
const lastWeek = (id) => sql`UPDATE vehicles SET fines_checked_at = ${`${fineRules.sundayOnOrBefore(today)}T00:00:00-03:00`}::timestamptz - INTERVAL '1 day' WHERE id = ${id}`;

// A fake provider: what each source answers is set by the test; every call is counted (each one costs money for real).
let calls = [];
let answers = {};
const fetcher = async (source, target) => {
  calls.push(`${source.key}:${target.plate}`);
  return answers[source.key] ?? { ok: true, fines: [] };
};
const msFine = { ait: 'MS100', infractionAt: '2026-10-20T12:00:00.000Z', description: 'Excesso de velocidade', amount: 130.16, points: 4, location: 'BR-163', authority: 'Detran-MS', paymentDue: null };
const weekly = () => sync.lookupOrganization(actor.organizationId, fetcher, { today, mode: 'weekly' });
const manual = async () => {
  const runId = await sync.beginRun(actor.organizationId, 'manual', null, today);
  return runId ? sync.lookupOrganization(actor.organizationId, fetcher, { today, mode: 'manual', runId }) : null;
};

test('setup: a company with a car that has its data, one that does not, and a history that names the driver', { skip: !hasDatabase }, async () => {
  const org = await newOrg('a');
  actor = { organizationId: org, userId: null, role: 'admin', impersonationId: null };
  ana = (await sql`INSERT INTO technicians (organization_id, name, email, status) VALUES (${org}, 'Ana', ${`ana-${stamp}@exemplo.com`}, 'active') RETURNING id`)[0].id;
  carMs = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'ABC1D23', renavam: '12345678900', state: 'ms' }).value, null);
  carNoData = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'XYZ9K88' }).value, null);
  await sql`INSERT INTO vehicle_assignments (organization_id, vehicle_id, technician_id, assigned_at, released_at) VALUES (${org}, ${carMs}, ${ana}, '2026-09-01T12:00:00Z', '2026-11-01T12:00:00Z')`;
});

test('the weekly round registers the new fines on its own, with the driver from the history, and leaves a line in the history', { skip: !hasDatabase }, async () => {
  answers = { 'detran-ms': { ok: true, fines: [msFine] } };
  const summary = await weekly();
  assert.deepEqual([summary.cars, summary.created, summary.failed], [1, 1, 0]);
  assert.deepEqual(calls, ['detran-ms:ABC1D23', 'prf:ABC1D23'], 'the Detran and the federal highways, once each; the car without data is not asked');
  const [fine] = await fines();
  assert.deepEqual([fine.ait_number, fine.technician_id, fine.source, Number(fine.amount)], ['MS100', ana, 'auto', 130.16]);
  assert.equal((await car(carMs)).fines_check_status, 'ok');
  assert.equal((await car(carNoData)).fines_check_status, 'missing_data');
  const [run] = await runs();
  assert.deepEqual([run.kind, run.status, run.cars, run.created, run.failed], ['weekly', 'ok', 1, 1, 0]);
  assert.ok(run.finished_at);
  const notice = await sql`SELECT 1 FROM notifications WHERE organization_id = ${actor.organizationId} AND dedupe_key LIKE 'fleet:found:%'`;
  assert.equal(notice.length, 1);
});

test('a car looked up this week is not asked about again; next week it is, and a known fine is never registered twice', { skip: !hasDatabase }, async () => {
  calls = [];
  const again = await weekly();
  assert.deepEqual([again.cars, again.runId, calls.length], [0, null, 0], 'nothing due: nobody is asked and no line is added to the history');
  assert.equal((await runs()).length, 1);

  await lastWeek(carMs);
  const next = await weekly();
  assert.deepEqual([next.cars, next.created], [1, 0], 'a week later the car is due, and the same fine is not duplicated');
  assert.equal((await fines()).length, 1);
  assert.equal((await runs()).length, 2);
});

test('a fine the company removed is not brought back by the next lookup', { skip: !hasDatabase }, async () => {
  await sql`UPDATE vehicle_fines SET deleted_at = NOW() WHERE organization_id = ${actor.organizationId}`;
  await lastWeek(carMs);
  const result = await weekly();
  assert.equal(result.created, 0);
  assert.equal((await fines()).length, 0);
});

test('a car never looked up is asked right away, not left waiting for Sunday', { skip: !hasDatabase }, async () => {
  const fresh = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'JKL4M56', renavam: '98765432103', state: 'RJ' }).value, null);
  calls = [];
  answers = {};
  const result = await weekly();
  assert.equal(result.cars, 1);
  assert.deepEqual(calls, ['prf:JKL4M56'], 'RJ has no Detran integrated: only the federal highways');
  assert.equal((await car(fresh)).fines_check_status, 'partial');
});

test('the agencies are asked one car at a time (the PRF times out when several cars are asked together), and the time budget leaves cars for the next lookup', { skip: !hasDatabase }, async () => {
  for (const plate of ['PQR1S23', 'PQR2S34', 'PQR3S45']) {
    await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate, renavam: '12345678900', state: 'RJ' }).value, null);
  }
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE organization_id = ${actor.organizationId} AND plate LIKE 'PQR%'`;
  const inFlight = {};
  const most = {};
  let total = 0;
  const slow = async (source, target) => {
    inFlight[source.key] = (inFlight[source.key] ?? 0) + 1;
    most[source.key] = Math.max(most[source.key] ?? 0, inFlight[source.key]);
    total += 1;
    await new Promise((resolve) => setTimeout(resolve, 15));
    inFlight[source.key] -= 1;
    return { ok: true, fines: [] };
  };
  const summary = await sync.lookupOrganization(actor.organizationId, slow, { today, mode: 'weekly' });
  assert.equal(summary.cars, 3, 'the three new cars were asked (the other ones were looked up this week already)');
  assert.equal(total, 3, 'one call each (RJ has only the PRF)');
  assert.equal(most.prf, 1, 'the PRF was never asked by two cars at the same time');

  // The same fake asked without the queue does overlap: proof that this test can see the problem it guards against.
  inFlight.prf = 0;
  most.prf = 0;
  await Promise.all([slow({ key: 'prf' }, {}), slow({ key: 'prf' }, {}), slow({ key: 'prf' }, {})]);
  assert.equal(most.prf, 3, 'without the queue the three calls overlap');

  // Out of time: new cars are not started; they keep their old mark and wait for the next lookup.
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE organization_id = ${actor.organizationId} AND plate LIKE 'PQR%'`;
  calls = [];
  answers = {};
  const runId = await sync.beginRun(actor.organizationId, 'manual', null, today);
  const late = await sync.lookupOrganization(actor.organizationId, fetcher, { today, mode: 'manual', runId, deadlineMs: Date.now() - 1000 });
  assert.deepEqual([late.cars, late.deferred > 0, calls.length], [0, true, 0], 'nothing was started and nothing was asked');
  const line = (await runs()).at(-1);
  assert.equal(line.status, 'partial');
  assert.match(line.message, /para a próxima verificação \(acabou o tempo desta\)/);
  assert.equal(await sql`SELECT 1 FROM vehicles WHERE organization_id = ${actor.organizationId} AND fines_checked_at IS NOT NULL AND plate LIKE 'PQR%'`.then((rows) => rows.length), 0, 'a deferred car stays unmarked');
  // These three cars were only for this test: they step aside so the next tests count what they always counted.
  await sql`UPDATE vehicles SET status = 'inactive' WHERE organization_id = ${actor.organizationId} AND plate LIKE 'PQR%'`;
});

const ownCompany = async (suffix) => {
  const org = await newOrg(suffix);
  return { org, who: { organizationId: org, userId: null, role: 'admin', impersonationId: null } };
};
const runsOf = (org) => sql`SELECT kind, status, cars, created, failed, message FROM fines_lookup_runs WHERE organization_id = ${org} ORDER BY started_at`;

test('a car the agency refused is not asked (and billed) again until its data is edited', { skip: !hasDatabase }, async () => {
  const { org, who } = await ownCompany('r');
  const id = await vehicles.createVehicle(who, carRules.parseVehicleInput({ plate: 'REF1A11', renavam: '12345678900', state: 'SP' }).value, null);
  const refusing = async (source, target) => {
    calls.push(`${source.key}:${target.plate}`);
    return { ok: false, refused: true, message: 'PRF (rodovias federais): o órgão recusou os dados deste carro (Renavam incorreto). Confira a placa e o Renavam no documento.' };
  };
  calls = [];
  const summary = await sync.lookupOrganization(org, refusing, { today, mode: 'weekly' });
  assert.equal(summary.failed, 1);
  const row = await car(id);
  assert.equal(row.fines_check_status, 'refused');
  assert.match(row.fines_check_message, /Renavam incorreto/);
  assert.equal(row.fines_checked_at, null, 'not marked as checked');
  assert.equal(calls.length, 1);

  // Neither the weekly round nor the button asks about it again.
  calls = [];
  await sync.lookupOrganization(org, refusing, { today, mode: 'weekly' });
  const runId = await sync.beginRun(org, 'manual', null, today);
  await sync.lookupOrganization(org, refusing, { today, mode: 'manual', runId });
  assert.equal(calls.length, 0, 'a refused car is left alone, no matter how many times lookups run');

  // Fixing the data clears the mark, and the car is asked again.
  await vehicles.updateVehicle(who, id, { renavam: '98765432103' }, undefined);
  assert.equal((await car(id)).fines_check_status, null, 'saving the data clears the refusal');
  calls = [];
  await sync.lookupOrganization(org, refusing, { today, mode: 'weekly' });
  assert.equal(calls.length, 1, 'and it is asked again');
});

test('"Verificar agora" moves the fleet forward: it skips cars answered a moment ago and asks the oldest answer first', { skip: !hasDatabase }, async () => {
  const { org, who } = await ownCompany('o');
  for (const [plate, hoursAgo] of [['ORD1A11', 1], ['ORD2A22', null], ['ORD3A33', 48], ['ORD4A44', 24]]) {
    const id = await vehicles.createVehicle(who, carRules.parseVehicleInput({ plate, renavam: '12345678900', state: 'RJ' }).value, null);
    await sql`UPDATE vehicles SET fines_checked_at = ${hoursAgo === null ? null : new Date(Date.now() - hoursAgo * 3_600_000).toISOString()}, fines_check_status = ${hoursAgo === null ? null : 'ok'} WHERE id = ${id}`;
  }
  calls = [];
  answers = {};
  const runId = await sync.beginRun(org, 'manual', null, today);
  const result = await sync.lookupOrganization(org, fetcher, { today, mode: 'manual', runId });
  assert.equal(result.cars, 3, 'the car answered an hour ago is left out');
  assert.deepEqual(calls, ['prf:ORD2A22', 'prf:ORD3A33', 'prf:ORD4A44'], 'never looked up first, then the oldest answer, then the newest');

  // Everything was just answered: the next click says so instead of paying again.
  calls = [];
  const again = await sync.beginRun(org, 'manual', null, today);
  const none = await sync.lookupOrganization(org, fetcher, { today, mode: 'manual', runId: again });
  assert.deepEqual([none.cars, calls.length], [0, 0]);
  const line = (await runsOf(org)).at(-1);
  assert.match(line.message, /já foram consultados há menos de 6 horas/);
});

test('a failed lookup is recorded and tried again next round; a partial one is kept', { skip: !hasDatabase }, async () => {
  await lastWeek(carMs);
  answers = { 'detran-ms': { ok: false, message: 'Detran-MS: fora do ar (código 600).' }, prf: { ok: false, message: 'PRF: fora do ar.' } };
  const failed = await weekly();
  assert.deepEqual([failed.cars, failed.failed], [1, 1]);
  const row = await car(carMs);
  assert.equal(row.fines_check_status, 'error');
  assert.match(row.fines_check_message, /fora do ar/);
  const list = await runs();
  assert.deepEqual([list.at(-1).status, list.at(-1).failed], ['error', 1], 'the history says it did not work');
  assert.match(list.at(-1).message, /fora do ar/);

  answers = { 'detran-ms': { ok: true, fines: [{ ...msFine, ait: 'MS200' }] }, prf: { ok: false, message: 'PRF: fora do ar.' } };
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE id = ${carMs}`;
  const partial = await weekly();
  assert.deepEqual([partial.created, partial.failed], [1, 0]);
  assert.equal((await car(carMs)).fines_check_status, 'partial');
});

test('"Verificar agora" works once a day: the second click is refused, and the day is not spent by a failure or a dead run', { skip: !hasDatabase || !sync.MANUAL_ONCE_A_DAY }, async () => {
  const wipe = () => sql`DELETE FROM fines_lookup_runs WHERE organization_id = ${actor.organizationId}`;
  await wipe();
  answers = {};
  calls = [];
  const first = await manual();
  assert.ok(first, 'the first click goes through');
  assert.ok(first.runId, 'it opened its line');
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), true);
  assert.equal(await sync.beginRun(actor.organizationId, 'manual', null, today), null, 'the second one is refused until tomorrow');

  // Two clicks at the same moment: the database gives the day to one only.
  await wipe();
  const both = await Promise.all([sync.beginRun(actor.organizationId, 'manual', null, today), sync.beginRun(actor.organizationId, 'manual', null, today), sync.beginRun(actor.organizationId, 'manual', null, today)]);
  assert.equal(both.filter(Boolean).length, 1, 'never two at once');

  // A lookup where nothing could be asked (every car failed) does not use up the day.
  await wipe();
  answers = { 'detran-ms': { ok: false, message: 'Detran-MS: fora do ar.' }, prf: { ok: false, message: 'PRF: fora do ar.' } };
  const failed = await manual();
  assert.ok(failed.failed >= 1);
  assert.equal((await runs()).at(-1).status, 'error');
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false, 'a failure lets the day go');
  answers = {};
  assert.ok(await manual(), 'and the admin can try again');

  // A run still "running" after a long time died on the way: it does not lock, and the next click takes the day.
  await wipe();
  await sql`INSERT INTO fines_lookup_runs (organization_id, kind, status, started_at, lock_day) VALUES (${actor.organizationId}, 'manual', 'running', NOW() - INTERVAL '30 minutes', ${today}::date)`;
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false);
  const stale = (await sync.listLookupRuns(actor.organizationId))[0];
  assert.deepEqual([stale.status, stale.message], ['error', 'A consulta não terminou.']);
  assert.ok(await sync.beginRun(actor.organizationId, 'manual', null, today), 'the dead line gave its day back');

  // One that is running now does lock.
  await wipe();
  await sql`INSERT INTO fines_lookup_runs (organization_id, kind, status, lock_day) VALUES (${actor.organizationId}, 'manual', 'running', ${today}::date)`;
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), true);
  assert.equal(await sync.beginRun(actor.organizationId, 'manual', null, today), null);

  // Yesterday's does not: the day it held was another one.
  await wipe();
  await sql`INSERT INTO fines_lookup_runs (organization_id, kind, status, lock_day) VALUES (${actor.organizationId}, 'manual', 'ok', ${fineRules.addDaysToKey(today, -1)}::date)`;
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false, 'the lock opens at the start of the next day');
  assert.ok(await sync.beginRun(actor.organizationId, 'manual', null, today));

  // The automatic weekly lookups never take the manual day.
  await wipe();
  await sync.beginRun(actor.organizationId, 'weekly', null, today);
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false);
});

test('with the daily rule off, "Verificar agora" can be asked again once the last one finished, but never twice at the same time', { skip: !hasDatabase || sync.MANUAL_ONCE_A_DAY }, async () => {
  const wipe = () => sql`DELETE FROM fines_lookup_runs WHERE organization_id = ${actor.organizationId}`;
  await wipe();
  answers = {};
  const first = await manual();
  assert.ok(first, 'the first click goes through');
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false, 'a finished lookup does not hold the day');
  const second = await manual();
  assert.ok(second, 'and it can be asked again right after');
  assert.equal((await runs()).filter((run) => run.kind === 'manual').length, 2);

  // A lookup recorded while the daily rule was on still holds its day in the database: with the rule off it must not lock anything.
  await wipe();
  await sql`INSERT INTO fines_lookup_runs (organization_id, kind, status, finished_at, lock_day) VALUES (${actor.organizationId}, 'manual', 'ok', NOW(), ${today}::date)`;
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false, 'the old day lock does not hold the button');
  assert.ok(await manual(), 'and a new lookup can start');

  // Two clicks at the same moment: only one runs; the other is told one is in progress.
  await wipe();
  const both = await Promise.all([sync.beginRun(actor.organizationId, 'manual', null, today), sync.beginRun(actor.organizationId, 'manual', null, today)]);
  assert.equal(both.filter(Boolean).length, 1, 'never two at once');
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), true, 'while one is running, the button is held');
  // A run that died on the way lets go.
  await sql`UPDATE fines_lookup_runs SET started_at = NOW() - INTERVAL '30 minutes' WHERE organization_id = ${actor.organizationId}`;
  assert.equal(await sync.manualLockedToday(actor.organizationId, today), false);
  assert.ok(await sync.beginRun(actor.organizationId, 'manual', null, today));
});

test('the history lists the latest lookups, newest first, weekly and manual together', { skip: !hasDatabase }, async () => {
  await sql`DELETE FROM fines_lookup_runs WHERE organization_id = ${actor.organizationId}`;
  for (const [kind, hours] of [['weekly', 72], ['manual', 48], ['weekly', 24]]) {
    await sql`INSERT INTO fines_lookup_runs (organization_id, kind, status, started_at, finished_at, cars, created) VALUES (${actor.organizationId}, ${kind}, 'ok', NOW() - make_interval(hours => ${hours}), NOW(), 2, 1)`;
  }
  const list = await sync.listLookupRuns(actor.organizationId, 2);
  assert.deepEqual(list.map((run) => run.kind), ['weekly', 'manual'], 'newest first, limited');
});

test('the round only reaches companies the owner granted the lookup to, and does nothing without the provider set up', { skip: !hasDatabase }, async () => {
  await sql`UPDATE vehicles SET fines_checked_at = NULL WHERE organization_id = ${actor.organizationId}`;
  calls = [];
  const before = process.env.INFOSIMPLES_TOKEN;
  delete process.env.INFOSIMPLES_TOKEN;
  const mine = { organizationIds: [actor.organizationId] }; // a test never writes into a real company
  assert.equal((await sync.runFineLookups(today, undefined, mine)).configured, false, 'no token, no provider');

  const notGranted = await sync.runFineLookups(today, fetcher, mine);
  assert.equal(notGranted.configured, true);
  assert.equal(calls.length, 0, 'the company has no grant: nothing is asked (and nothing is paid)');

  const [{ ok }] = await sql`SELECT COUNT(*)::int AS ok FROM features WHERE key = ${sync.FINES_LOOKUP_FEATURE} AND scope = 'custom'`;
  assert.equal(ok, 1, 'the feature exists as a custom one');
  await sql`INSERT INTO organization_features (organization_id, feature_key) VALUES (${actor.organizationId}, ${sync.FINES_LOOKUP_FEATURE})`;
  const granted = await sync.runFineLookups(today, fetcher, mine);
  assert.ok(granted.companies >= 1);
  assert.ok(calls.length > 0, 'a granted company is looked up');

  if (before) process.env.INFOSIMPLES_TOKEN = before;
});

test('filling in the Renavam and the state clears the old "missing data" mark at once', { skip: !hasDatabase }, async () => {
  const id = await vehicles.createVehicle(actor, carRules.parseVehicleInput({ plate: 'MNO7P89' }).value, null);
  await weekly();
  assert.equal((await car(id)).fines_check_status, 'missing_data', 'the lookup flagged it');
  await vehicles.updateVehicle(actor, id, { color: 'Branco' }, undefined);
  assert.equal((await car(id)).fines_check_status, 'missing_data', 'an edit that does not touch the data leaves the mark');
  await vehicles.updateVehicle(actor, id, { renavam: '12345678900', state: 'MS' }, undefined);
  const row = await car(id);
  assert.deepEqual([row.fines_check_status, row.fines_check_message], [null, null], 'saving the data clears it, with no wait for the next lookup');
});

test('an agency not set up on the platform (code 603) is never a problem for the company: no message, no failure, asked once per lookup, and the detail says what each agency answered', { skip: !hasDatabase }, async () => {
  const { org, who } = await ownCompany('u');
  const plates = ['UNA1A11', 'UNB2B22', 'UNC3C33'];
  for (const plate of plates) await vehicles.createVehicle(who, carRules.parseVehicleInput({ plate, renavam: '12345678900', state: 'MS' }).value, null);
  const rj = await vehicles.createVehicle(who, carRules.parseVehicleInput({ plate: 'UNR4R44', renavam: '98765432103', state: 'RJ' }).value, null);
  const notSetUp = { ok: false, unavailable: true, message: 'PRF (rodovias federais): a consulta ainda não foi habilitada pelo NextRotta.' };
  calls = [];
  const asking = async (source, target) => {
    calls.push(`${source.key}:${target.plate}`);
    if (source.key === 'prf') return notSetUp;
    return target.plate === 'UNB2B22' ? { ok: true, fines: [{ ...msFine, ait: 'UN100' }] } : { ok: true, fines: [] };
  };
  const summary = await sync.lookupOrganization(org, asking, { today, mode: 'weekly' });
  assert.deepEqual([summary.cars, summary.created, summary.failed], [3, 1, 0], 'the three MS cars were looked up; the RJ car has nothing to ask yet');
  assert.equal(calls.filter((entry) => entry.startsWith('prf:')).length, 1, 'the PRF said "not set up" once and was not asked again by the other cars');

  const line = (await runsOf(org))[0];
  assert.deepEqual([line.status, line.failed], ['ok', 0], 'the history does not say it failed');
  assert.doesNotMatch(String(line.message), /PRF|habilitada/, 'and does not nag about the PRF');
  assert.match(line.message, /1 carro sem consulta de multas disponível ainda/);
  const marks = await sql`SELECT plate, fines_check_status, fines_check_message FROM vehicles WHERE organization_id = ${org} ORDER BY plate`;
  assert.deepEqual(marks.filter((row) => row.plate.startsWith('UN') && row.plate !== 'UNR4R44').map((row) => row.fines_check_status), ['ok', 'ok', 'ok'], 'the Detran answered, so the car is up to date');
  const noLookup = marks.find((row) => row.plate === 'UNR4R44');
  assert.equal(noLookup.fines_check_status, 'partial');
  assert.match(noLookup.fines_check_message, /Ainda não há consulta de multas disponível para RJ/);

  // The list says there is a detail; the detail has each car and what each agency answered.
  const listed = (await sync.listLookupRuns(org))[0];
  assert.equal(listed.hasDetails, true);
  assert.equal('details' in listed, false, 'the list stays light: the detail is fetched when a line is opened');
  const run = await sync.getLookupRun(org, listed.id);
  assert.deepEqual(run.details.cars.map((entry) => entry.plate), ['UNA1A11', 'UNB2B22', 'UNC3C33', 'UNR4R44']);
  const withFine = run.details.cars.find((entry) => entry.plate === 'UNB2B22');
  assert.deepEqual(withFine.sources.map((entry) => [entry.label, entry.result, entry.found, entry.created.length]), [['Detran-MS', 'ok', 1, 1], ['PRF (rodovias federais)', 'unavailable', 0, 0]]);
  assert.equal(withFine.sources[0].created[0].ait, 'UN100');
  assert.equal(run.details.cars.find((entry) => entry.plate === 'UNR4R44').sources.every((entry) => entry.result === 'unavailable'), true);

  // Another company cannot open it, and an id that is not one is simply not found.
  const other = (await ownCompany('v')).org;
  assert.equal(await sync.getLookupRun(other, listed.id), null);
  assert.equal(await sync.getLookupRun(org, '00000000-0000-0000-0000-000000000000'), null);
  assert.ok(rj);
});

test('the owner sees and switches the lookup of a company in its Integrações tab (the detail and the feature route)', { skip: !hasDatabase }, async () => {
  const { getOrganizationDetail } = require('../lib/platform/organizations.ts');
  const { setOrganizationFeature } = require('../lib/platform/features.ts');
  const [owner] = await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL LIMIT 1`;
  if (!owner) return;
  const detail = async () => (await getOrganizationDetail(actor.organizationId)).integrations.finesLookup;

  await sql`DELETE FROM organization_features WHERE organization_id = ${actor.organizationId}`;
  await sql`DELETE FROM fines_lookup_runs WHERE organization_id = ${actor.organizationId}`;
  const off = await detail();
  assert.deepEqual([off.granted, off.lastRunAt, off.runsThisMonth], [false, null, 0]);
  assert.equal(off.cars >= 2, true, 'counts the cars of the company');
  assert.ok(off.carsWithData >= 1 && off.carsWithData < off.cars, 'and the ones that have Renavam and state');

  await setOrganizationFeature(actor.organizationId, sync.FINES_LOOKUP_FEATURE, true, { id: owner.id });
  assert.equal((await detail()).granted, true, 'turned on by the owner');
  await sync.beginRun(actor.organizationId, 'weekly', null, today);
  const withRun = await detail();
  assert.deepEqual([withRun.runsThisMonth, withRun.lastRunStatus], [1, 'running']);

  await setOrganizationFeature(actor.organizationId, sync.FINES_LOOKUP_FEATURE, false, { id: owner.id });
  assert.equal((await detail()).granted, false, 'turned off again');
});

after(async () => {
  if (!orgs.length) return;
  for (const table of ['audit_events', 'notifications', 'organization_features', 'fines_lookup_runs', 'vehicle_fines', 'vehicle_assignments', 'vehicles', 'technicians']) {
    await sql.query(`DELETE FROM ${table} WHERE organization_id = ANY($1::uuid[])`, [orgs]);
  }
  await sql`DELETE FROM organizations WHERE id = ANY(${orgs}::uuid[])`;
});
