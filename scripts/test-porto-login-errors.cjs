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
