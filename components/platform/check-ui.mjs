// Local smoke test. Uses an isolated Chrome instance on :9223 and a dev server on :3100.
// The server must use the test-only JWT_SECRET below. Never point this at production.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { SignJWT } from 'jose';

const origin = 'http://localhost:3100';
const tabs = await fetch('http://localhost:9223/json').then(r => r.json());
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
let serial = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
});
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
async function until(expression, timeout = 40000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 200)); } throw new Error(`Timed out: ${expression}`); }
async function go(path, text) {
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.removeEventListener('message', listener); reject(new Error(`Page load timeout: ${path}`)); }, 45000);
    function listener(event) { if (JSON.parse(event.data).method === 'Page.loadEventFired') { clearTimeout(timeout); ws.removeEventListener('message', listener); resolve(); } }
    ws.addEventListener('message', listener);
  });
  await send('Page.navigate', { url: origin + path }); await loaded;
  await until(`document.body?.innerText.includes(${JSON.stringify(text)})`);
  await evaluate('document.fonts.ready.then(() => true)');
  await new Promise(resolve => setTimeout(resolve, 300));
}
async function click(text) { const clicked = await evaluate(`(() => { const elements = [...document.querySelectorAll('[role=dialog] button'), ...document.querySelectorAll('main button'), ...document.querySelectorAll('button,a')]; const button = elements.find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!button) return false; button.click(); return true; })()`); assert.ok(clicked, `Control not found: ${text}`); }
async function fill(label, value) { const found = await evaluate(`(() => { const label = [...document.querySelectorAll('label')].find(e => e.textContent.includes(${JSON.stringify(label)})); const input = label?.querySelector('input,textarea,select'); if (!input) return false; const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input',{bubbles:true})); return true; })()`); assert.ok(found, `Field not found: ${label}`); }
await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
try {
  await go('/', 'Sua equipe em campo.');
  await evaluate('localStorage.removeItem("nextrotta-platform-demo-v1")');
  await go('/', 'Sua equipe em campo.');
  await writeFile(new URL('./site-desktop.png', import.meta.url), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Home overflow');
  for (const [path, text] of [['/planos', 'Seu próximo passo começa aqui.'], ['/contato?plano=essencial&ciclo=Anual', 'Conte com a gente'], ['/sob-medida', 'Seu jeito de trabalhar.'], ['/novidades', 'Novidades que fazem diferença.'], ['/termos', 'Termos de uso'], ['/privacidade', 'Política de privacidade'], ['/login?erro=link', 'O link de acesso expirou. Entre novamente.']]) { await go(path, text); console.log('PASS', path); }
  await click('Esqueci minha senha'); await fill('E-mail', 'teste@example.com'); await click('Solicitar link de recuperação'); await until('document.body?.innerText.includes("nenhum e-mail foi enviado")');
  const token = await new SignJWT({ userId: 'ui-validation', email: 'owner@example.com', role: 'platform_owner', organizationSlug: null }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('nextrotta-ui-validation-only-2026-local'));
  await send('Network.setCookie', { name: 'auth-token', value: token, url: origin, httpOnly: true });
  await go('/plataforma', 'Uma visão de toda a sua operação.');
  await new Promise(r => setTimeout(r, 500));
  await writeFile(new URL('./panel-desktop.png', import.meta.url), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  for (const [path, text] of [['organizacoes', 'Sua base de clientes'], ['planos', 'Todos os planos'], ['cupons', 'Cupons e descontos'], ['creditos-ia', 'Quem mais usa IA'], ['recursos', 'Catálogo de recursos'], ['bugs', 'Bugs reportados'], ['leads', 'Leads'], ['novidades', 'Novidades'], ['site', 'Seu site, do seu jeito.'], ['financeiro', 'Todas as cobranças'], ['auditoria', 'Auditoria global'], ['operacao', 'Tudo sob acompanhamento.'], ['configuracoes', 'Configurações da plataforma']]) { await go(`/plataforma/${path}`, text); console.log('PASS', path); }
  await go('/plataforma/organizacoes/org-1', 'Rota Sul Assistência');
  for (const tab of ['Assinatura', 'Limites e recursos', 'Créditos de IA', 'Usuários', 'Configurações', 'Integrações', 'Dados', 'Auditoria', 'Bugs', 'Anotações', 'Resumo']) { await click(tab); await new Promise(r => setTimeout(r, 100)); }
  console.log('PASS organization tabs');
  await click('Suspender'); await until('!!document.querySelector("[role=dialog]")'); await fill('Motivo obrigatório', 'Validação de suspensão na interface'); await click('Salvar alterações');
  await until('document.body?.innerText.includes("Reativar")');
  await go('/plataforma/organizacoes/org-1', 'Reativar'); console.log('PASS suspend persists');
  await click('Reativar'); await click('Salvar alterações');
  await go('/plataforma/planos', 'Todos os planos'); await click('Editar plano'); await fill('Preço mensal', '207'); await click('Salvar alterações');
  await until('document.body?.innerText.includes("Confirmar mudança de preço")'); await click('Confirmar novos preços');
  await until('!document.querySelector("[role=dialog]")');
  assert.equal(await evaluate('JSON.parse(localStorage.getItem("nextrotta-platform-demo-v1")).plans[0].monthly'), 207);
  console.log('PASS price confirmation');
  await go('/plataforma/organizacoes/nova?lead=lead-1', 'Uma nova organização começa aqui.');
  await until('document.querySelector("input")?.value === "Ágil Assistências"');
  console.log('PASS lead prefill');
  await go('/plataforma/site', 'Seu site, do seu jeito.'); await fill('Título (quebras', 'Sua equipe em campo.\nPublicação validada.'); await click('Salvar rascunho');
  await go('/', 'Sua equipe em campo.'); assert.equal(await evaluate('document.body?.innerText.includes("Publicação validada.")'), false);
  await go('/plataforma/site', 'Seu site, do seu jeito.'); await click('Publicar'); await click('Confirmar');
  await go('/', 'Publicação validada.'); console.log('PASS draft/publish separation');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await go('/', 'Publicação validada.');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Mobile home overflow');
  await writeFile(new URL('./site-mobile.png', import.meta.url), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await go('/plataforma', 'Uma visão de toda a sua operação.');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Mobile panel overflow');
  await writeFile(new URL('./panel-mobile.png', import.meta.url), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await go('/plataforma/organizacoes?estado=erro', 'Não foi possível carregar'); await click('Tentar novamente'); await until('document.body?.innerText.includes("Sua base de clientes")');
  console.log('PASS responsive and error retry');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log('All UI checks passed.');
} finally { ws.close(); }
