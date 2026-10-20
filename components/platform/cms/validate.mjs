// Browser validation against an isolated local dev server. All browser API calls are intercepted.
// Requires Chrome CDP :9223, Next :3100 with the validation-only secret. No database writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import { SignJWT } from 'jose';

const source = await fs.readFile('lib/site/content.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const exports = {};
new Function('exports', compiled)(exports);
let state = {
  draft: structuredClone(exports.siteContent),
  published: structuredClone(exports.siteContent),
  hasUnpublishedChanges: false,
  draftUpdatedAt: null,
  publishedAt: null,
  designSupported: true,
  versions: [],
};
const tabs = await fetch('http://localhost:9223/json').then((r) => r.json());
const ws = new WebSocket(
  tabs.find((t) => t.type === 'page').webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
const requests = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.addEventListener('message', async (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(message.error);
    else item.resolve(message.result);
  }
  if (message.method === 'Runtime.exceptionThrown')
    errors.push(
      message.params.exceptionDetails.exception?.description ||
        message.params.exceptionDetails.text,
    );
  if (message.method === 'Fetch.requestPaused') {
    const { request, requestId } = message.params;
    const path = new URL(request.url).pathname;
    requests.push([request.method, path]);
    let data = {};
    if (path === '/api/platform/site') {
      if (request.method !== 'GET') {
        const content = JSON.parse(request.postData);
        state.versions.unshift({
          id: String(Date.now()),
          label: request.method === 'PUT' ? 'Rascunho salvo' : 'Site publicado',
          kind: request.method === 'PUT' ? 'draft' : 'published',
          content: structuredClone(content),
          createdAt: new Date().toISOString(),
        });
        state.draft = content;
        state.draftUpdatedAt = new Date().toISOString();
        state.hasUnpublishedChanges = true;
        if (request.method === 'POST') {
          state.published = structuredClone(content);
          state.publishedAt = new Date().toISOString();
          state.hasUnpublishedChanges = false;
        }
      }
      data = state;
    } else if (path === '/api/public/plans') data = { plans: [], features: [] };
    else if (path === '/api/public/news') data = { posts: [] };
    await send('Fetch.fulfillRequest', {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(data)).toString('base64'),
    });
  }
});
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error(`Timed out: ${expression}`);
}
async function click(selector) {
  await until(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await new Promise((r) => setTimeout(r, 100));
}
async function textClick(text) {
  const result = await evaluate(
    `(() => {const el=[...document.querySelectorAll('[role=dialog] button'),...document.querySelectorAll('.cms-workspace button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!el)return false;el.click();return true})()`,
  );
  assert.ok(result, `Missing button ${text}`);
  await new Promise((r) => setTimeout(r, 150));
}
async function input(selector, value) {
  await evaluate(
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})()`,
  );
  await new Promise((r) => setTimeout(r, 120));
}
const frameText =
  'document.querySelector("iframe")?.contentDocument?.body?.innerText';
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*://localhost:3100/api/*' }],
  });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'localStorage.removeItem("nextrotta-cms-recovery-v1");localStorage.removeItem("nextrotta-cms-history-v1");',
  });
  const token = await new SignJWT({
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'validation@example.com',
    role: 'platform_owner',
    organizationSlug: null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode('nextrotta-ui-validation-only-2026-local'));
  await send('Network.setCookie', {
    name: 'auth-token',
    value: token,
    url: 'http://localhost:3100',
    httpOnly: true,
  });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: 'http://localhost:3100/plataforma/site' });
  await until(`${frameText}?.includes('Sua equipe em campo.')`);
  await new Promise((r) => setTimeout(r, 500));
  await fs.writeFile(
    'components/platform/cms/editor-desktop.png',
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' })).data,
      'base64',
    ),
  );
  console.log('PASS live canvas');
  await input('.cms-right-sidebar textarea', 'Uma nova capa para testar.');
  await until(`${frameText}?.includes('Uma nova capa para testar.')`);
  await click('[aria-label="Desfazer"]');
  await until(`${frameText}?.includes('Sua equipe em campo.')`);
  await click('[aria-label="Refazer"]');
  await until(`${frameText}?.includes('Uma nova capa para testar.')`);
  console.log('PASS live edit / undo / redo');
  await click('[aria-label="Tema"]');
  await input('input[aria-label="Cor principal"]', '#993366');
  assert.equal(
    await evaluate(
      'document.querySelector("iframe").contentDocument.querySelector(".nr-marketing").style.getPropertyValue("--site-primary")',
    ),
    '#993366',
  );
  console.log('PASS theme colors');
  await click('[aria-label="Adicionar"]');
  await textClick('Texto livreTítulo e texto com formatação.');
  await until(`${frameText}?.includes('Um novo capítulo da sua operação.')`);
  await input('.cms-right-sidebar textarea', 'Componente criado no teste');
  await until(`${frameText}?.includes('Componente criado no teste')`);
  await click('[title="Duplicar seção"]');
  assert.equal(
    await evaluate('[...document.querySelectorAll(".cms-tree-row")].length'),
    13,
  );
  await click('[aria-label="Arquivar seção selecionada"]');
  await textClick('Confirmar');
  await click('[aria-label="Arquivadas"]');
  await textClick('Restaurar');
  assert.equal(
    await evaluate('[...document.querySelectorAll(".cms-tree-row")].length'),
    13,
  );
  console.log('PASS add / duplicate / archive / restore');
  await click('[aria-label="Mover seção para cima"]');
  await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.cms-tree-row')];
    const source = rows[rows.length - 1];
    const target = rows[0];
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: transfer, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer, cancelable: true }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  })()`);
  await until(
    `document.querySelector('iframe').contentDocument.querySelector('[data-section-type]')?.dataset.sectionType === 'text'`,
  );
  console.log('PASS drag-and-drop reorders the actual canvas');
  await click('.cms-save-button');
  await until(
    '!document.querySelector(".cms-save-button")?.textContent.includes("Salvando")',
  );
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(state.draft.design.sections.length === 13);
  assert.equal(state.draft.design.theme.primary, '#993366');
  assert.equal(state.published.design, undefined);
  console.log('PASS full draft payload / published unchanged');
  await click('[aria-label="Versões"]');
  await textClick('Versão no ar—');
  await textClick('Confirmar');
  await until(`${frameText}?.includes('Sua equipe em campo.')`);
  await click('[aria-label="Desfazer"]');
  console.log('PASS version restore / undo');
  await click('.cms-publish-button');
  await textClick('Confirmar');
  await until('!document.querySelector("[role=dialog]")');
  assert.equal(state.published.design.theme.primary, '#993366');
  console.log('PASS publish and version history');
  await click('[aria-label="Prévia em celular"]');
  assert.equal(
    await evaluate('document.querySelector("iframe").contentWindow.innerWidth'),
    390,
  );
  await fs.writeFile(
    'components/platform/cms/editor-device-mobile.png',
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' })).data,
      'base64',
    ),
  );
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    await evaluate('document.documentElement.scrollWidth <= innerWidth'),
    true,
  );
  await fs.writeFile(
    'components/platform/cms/editor-mobile.png',
    Buffer.from(
      (await send('Page.captureScreenshot', { format: 'png' })).data,
      'base64',
    ),
  );
  assert.deepEqual(errors, []);
  assert.ok(requests.every(([, path]) => path.startsWith('/api/')));
  console.log('All CMS browser checks passed; API mutations were intercepted.');
} finally {
  await send('Fetch.disable').catch(() => {});
  ws.close();
}
