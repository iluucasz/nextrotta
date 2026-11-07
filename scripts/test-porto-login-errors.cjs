// Run with: node scripts/test-porto-login-errors.cjs
// What the company reads when the Porto login fails (lib/porto-login-errors.ts) — pure, no browser or database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const e = require('../lib/porto-login-errors.ts');
const M = e.PORTO_LOGIN_MESSAGES;

const html = '\r\n<!DOCTYPE html><html><head><script src="/f-our-take" async></s';

test('classifyLoginFailure: each answer of the portal points to its own cause', () => {
  const classify = (qraStatus, qraBody, sessionStatus = 200) => e.classifyLoginFailure({ qraStatus, qraBody, sessionStatus });
  // Seen live: wrong data, and the empty body after the password was changed.
  assert.equal(classify(200, '{"status":"invalid","message":"Erro ao realizar a consulta dos dados"}'), 'credentials_rejected');
  assert.equal(classify(200, ''), 'no_confirmation');
  assert.equal(e.classifyLoginFailure({ qraStatus: 200, qraBody: '', sessionStatus: 200, passwordExpired: true }), 'password_expired');
  assert.equal(classify(200, '{"status":"success","data":{"qras":[{"codQRA":"1"}]}}'), 'session_not_opened');
  assert.equal(classify(200, '{"status":"success","data":{"qras":[]}}'), 'no_qra');
  assert.equal(classify(null, ''), 'no_answer');
  assert.equal(classify(503, ''), 'no_answer');
  assert.equal(classify(403, ''), 'blocked');
  assert.equal(classify(200, '', 429), 'blocked');
  assert.equal(classify(200, '<html>Request unsuccessful. Incapsula incident ID: 1</html>'), 'blocked');
  assert.equal(classify(200, '<html>algo novo</html>'), 'unexpected');
});

test('a login rejection is recognised, old wording included, so it is never retried', () => {
  const stored = e.buildLoginFailureMessage('credentials_rejected', 'url=x');
  assert.equal(e.isPortoLoginRejection(stored), true);
  assert.equal(e.isPortoLoginRejection('Login no Porto falhou — verifique CPF e senha (url=x)'), true);
  assert.equal(e.isPortoLoginRejection('Não foi possível abrir a página de login do Porto.'), false);
  assert.equal(e.isPortoLoginRejection('O Porto aceitou o CPF e a senha, mas não abriu a sessão. (url=x)'), true);
  assert.equal(e.isPortoLoginRejection(null), false);
});

test('describePortoError: the sentence for the screen, the trace kept apart', () => {
  const trace = 'url=https://prestador/x qraLookup(status=200, body="") modalVisible=false sessionCheck(status=200, body="' + html + '")';
  const fresh = e.describePortoError(e.buildLoginFailureMessage('no_confirmation', trace));
  assert.equal(fresh.message, M.no_confirmation);
  assert.match(fresh.technical, /^url=https:\/\/prestador\/x qraLookup/);
  assert.doesNotMatch(fresh.message, /url=|DOCTYPE|qraLookup/);

  // Rows written by the old worker are reclassified from their own trace.
  const legacyEmpty = `Login no Porto falhou — verifique CPF e senha, ou o portal pode ter mudado. (${trace})`;
  assert.equal(e.describePortoError(legacyEmpty).message, M.no_confirmation);
  const legacyInvalid = 'Login no Porto falhou — verifique CPF e senha, ou o portal pode ter mudado. (url=u qraLookup(status=200, body="{"status":"invalid","message":"Erro ao realizar a consulta dos dados"}") modalVisible=false sessionCheck(status=200, body="x"))';
  assert.equal(e.describePortoError(legacyInvalid).message, M.credentials_rejected);
  // Rows stored with the first wording (it accused the password) are shown with the neutral one.
  const accusing = 'O Porto não aceitou o CPF ou a senha. Se você trocou a senha no Portal do Prestador, atualize aqui em “Alterar”. (url=u qraLookup(status=200, body="x"))';
  assert.equal(e.describePortoError(accusing).message, M.credentials_rejected);
  assert.equal(e.isCredentialsRejection(accusing), true);
  assert.equal(e.isCredentialsRejection(`${M.password_expired} (url=x)`), false);
  // A legacy text cut short by the 300-character limit still gets a sentence.
  assert.equal(e.describePortoError('Login no Porto falhou — verifique CPF e senha, ou o portal pode ter mudado. (url=u qraLo').message, M.no_confirmation);

  assert.match(e.describePortoError('Não foi possível abrir a página de login do Porto.').message, /não abriu/);
  assert.equal(e.describePortoError('Credenciais não configuradas.').message, 'Falta cadastrar o CPF e a senha do Porto.');
  const wrapped = e.describePortoError('Falha ao testar login no Porto: page.fill: Timeout 30000ms exceeded.\n  - waiting for #cpf');
  assert.match(wrapped.message, /testar o login agora/);
  assert.equal(wrapped.technical, 'page.fill: Timeout 30000ms exceeded.');
  assert.deepEqual(e.describePortoError(null), { message: 'Sem detalhe do erro.', technical: null });
  assert.deepEqual(e.describePortoError('Senha recusada'), { message: 'Senha recusada', technical: null });
});

