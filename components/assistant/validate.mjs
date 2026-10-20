// Isolated browser checks of the real React components. All API responses are fixtures.
// Start a disposable Chrome profile with --remote-debugging-port=9223 before running.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import ts from 'typescript';

const modules = {};
for (const [name, path] of Object.entries({
  react: 'react/cjs/react.development.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.development.js',
  'react-dom': 'react-dom/cjs/react-dom.development.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.development.js',
  scheduler: 'next/dist/compiled/scheduler/cjs/scheduler.development.js',
  'lucide-react': 'lucide-react/dist/cjs/lucide-react.js',
}))
  modules[name] = readFileSync(`node_modules/${path}`, 'utf8');
for (const [name, path] of Object.entries({
  './workspace': 'components/assistant/workspace.tsx',
  './widget': 'components/assistant/widget.tsx',
  '@/components/markdown': 'components/markdown.tsx',
}))
  modules[name] = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const bundle = `const process={env:{NODE_ENV:'development'}};const sources=${JSON.stringify(modules)};const cache={};function require(name){if(name.endsWith('.css'))return {};if(name==='next/link')return {__esModule:true,default:({children,...props})=>require('react').createElement('a',props,children)};if(name==='next/navigation')return {usePathname:()=>'/admin'};if(name==='next/dynamic')return {__esModule:true,default:()=>props=>require('react').createElement(require('./workspace').AssistantWorkspace,props)};if(cache[name])return cache[name].exports;if(!sources[name])throw Error(name);const module={exports:{}};cache[name]=module;new Function('module','exports','require','process',sources[name])(module,module.exports,require,process);return module.exports;}const R=require('react');require('react-dom/client').createRoot(document.getElementById('root')).render(R.createElement(location.pathname==='/widget'?require('./widget').AssistantWidget:require('./workspace').AssistantWorkspace));`;
const css = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f6f8f6;color:#183b32}button,input,textarea,select{font:inherit;color:inherit}button{border:0;background:none}a{color:inherit;text-decoration:none}h1,h2,h3,p{margin:0}svg{vertical-align:middle}button:disabled{cursor:not-allowed}#root{max-width:1420px;margin:30px auto;padding:0 24px}:root{--foreground:#183b32;--card:#fff;--muted-foreground:#596e63;--border:#dce7df}${readFileSync('components/assistant/assistant.css', 'utf8')}`;
let balance = 120,
  failSend = false,
  sends = 0,
  delaySend = false,
  owner = false;