test('a technical Playwright error becomes a sentence; plain causes stay as they are', () => {
  const timeout = e.describePortoError('Erro inesperado ao importar horas do Porto: frame.selectOption: Timeout 30000ms exceeded.');
  assert.equal(timeout.message, e.PORTO_RUN_FAILED_MESSAGE);
  assert.equal(timeout.technical, 'frame.selectOption: Timeout 30000ms exceeded.');
  const plain = 'Erro inesperado ao importar horas do Porto: A busca de serviços do Porto não terminou em tempo hábil.';
  assert.deepEqual(e.describePortoError(plain), { message: `${plain} ${e.SUPPORT_HINT}`, technical: null });
});

test('which messages send the company to Suporte', () => {
  const M = e.PORTO_LOGIN_MESSAGES;
  // What the company can fix alone does not ask for a ticket; the rest does.
  for (const fixable of ['credentials_rejected', 'password_expired', 'no_qra']) assert.equal(e.needsSupport(M[fixable]), false, fixable);
  for (const other of ['no_confirmation', 'session_not_opened', 'blocked', 'no_answer', 'unexpected']) assert.equal(e.needsSupport(M[other]), true, other);
  assert.equal(e.needsSupport(e.PORTO_RUN_FAILED_MESSAGE), true);
  assert.equal(e.needsSupport(e.describePortoError('Não foi possível abrir a página de login do Porto.').message), true);
  assert.equal(e.needsSupport(e.describePortoError('Credenciais não configuradas.').message), false);
  assert.equal(e.needsSupport(null), false);
});

test('findPortoLoginProblem: failing only while the newest evidence is a failure', () => {
  const rejected = e.buildLoginFailureMessage('password_expired', 'url=x');
  const failedRun = { started_at: '2026-11-05T20:00:00Z', status: 'error', error_message: rejected };
  const okRun = (at) => ({ started_at: at, status: 'success', error_message: null });
  const none = { at: null, ok: null, message: null };
  const find = (input) => e.findPortoLoginProblem({ hasCredentials: true, lastTest: none, runs: [], ...input });

  assert.equal(find({ runs: [failedRun] }).message, e.PORTO_LOGIN_MESSAGES.password_expired);
  assert.equal(find({ lastTest: { at: '2026-11-05T13:00:00Z', ok: false, message: rejected } }).message, e.PORTO_LOGIN_MESSAGES.password_expired);
  // A test or a run that worked afterwards clears it.
  assert.equal(find({ runs: [failedRun], lastTest: { at: '2026-11-05T21:00:00Z', ok: true, message: null } }), null);
  assert.equal(find({ runs: [failedRun, okRun('2026-11-06T20:00:00Z')] }), null);
  // An older success does not hide a newer failure.
  assert.ok(find({ runs: [failedRun, okRun('2026-11-04T20:00:00Z')] }));
  // Errors that are not a rejected login are not a login problem; no account means nothing to warn about.
  assert.equal(find({ runs: [{ started_at: '2026-11-05T20:00:00Z', status: 'error', error_message: 'Erro inesperado ao importar horas do Porto: x' }] }), null);
  assert.equal(find({ hasCredentials: false, runs: [failedRun] }), null);
  // The old wording counts too.
  assert.ok(find({ runs: [{ started_at: '2026-11-05T20:00:00Z', status: 'error', error_message: 'Login no Porto falhou — verifique CPF e senha (url=u qraLookup(status=200, body="") modalVisible=false sessionCheck(status=200, body="x"))' }] }));
});

test('portoLoginNotice: its own title for an expired password', () => {
  assert.equal(e.portoLoginNotice(e.PORTO_LOGIN_MESSAGES.password_expired).title, 'A senha do Porto expirou');
  const generic = e.portoLoginNotice(e.PORTO_LOGIN_MESSAGES.credentials_rejected);
  assert.equal(generic.title, 'O robô do Porto não consegue entrar');
  assert.match(generic.body, /não são importadas/);
});