let conversations = [
  {
    id: 'conversation-1',
    title: 'Resumo da folha',
    updatedAt: new Date().toISOString(),
    messages: 2,
  },
];
const messages = [
  {
    id: 'm1',
    role: 'user',
    content: 'Como está a folha?',
    createdAt: new Date().toISOString(),
    toolsUsed: [],
    credits: null,
  },
  {
    id: 'm2',
    role: 'assistant',
    content:
      '**Resumo da folha**\n\n- 12 técnicos com fechamento.\n- Total: R$ 24.000,00.\n\nConfira os valores em Folha.',
    toolsUsed: ['folha_da_competencia'],
    credits: 1,
    suggestions: [
      'Quem teve o maior líquido?',
      'Compare com o mês anterior',
      'Alguma folha ainda em rascunho?',
    ],
    createdAt: new Date().toISOString(),
  },
];
const starters = [
  'Qual técnico mais produziu em outubro?',
  'Quais folhas de setembro ainda estão em rascunho?',
  'Quem está escalado para amanhã?',
  'Qual o valor médio por OS em outubro?',
  'Quem está abaixo da jornada de horas em outubro?',
  'Algum técnico está sem horas apontadas nos últimos dias?',
];
const server = createServer(async (req, res) => {
  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (req.url === '/api/assistant' && req.method === 'GET')
    return json({
      available: balance > 0,
      reason: balance > 0 ? null : 'Seus créditos acabaram.',
      balance,
      creditsPerUse: 1,
      impersonating: owner,
      suggestions: starters,
      conversations,
    });
  if (req.url === '/api/organization/credits')
    return json({
      balance,
      monthlyCredits: 200,
      planIncludesAi: true,
      packages: [{ id: 'p1', name: 'Pacote 100', credits: 100, price: 49.9 }],
      usage: [
        { month: new Date().toISOString().slice(0, 7), credits: 80, uses: 80 },
      ],
      entries: [
        {
          id: 'e1',
          kind: 'consumption',
          kindLabel: 'Consumo',
          quantity: -1,
          description: 'Consulta ao assistente',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'e2',
          kind: 'monthly',
          kindLabel: 'Cota mensal',
          quantity: 200,
          description: 'Cota do plano',
          createdAt: new Date().toISOString(),
        },
      ],
    });
  if (req.url === '/api/assistant' && req.method === 'POST') {
    sends++;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.ok(body.question);
    if (delaySend) await new Promise((r) => setTimeout(r, 700));
    if (failSend)
      return json({ error: 'Falha simulada. Tente novamente.' }, 502);
    balance--;
    return json({
      conversationId: 'conversation-1',
      message: { ...messages[1], id: `answer-${sends}` },
      balance,
    });
  }
  if (req.url === '/api/assistant/conversation-1') {
    if (req.method === 'DELETE') {
      conversations = [];
      return json({ ok: true });
    }
    return json({ id: 'conversation-1', messages });
  }
  if (req.url === '/bundle.js') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(bundle);
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const targets = await (await fetch('http://localhost:9223/json')).json();
const ws = new WebSocket(
  targets.find((t) => t.type === 'page').webSocketDebuggerUrl,
);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let serial = 0;
const pending = new Map(),
  errors = [];
ws.addEventListener('message', (event) => {
  const m = JSON.parse(event.data);
  if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(m.error) : p.resolve(m.result);
  }
  if (m.method === 'Runtime.exceptionThrown')
    errors.push(m.params.exceptionDetails.exception?.description);
  if (m.method === 'Page.javascriptDialogOpening')
    void send('Page.handleJavaScriptDialog', { accept: true });
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description);
  return result.result.value;
}
async function until(expression) {
  for (let n = 0; n < 100; n++) {
    if (await evaluate(expression)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(`Timeout: ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await new Promise((r) => setTimeout(r, 80));
}
async function textClick(text) {
  await evaluate(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click()})()`,
  );
  await new Promise((r) => setTimeout(r, 80));
}
async function input(selector, value) {
  await evaluate(
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
  await new Promise((r) => setTimeout(r, 50));
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    `components/platform/.browser-validation/assistant-${name}.png`,
    Buffer.from(result.data, 'base64'),
  );
}
try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Page.navigate', { url: base });
  // The credit summary only exists in the floating chat; the full page shows it under Consumo.
  await until(`!!document.querySelector('.ai-welcome')`);
  await screenshot('desktop');
  await until(`document.querySelectorAll('.ai-suggestions button').length===6`);
  assert.equal(
    await evaluate('document.querySelector(".ai-suggestions button").textContent.includes("outubro")'),
    true,
    'Starter questions come from the status',
  );
  // A suggestion is sent right away, without going through the text box.
  await click('.ai-suggestions button');
  await until(`document.querySelectorAll('.from-assistant').length===1`);
  assert.equal(sends, 1);
  assert.equal(await evaluate('document.querySelector("textarea").value'), '');
  assert.equal(balance, 119, 'One question, one credit');
  // Follow-ups: under the last answer only, and also sent on click.
  await until(`document.querySelectorAll('.ai-followups button').length===3`);
  await click('.ai-followups button');
  await until(`document.querySelectorAll('.from-assistant').length===2`);
  assert.equal(sends, 2);
  assert.equal(balance, 118);
  assert.equal(
    await evaluate('document.querySelectorAll(".ai-followups").length'),
    1,
    'Follow-ups only under the last answer',
  );
  failSend = true;
  await input('textarea', 'Pergunta com falha');
  await click('[aria-label="Enviar pergunta"]');
  await until(
    `document.querySelector('[role=alert]')?.textContent.includes('Falha simulada')`,
  );
  assert.equal(
    await evaluate('document.querySelector("textarea").value'),
    'Pergunta com falha',
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".from-user").length'),
    2,
  );
  failSend = false;
  delaySend = true;
  await click('[aria-label="Enviar pergunta"]');
  await textClick('Histórico');
  assert.equal(
    await evaluate('document.querySelector(".ai-history button").disabled'),
    true,
  );
  await until(`!document.querySelector('.ai-new').disabled`);
  delaySend = false;
  await input('[aria-label="Buscar conversa"]', 'inexistente');
  await until(
    `document.querySelector('.ai-empty')?.textContent.includes('Nenhuma')`,
  );
  await input('[aria-label="Buscar conversa"]', 'Resumo');
  await click('.ai-history button');
  await until(`document.querySelectorAll('.ai-message').length===2`);
  await screenshot('conversation');
  await textClick('Consumo');
  await until(`document.querySelectorAll('.ai-month-chart > div').length===6`);
  assert.equal(
    await evaluate('document.querySelectorAll(".ai-ledger > div").length'),
    2,
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".ai-month-chart b")[5].textContent',
    ),
    '80',
  );
  await screenshot('credits');
  await textClick('Preferências');
  await click('.ai-preference:last-of-type input');
  assert.equal(
    await evaluate(
      'document.querySelector(".nr-assistant").classList.contains("is-large-text")',
    ),
    true,
  );
  assert.equal(
    await evaluate(
      'JSON.parse(localStorage.getItem("nextrotta-assistant-preferences")).largeText',
    ),
    true,
  );
  await textClick('Histórico');
  await input('[aria-label="Buscar conversa"]', '');
  await click('[title="Arquivar conversa"]');
  await until(
    `document.querySelector('.ai-empty')?.textContent.includes('Suas conversas')`,
  );
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await textClick('Conversa');
  await screenshot('mobile');
  assert.ok(
    await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    'Mobile page overflow',
  );
  await send('Page.navigate', { url: base + '/widget' });
  await until(`!!document.querySelector('.ai-widget-trigger')`);
  assert.equal(
    await evaluate('!!document.querySelector(".ai-widget-panel")'),
    false,
  );
  await click('.ai-widget-trigger');
  await until(`!!document.querySelector('.is-compact .ai-summary strong')`);
  await until(`document.querySelectorAll('.is-compact .ai-suggestions button').length===4`);
  await screenshot('widget-mobile');
  assert.ok(
    await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    'Widget overflow',
  );
  await input('textarea', 'Rascunho preservado');
  await click('[aria-label="Minimizar chat"]');
  await click('.ai-widget-trigger');
  assert.equal(
    await evaluate('document.querySelector("textarea").value'),
    'Rascunho preservado',
  );
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot('widget-desktop');
  await click('[aria-label="Ampliar chat"]');
  assert.ok(
    await evaluate(
      'document.querySelector(".ai-widget-panel").getBoundingClientRect().width>480',
    ),
  );
  assert.equal(
    await evaluate('document.querySelector("textarea").value'),
    'Rascunho preservado',
  );
  await click('[aria-label="Reduzir chat"]');
  owner = true;
  await click('[aria-label="Atualizar saldo e histórico"]');
  await until('!!document.querySelector(".ai-notice")');
  assert.equal(
    await evaluate('document.querySelector(".ai-messages").scrollTop'),
    0,
  );
  await screenshot('widget-owner');
  owner = false;
  balance = 0;
  await click('[aria-label="Atualizar saldo e histórico"]');
  await until(`document.querySelector('textarea').disabled`);
  assert.equal(
    await evaluate('document.querySelector(".ai-composer button").disabled'),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: starter suggestions (6/4) sent on click, follow-ups under the last answer, send, balance, failed send recovery, concurrency, history search/open/archive, aggregate usage, preferences, mobile layout, widget minimize and zero credits.',
  );
} finally {
  await send('Browser.close');
  server.close();
}
