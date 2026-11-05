// Run with: node scripts/test-livechat.cjs
// The rules of the live chat (pure), then the whole path in the development database on a test company of its own
// ("zz-teste-livechat", left archived): a ticket, the web chat, the owner's answers, the unread counters, closing and reopening,
// the WhatsApp channel from a simulated Evolution webhook (nothing is sent anywhere), and the isolation between companies.
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
const rules = require('../lib/livechat/rules.ts');
const { sql } = require('../lib/db.ts');
const store = require('../lib/livechat/store.ts');
const { webhookToken, webhookTokenMatches, sendOwnerReply, sendOwnerAttachment, endConversation } = require('../lib/livechat/whatsapp.ts');

// Evolution is always simulated. Calls go to `evo.scope` while a test is looking, and to `evo.sink` otherwise.
const stamp = Date.now();
const realFetch = global.fetch;
process.env.EVOLUTION_API_URL = 'http://evolution.test';
process.env.EVOLUTION_API_KEY = 'test-key';
const evo = { sink: [], scope: null, fail: false, ids: 0 };
global.fetch = async (url, init) => {
  if (!String(url).startsWith('http://evolution.test')) return realFetch(url, init);
  (evo.scope ?? evo.sink).push({ url: String(url), body: JSON.parse(init.body) });
  evo.ids += 1;
  return evo.fail ? { ok: false, status: 500, text: async () => 'down', json: async () => ({}) } : { ok: true, status: 200, text: async () => '', json: async () => ({ key: { id: `WA-MOCK-${stamp}-${evo.ids}` } }) };
};

// ------------------------------------------------------------------------------------------------------------- rules

const upsert = (key, extra = {}) => ({
  event: 'messages.upsert',
  instance: 'nextrotta-suporte',
  data: { key: { remoteJid: '5521988887777@s.whatsapp.net', fromMe: false, id: 'WA-1' }, pushName: 'Maria', message: { conversation: 'Oi, preciso de ajuda' }, messageTimestamp: 1_793_000_000, ...key, ...extra },
});

test('rules: a text message of the webhook becomes an inbound message', () => {
  const [message] = rules.parseEvolutionWebhook(upsert({}));
  assert.deepEqual([message.kind, message.phone, message.name, message.text, message.media, message.fromMe, message.waId], ['message', '5521988887777', 'Maria', 'Oi, preciso de ajuda', false, false, 'WA-1']);
  assert.equal(message.at.getTime(), 1_793_000_000_000);
});

test('rules: text of every shape, and a placeholder for what only WhatsApp can open', () => {
  assert.equal(rules.readMessageText({ extendedTextMessage: { text: 'link https://x.com' } }).text, 'link https://x.com');
  assert.deepEqual(rules.readMessageText({ imageMessage: { caption: 'o defeito' } }), { text: '📷 Imagem: o defeito', media: true });
  assert.deepEqual(rules.readMessageText({ audioMessage: {} }), { text: '🎤 Áudio', media: true });
  assert.equal(rules.readMessageText({ reactionMessage: {} }), null, 'reactions and the like are not messages');
});

test('rules: groups, broadcasts, other events and the older list shape', () => {
  assert.deepEqual(rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '1203630@g.us', id: 'G' } })), []);
  assert.deepEqual(rules.parseEvolutionWebhook(upsert({ key: { remoteJid: 'status@broadcast', id: 'S' } })), []);
  assert.deepEqual(rules.parseEvolutionWebhook({ event: 'presence.update', data: {} }), []);
  assert.deepEqual(rules.parseEvolutionWebhook({ event: 'CONNECTION_UPDATE', data: { state: 'open' } }), [{ kind: 'connection', state: 'open' }]);
  const list = rules.parseEvolutionWebhook({ event: 'MESSAGES_UPSERT', data: [upsert({}).data, upsert({ key: { remoteJid: '5511977776666@s.whatsapp.net', fromMe: true, id: 'WA-2' } }).data] });
  assert.equal(list.length, 2);
  assert.equal(list[1].fromMe, true);
  assert.equal(rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '99887766@lid', remoteJidAlt: '5521977792422@s.whatsapp.net', id: 'L' } }))[0].phone, '5521977792422', 'the real number behind an internal id');
  assert.deepEqual(rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '99887766@lid', id: 'L2' } })), [], 'no number, nobody to answer');
});

test('rules: the same phone written differently, with or without the ninth digit', () => {
  assert.ok(rules.samePhone('(21) 99779-2422', '5521997792422'));
  assert.ok(rules.samePhone('21 9779-2422', '5521997792422'));
  assert.ok(!rules.samePhone('(11) 99779-2422', '5521997792422'), 'another area code');
  assert.ok(!rules.samePhone('', '5521997792422'));
});

test('rules: messages are cleaned, previews are short, the owner alert is once per window', () => {
  assert.equal(rules.cleanMessage('  oi\r\ntudo bem  '), 'oi\ntudo bem');
  assert.equal(rules.cleanMessage('x'.repeat(5000)).length, rules.MAX_MESSAGE_LENGTH);
  assert.equal(rules.cleanMessage(null), '');
  assert.equal(rules.previewOf('a\n\n b'), 'a b');
  assert.ok(rules.previewOf('x'.repeat(200)).length <= 90);
  const t = Date.UTC(2026, 10, 5, 12, 0, 0);
  assert.equal(rules.ownerAlertKey('c1', t), rules.ownerAlertKey('c1', t + 5 * 60_000));
  assert.notEqual(rules.ownerAlertKey('c1', t), rules.ownerAlertKey('c1', t + 11 * 60_000));
});

test('webhook token: derived from the secret, checked in constant time', () => {
  assert.match(webhookToken(), /^[0-9a-f]{64}$/);
  assert.ok(webhookTokenMatches(webhookToken()));
  assert.ok(!webhookTokenMatches('x'.repeat(64)));
  assert.ok(!webhookTokenMatches(null));
  assert.ok(!webhookTokenMatches(''));
});

// ------------------------------------------------------------------------------------------------------------ database

const SLUG = 'zz-teste-livechat';
let org;
let other;
let user;
let ticket;
let otherTicket;
const extraTickets = [];
async function makeTicket(organizationId, userId, title) {
  const row = await sql`
    INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category)
    VALUES (${organizationId}, ${userId}, ${title}, 'Descrição do chamado de teste', 'support', 'billing') RETURNING id`;
  return String(row[0].id);
}

/** Runs `run(calls)` with the calls to Evolution collected in `calls` (and made to fail when asked to). */
async function withEvolution(run, { fail = false } = {}) {
  const calls = [];
  evo.scope = calls;
  evo.fail = fail;
  try {
    return await run(calls);
  } finally {
    evo.scope = null;
    evo.fail = false;
  }
}

test('setup: a test company with a user and a ticket, and another company', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste livechat', 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET status = 'active', deleted_at = NULL WHERE id = ${org}`;
  user = (await sql`SELECT id FROM users WHERE organization_id = ${org} AND deleted_at IS NULL LIMIT 1`)[0]?.id
    ?? (await sql`INSERT INTO users (organization_id, email, name, role, password_hash) VALUES (${org}, ${`chat-${stamp}@exemplo.com`}, 'Carla Chat', 'admin', 'x') RETURNING id`)[0].id;
  other = (await sql`SELECT id FROM organizations WHERE slug = 'kappa'`)[0].id;
  // Earlier runs: close what is left open so the unique rules start clean.
  await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW() WHERE (organization_id = ${org} OR contact_phone IN ('5521955550001', '5521955550002')) AND status = 'open'`;
  // Earlier runs must not count toward the hourly limit of welcomes on WhatsApp.
  await sql`UPDATE livechat_conversations SET created_at = created_at - interval '3 hours' WHERE organization_id = ${org}`;
  ticket = await makeTicket(org, user, `Teste de chat ${stamp}`);
  const otherUser = (await sql`SELECT id FROM users WHERE organization_id = ${other} AND role = 'admin' LIMIT 1`)[0].id;
  otherTicket = await makeTicket(other, otherUser, `Chamado de outra empresa ${stamp}`);
});

let conversation;

test('web: the customer starts the chat in the ticket, once', async () => {
  conversation = await store.startWebConversation({ organizationId: org, userId: user, ticketId: ticket, userName: 'Carla Chat' });
  assert.deepEqual([conversation.channel, conversation.status, conversation.urgent, conversation.organizationId, conversation.ticketId], ['web', 'open', true, org, ticket]);
  const again = await store.startWebConversation({ organizationId: org, userId: user, ticketId: ticket, userName: 'Carla Chat' });
  assert.equal(again.id, conversation.id, 'one open chat per ticket');
  const concurrent = await Promise.all([1, 2, 3].map(() => store.startWebConversation({ organizationId: org, userId: user, ticketId: ticket, userName: 'Carla Chat' })));
  assert.ok(concurrent.every((item) => item.id === conversation.id), 'concurrent starts give the same chat');
});

test('an urgent ticket opens the chat at once, unread, with high priority; a normal one does not', async () => {
  const { createBugReport, getBugReport } = require('../lib/platform/bugs.ts');
  const base = { type: 'support', category: 'billing', description: 'Descrição longa o bastante para o teste' };
  const urgent = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Urgente ${stamp}`, urgent: true });
  extraTickets.push(urgent.id);
  const found = await store.findWebConversation(urgent.id);
  assert.ok(found, 'the conversation exists before the customer writes anything');
  assert.deepEqual([found.status, found.urgent, found.unreadOwner, found.lastMessagePreview], ['open', true, 1, 'Descrição longa o bastante para o teste'], 'the description is the first message');
  const owner = await getBugReport(urgent.id, { kind: 'owner' });
  assert.equal(owner.report.priority, 'high');
  assert.equal(owner.report.channel, 'chat');
  assert.deepEqual([owner.chat.id, owner.chat.status, owner.chat.unread], [found.id, 'open', 1], 'the owner sees the chat from the ticket');
  assert.equal((await getBugReport(urgent.id, { kind: 'organization', organizationId: org })).chat, null, 'the customer side has no owner data');
  assert.ok((await store.listConversations({ status: 'open' })).some((item) => item.id === found.id), 'it is in the inbox');
  assert.equal((await store.getMessages(found.id)).filter((message) => message.kind === 'system').length, 1);

  const normal = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Normal ${stamp}` });
  extraTickets.push(normal.id);
  assert.equal(await store.findWebConversation(normal.id), null, 'no chat without "urgent"');
  assert.equal((await getBugReport(normal.id, { kind: 'owner' })).report.priority, 'medium');
  assert.equal((await getBugReport(normal.id, { kind: 'owner' })).report.channel, 'case');

  // only support tickets can be urgent
  const bug = await createBugReport({ organizationId: org, userId: user }, { type: 'bug', title: `Bug ${stamp}`, description: 'Descrição longa o bastante para o teste', urgent: true });
  extraTickets.push(bug.id);
  assert.equal(await store.findWebConversation(bug.id), null);
  assert.equal((await getBugReport(bug.id, { kind: 'owner' })).report.priority, 'medium');
});

test('rules: the mirrored text names the ticket, and its echo is recognized', () => {
  assert.equal(rules.mirroredText(1015, 'Já estou olhando'), '*Suporte NextRotta* — chamado #1015\nJá estou olhando');
  assert.equal(rules.mirroredText(null, 'oi'), '*Suporte NextRotta*\noi');
  assert.ok(rules.isMirroredText(rules.mirroredText(7, 'x')));
  assert.ok(!rules.isMirroredText('Obrigado, estou aguardando'));
});

test('mirror to the customer WhatsApp: the number on the urgent ticket, replies out, answers back, no doubles', async () => {
  const { createBugReport, getBugReport } = require('../lib/platform/bugs.ts');
  await assert.rejects(createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: 'Número ruim', description: 'Descrição longa o bastante', urgent: true, whatsapp: '123' }), /não é válido/);

  const ticketRow = await createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: `Espelho ${stamp}`, description: 'Descrição longa o bastante para o teste', urgent: true, whatsapp: '(21) 95555-0003' });
  extraTickets.push(ticketRow.id);
  const conv = await store.findWebConversation(ticketRow.id);
  assert.equal(conv.contactPhone, '5521955550003', 'stored as digits with the country code');
  const number = (await getBugReport(ticketRow.id, { kind: 'owner' })).report.ticketNumber;

  // Evolution is simulated: what would go out is recorded, nothing is sent.
  const calls = [];
  evo.scope = calls;
  let fail = false;
  const setFail = (value) => { fail = value; evo.fail = value; };
  try {
    // 1. the owner answers in the panel: stored in the chat AND mirrored with the ticket named
    const reply = await sendOwnerReply(conv.id, 'Já estou olhando a cobrança.');
    assert.equal(reply.whatsapp, 'sent');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/message\/sendText\/nextrotta-suporte$/);
    assert.deepEqual([calls[0].body.number, calls[0].body.text], ['5521955550003', `*Suporte NextRotta* — chamado #${number}\nJá estou olhando a cobrança.`]);
    assert.equal((await store.getMessages(conv.id)).filter((m) => m.direction === 'out' && m.kind === 'text').length, 2, 'the welcome and this reply');

    // 2. WhatsApp echoes what was sent (fromMe, with the prefix): not a second message
    const echo = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550003@s.whatsapp.net', fromMe: true, id: 'WA-OUT-1' } }, { message: { conversation: calls[0].body.text }, messageTimestamp: Math.floor(Date.now() / 1000) + 1 }))[0];
    assert.equal(await store.storeWhatsAppMessage(echo), null);

    // 3. the customer answers on WhatsApp (and without the 9th digit): it lands in the same web chat, not in a new conversation
    const answer = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '552155550003@s.whatsapp.net', fromMe: false, id: `WA-${stamp}-IN` } }, { message: { conversation: 'Obrigado, estou aguardando' }, pushName: 'Carla', messageTimestamp: Math.floor(Date.now() / 1000) + 2 }))[0];
    assert.ok(await store.storeWhatsAppMessage(answer));
    const after = await store.getMessages(conv.id);
    assert.deepEqual(after.filter((m) => m.kind === 'text').map((m) => [m.direction, m.body]), [['in', 'Descrição longa o bastante para o teste'], ['out', rules.chatWelcomeMessage({ name: 'Carla Chat', ticketNumber: number, channel: 'chat' })], ['out', 'Já estou olhando a cobrança.'], ['in', 'Obrigado, estou aguardando']]);
    assert.equal((await store.getConversation(conv.id)).unreadOwner, 2, 'one from the urgent opening and one from the answer');
    assert.equal((await store.listConversations({ status: 'open', search: '552155550003' })).filter((c) => c.channel === 'whatsapp').length, 0, 'no conversation of its own');

    // 4. what the owner types on the phone (no prefix) is the owner's message in the chat
    const typed = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550003@s.whatsapp.net', fromMe: true, id: `WA-${stamp}-PH` } }, { message: { conversation: 'Resolvido por aqui' }, messageTimestamp: Math.floor(Date.now() / 1000) + 3 }))[0];
    assert.ok(await store.storeWhatsAppMessage(typed));
    assert.equal((await store.getMessages(conv.id)).at(-1).direction, 'out');

    // 5. unchecked "send also on WhatsApp": nothing goes out
    calls.length = 0;
    assert.equal((await sendOwnerReply(conv.id, 'Só no chat', { mirror: false })).whatsapp, 'skipped');
    assert.equal(calls.length, 0);

    // 6. WhatsApp down: the reply is kept in the chat and the failure is reported, not thrown
    setFail(true);
    const failed = await sendOwnerReply(conv.id, 'Vai falhar no WhatsApp');
    assert.equal(failed.whatsapp, 'failed');
    assert.ok(failed.whatsappError);
    assert.ok((await store.getMessages(conv.id)).some((m) => m.body === 'Vai falhar no WhatsApp'), 'still in the chat');
    setFail(false);

    // 7. a web chat without a WhatsApp number never calls Evolution
    calls.length = 0;
    const plain = await createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: `Sem número ${stamp}`, description: 'Descrição longa o bastante para o teste', urgent: true });
    extraTickets.push(plain.id);
    const plainConv = await store.findWebConversation(plain.id);
    assert.equal(plainConv.contactPhone, null);
    calls.length = 0; // opening it alerted the owner on the official number; what follows is the reply
    assert.equal((await sendOwnerReply(plainConv.id, 'Resposta só no chat')).whatsapp, 'skipped');
    assert.equal(calls.length, 0);

    // 8. the customer adds the number later in the window, and removes it
    const added = await store.setConversationPhone(plainConv.id, '5521955550004');
    assert.equal(added.contactPhone, '5521955550004');
    assert.equal((await store.setConversationPhone(plainConv.id, null)).contactPhone, null);
  } finally {
    evo.scope = null;
    evo.fail = false;
  }
});

test('web: messages both ways, unread counters, previews and order', async () => {
  await store.sendCustomerMessage(conversation, 'Carla Chat', 'Preciso de ajuda urgente');
  let current = await store.getConversation(conversation.id);
  assert.equal(current.unreadOwner, 1);
  assert.equal(current.lastMessagePreview, 'Preciso de ajuda urgente');

  await store.markReadByOwner(conversation.id);
  await store.storeOwnerMessage(conversation.id, 'Oi Carla, já estou olhando.');
  current = await store.getConversation(conversation.id);
  assert.deepEqual([current.unreadOwner, current.unreadCustomer], [0, 1], 'the owner read it; the customer has an answer waiting');
  await store.markReadByCustomer(conversation.id);

  const all = await store.getMessages(conversation.id);
  assert.deepEqual(all.map((message) => [message.direction, message.kind]), [['in', 'system'], ['in', 'text'], ['out', 'text']]);
  const newer = await store.getMessages(conversation.id, all[1].createdAt);
  assert.deepEqual(newer.map((message) => message.body), ['Oi Carla, já estou olhando.'], 'after= returns only the newer ones');
  await assert.rejects(store.sendCustomerMessage(conversation, 'Carla Chat', '   '), /Escreva/);
});

test('web: the flood limit stops a customer sending too fast', async () => {
  const results = [];
  for (let i = 0; i < rules.MAX_CUSTOMER_MESSAGES_PER_MINUTE + 3; i += 1) results.push(await store.sendCustomerMessage(conversation, 'Carla Chat', `msg ${i}`).then(() => 'ok', (error) => error.message));
  assert.ok(results.some((result) => /Muitas mensagens/.test(String(result))), 'some were refused');
  assert.ok(results.filter((result) => result === 'ok').length <= rules.MAX_CUSTOMER_MESSAGES_PER_MINUTE, 'no more than the limit went through');
  // a minute later the customer can write again
  await sql`UPDATE livechat_messages SET created_at = created_at - interval '2 minutes' WHERE conversation_id = ${conversation.id}`;
  await sql`UPDATE livechat_conversations SET last_message_at = last_message_at - interval '2 minutes' WHERE id = ${conversation.id}`;
});

test('web: closing is final for the customer (a new chat is started), the owner can reopen', async () => {
  const closed = await store.closeConversation(conversation.id, 'owner');
  assert.deepEqual([closed.status, closed.unreadOwner], ['closed', 0]);
  assert.equal((await store.findWebConversation(ticket)).id, conversation.id, 'the last chat of the ticket is still found');
  await assert.rejects(store.sendCustomerMessage(closed, 'Carla Chat', 'Voltei, ainda com problema'), /encerrado/);
  assert.equal((await store.getConversation(conversation.id)).status, 'closed', 'the customer did not reopen it');
  assert.equal((await sql`SELECT status FROM bug_reports WHERE id = ${ticket}`)[0].status, 'resolved', 'ending the chat concluded its ticket');
  const reopened = await store.reopenConversation(conversation.id);
  assert.deepEqual([reopened.status, reopened.closedAt], ['open', null]);
  assert.equal((await sql`SELECT status FROM bug_reports WHERE id = ${ticket}`)[0].status, 'investigating', 'and reopening it reopens the ticket');
  assert.equal((await store.getMessages(conversation.id)).filter((message) => message.kind === 'system').length, 2, 'the start and the closing are in the history');
});

test('whatsapp: a message from an unknown number opens a conversation; the same message twice counts once', async () => {
  const [message] = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550001@s.whatsapp.net', fromMe: false, id: `WA-${stamp}-1` } }));
  assert.ok(await store.storeWhatsAppMessage(message));
  assert.equal(await store.storeWhatsAppMessage(message), null, 'a delivery repeated is ignored');
  const list = await store.listConversations({ status: 'open', search: '5521955550001' });
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].channel, list[0].contactName, list[0].organizationId, list[0].unreadOwner], ['whatsapp', 'Maria', null, 1]);
});

test('whatsapp: what the owner types on the phone is stored as the owner\'s, and an echo of the panel is not doubled', async () => {
  const typed = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550001@s.whatsapp.net', fromMe: true, id: `WA-${stamp}-2` } }, { message: { conversation: 'Respondido pelo celular' }, pushName: 'Eu', messageTimestamp: 1_793_000_010 }))[0];
  await store.storeWhatsAppMessage(typed);
  const [conv] = await store.listConversations({ status: 'open', search: '5521955550001' });
  const messages = await store.getMessages(conv.id);
  assert.deepEqual(messages.map((message) => message.direction), ['in', 'out']);
  assert.equal(conv.unreadOwner, 1, 'answering does not add to what the owner has to read');

  // the panel sent a message and WhatsApp gave it an id; the webhook echo of the same id must not become a second message
  await store.storeOwnerMessage(conv.id, 'Enviado pelo painel', { waMessageId: `WA-${stamp}-3` });
  const echo = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550001@s.whatsapp.net', fromMe: true, id: `WA-${stamp}-3` } }, { message: { conversation: 'Enviado pelo painel' }, messageTimestamp: 1_793_000_020 }))[0];
  assert.equal(await store.storeWhatsAppMessage(echo), null);
  assert.equal((await store.getMessages(conv.id)).length, 3);
});

test('whatsapp: a number that belongs to a technician is matched to the company, with the technician\'s name', async () => {
  const technician = (await sql`INSERT INTO technicians (organization_id, name, email, phone) VALUES (${org}, 'Técnico Conhecido', ${`tec-${stamp}@exemplo.com`}, '(21) 95555-0002') RETURNING id`)[0].id;
  const [message] = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550002@s.whatsapp.net', fromMe: false, id: `WA-${stamp}-4` } }, { pushName: 'zé' }));
  await store.storeWhatsAppMessage(message);
  const [conv] = await store.listConversations({ status: 'open', search: '5521955550002' });
  assert.deepEqual([conv.organizationId, conv.organizationName, conv.contactName], [org, 'Teste livechat', 'zé']);
  await sql`UPDATE technicians SET deleted_at = NOW() WHERE id = ${technician}`;
});

test('inbox: unread summary counts open conversations with something unread', async () => {
  const summary = await store.unreadSummary();
  assert.ok(summary.conversations >= 2 && summary.messages >= 2);
});

test('isolation: the chat of a ticket belongs to its company (the route checks the ticket against the organization)', async () => {
  const { getBugReport } = require('../lib/platform/bugs.ts');
  await assert.rejects(getBugReport(otherTicket, { kind: 'organization', organizationId: org }), /não encontrado/i);
  await assert.rejects(getBugReport(ticket, { kind: 'organization', organizationId: other }), /não encontrado/i);
  assert.equal((await getBugReport(ticket, { kind: 'organization', organizationId: org })).report.id, ticket);
  assert.equal(await store.findWebConversation(otherTicket), null, 'no chat was ever started on the other ticket');
});

test('separation: chat tickets stay out of the owner\'s case lists and each kind refuses what belongs to the other', async () => {
  const { createBugReport, getBugReport, listBugReports, addBugMessage } = require('../lib/platform/bugs.ts');
  const ownerId = (await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL LIMIT 1`)[0].id;
  const base = { type: 'support', category: 'billing', description: 'Descrição longa o bastante para o teste' };
  const chat = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Chat ${stamp}`, channel: 'chat' });
  const written = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Caso ${stamp}` });
  extraTickets.push(chat.id, written.id);
  const ids = (list) => list.map((item) => item.id);
  assert.ok(ids(await listBugReports({ organizationId: org, channel: 'case' })).includes(written.id));
  assert.ok(!ids(await listBugReports({ organizationId: org, channel: 'case' })).includes(chat.id), 'a live chat is not a case in the owner\'s Reports');
  assert.deepEqual(ids(await listBugReports({ organizationId: org, channel: 'chat' })).filter((id) => [chat.id, written.id].includes(id)), [chat.id]);
  const everything = ids(await listBugReports({ organizationId: org }));
  assert.ok([chat.id, written.id].every((id) => everything.includes(id)), 'the customer\'s own list has both');

  // the written thread belongs to cases; a live chat is answered in the Livechat (internal notes stay possible)
  await assert.rejects(addBugMessage(chat.id, { userId: user, fromOwner: false, organizationId: org }, { text: 'oi' }), /Livechat/);
  await assert.rejects(addBugMessage(chat.id, { userId: ownerId, fromOwner: true }, { text: 'resposta' }), /Livechat/);
  await addBugMessage(chat.id, { userId: ownerId, fromOwner: true }, { text: 'nota interna', internal: true });
  await addBugMessage(written.id, { userId: ownerId, fromOwner: true }, { text: 'resposta por escrito' });
});

test('ending a live chat says thanks in the chat and on WhatsApp, concludes the ticket, and cannot be reopened by the customer', async () => {
  const { createBugReport, getBugReport } = require('../lib/platform/bugs.ts');
  const t = await createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: `Fim ${stamp}`, description: 'Descrição longa o bastante para o teste', channel: 'chat', whatsapp: '(21) 95555-0004' });
  extraTickets.push(t.id);
  const conv = await store.findWebConversation(t.id);
  const number = (await getBugReport(t.id, { kind: 'owner' })).report.ticketNumber;

  await withEvolution(async (calls) => {
    const ended = await endConversation(conv.id, 'owner', rules.chatClosingMessage('web'));
    assert.deepEqual([ended.conversation.status, ended.whatsapp], ['closed', 'sent']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.number, '5521955550004');
    assert.match(calls[0].body.text, new RegExp(`chamado #${number}`));
    assert.match(calls[0].body.text, /Obrigado pelo seu contato/);
    const messages = await store.getMessages(conv.id);
    assert.ok(messages.some((m) => m.direction === 'out' && m.kind === 'text' && /Obrigado pelo seu contato/.test(m.body)), 'the thank-you is in the chat');
    assert.equal(messages.at(-1).body, 'Conversa encerrada pelo suporte.');
    assert.equal((await getBugReport(t.id, { kind: 'owner' })).report.status, 'resolved');
    await assert.rejects(store.sendCustomerMessage(ended.conversation, 'Carla Chat', 'oi de novo'), /encerrado/);

    // ended again: nothing more is sent; reopened by the owner and ended without a message: no WhatsApp call
    await store.reopenConversation(conv.id);
    calls.length = 0;
    const silent = await endConversation(conv.id, 'owner', null);
    assert.deepEqual([silent.conversation.status, silent.whatsapp, calls.length], ['closed', 'skipped', 0]);
  });

  // the customer ends it themselves: the thank-you is the same
  const t2 = await createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: `Fim cliente ${stamp}`, description: 'Descrição longa o bastante para o teste', channel: 'chat' });
  extraTickets.push(t2.id);
  const conv2 = await store.findWebConversation(t2.id);
  const byCustomer = await endConversation(conv2.id, 'customer', rules.chatClosingMessage('web'));
  assert.equal(byCustomer.conversation.status, 'closed');
  assert.ok((await store.getMessages(conv2.id)).some((m) => /Obrigado pelo seu contato/.test(m.body)));

  // a WhatsApp conversation: the thank-you goes to that number; with Evolution down it still ends and says so
  const [incoming] = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550001@s.whatsapp.net', fromMe: false, id: `WA-${stamp}-END` } }, { messageTimestamp: Math.floor(Date.now() / 1000) }));
  await store.storeWhatsAppMessage(incoming);
  const wa = (await store.listConversations({ status: 'open', search: '5521955550001' })).find((c) => c.channel === 'whatsapp');
  await withEvolution(async (calls) => {
    const ended = await endConversation(wa.id, 'owner', rules.chatClosingMessage('whatsapp'));
    assert.deepEqual([ended.conversation.status, ended.whatsapp, calls[0].body.number], ['closed', 'sent', '5521955550001']);
    assert.match(calls[0].body.text, /escreva de novo para este número/);
  });
  const [again] = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550001@s.whatsapp.net', fromMe: false, id: `WA-${stamp}-END2` } }, { messageTimestamp: Math.floor(Date.now() / 1000) + 1 }));
  await store.storeWhatsAppMessage(again);
  const wa2 = (await store.listConversations({ status: 'open', search: '5521955550001' })).find((c) => c.channel === 'whatsapp');
  await withEvolution(async () => {
    const ended = await endConversation(wa2.id, 'owner', rules.chatClosingMessage('whatsapp'));
    assert.deepEqual([ended.conversation.status, ended.whatsapp], ['closed', 'failed']);
    assert.ok(ended.whatsappError);
  }, { fail: true });
});

test('concluding a written case sends the closing message (default, edited or none); a chat ticket and a reopening send none', async () => {
  const { createBugReport, updateBugReport, getBugReport } = require('../lib/platform/bugs.ts');
  const ownerId = (await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL LIMIT 1`)[0].id;
  const base = { type: 'support', category: 'billing', description: 'Descrição longa o bastante para o teste' };
  const mk = async (title, extra = {}) => {
    const created = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `${title} ${stamp}`, ...extra });
    extraTickets.push(created.id);
    return created.id;
  };
  const last = async (id) => (await getBugReport(id, { kind: 'owner' })).messages.at(-1);

  const a = await mk('Caso A');
  const number = (await getBugReport(a, { kind: 'owner' })).report.ticketNumber;
  await updateBugReport(a, { status: 'resolved' }, { id: ownerId });
  const message = await last(a);
  assert.equal(message.fromOwner, true);
  assert.match(message.text, new RegExp(`chamado #${number} foi encerrado`));
  assert.match(message.text, /novo chamado/);

  const b = await mk('Caso B');
  await updateBugReport(b, { status: 'resolved', closingMessage: 'Texto editado pelo dono.' }, { id: ownerId });
  assert.equal((await last(b)).text, 'Texto editado pelo dono.');

  const c = await mk('Caso C');
  await updateBugReport(c, { status: 'resolved', closingMessage: '' }, { id: ownerId });
  assert.equal(await last(c), undefined, 'skipped on purpose');

  const d = await mk('Caso D');
  await updateBugReport(d, { status: 'investigating' }, { id: ownerId });
  assert.equal(await last(d), undefined, 'no goodbye for a ticket that is not being closed');

  const chat = await mk('Chat E', { channel: 'chat' });
  await updateBugReport(chat, { status: 'resolved' }, { id: ownerId });
  assert.equal(await last(chat), undefined, 'a live chat says goodbye in the Livechat, not in a written thread');
});

test('rules: attachments (what is accepted), file names, the first message', () => {
  const ok = (type, size = 1000) => rules.attachmentProblem({ type, size });
  assert.equal(ok('image/png'), null);
  assert.equal(ok('application/pdf'), null);
  assert.match(ok('image/png', 0), /vazio/);
  assert.match(ok('image/png', 5 * 1024 * 1024), /4 MB/);
  for (const bad of ['text/html', 'image/svg+xml', 'application/x-msdownload', 'application/javascript', '']) assert.match(ok(bad), /não é aceito/, `${bad} is refused`);
  assert.ok(rules.isImageType('image/webp') && !rules.isImageType('image/svg+xml') && !rules.isImageType('application/pdf'));
  assert.equal(rules.safeFileName('..\\..\\etc/passwd', 'text/plain'), 'passwd');
  assert.equal(rules.safeFileName('a<b>:c|d?.png', 'image/png'), 'a b c d .png');
  assert.equal(rules.safeFileName('', 'image/png'), 'arquivo.png', 'a pasted screenshot has no name');
  assert.equal(rules.safeFileName('x'.repeat(300) + '.pdf', 'application/pdf').length, 120);
  assert.equal(rules.attachmentPreview('print.png'), '📎 print.png');
  const welcome = rules.chatWelcomeMessage({ name: 'Carla Souza', ticketNumber: 1120, channel: 'chat' });
  assert.match(welcome, /^Olá, Carla! Recebemos o seu chamado urgente #1120\. Em instantes um de nossos atendentes vai falar com você por aqui\./);
  assert.match(welcome, /anexar aqui no chat/);
  assert.match(rules.chatWelcomeMessage({ name: null, ticketNumber: null, channel: 'whatsapp' }), /^Olá! Recebemos o seu chamado urgente\. .*no WhatsApp, e no chat do sistema.*pode mandar por aqui mesmo/);
});

test('opening a live chat: the team\'s first message is in the chat, on the customer WhatsApp (limited), and the owner is told', async () => {
  const { createBugReport, getBugReport } = require('../lib/platform/bugs.ts');
  const base = { type: 'support', category: 'billing', description: 'Descrição longa o bastante para o teste', channel: 'chat' };
  evo.sink.length = 0;

  const withNumber = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Boas-vindas ${stamp}`, whatsapp: '(21) 95555-0006' });
  extraTickets.push(withNumber.id);
  const conv = await store.findWebConversation(withNumber.id);
  const number = (await getBugReport(withNumber.id, { kind: 'owner' })).report.ticketNumber;
  const messages = await store.getMessages(conv.id);
  const welcome = messages.find((m) => m.direction === 'out' && m.kind === 'text');
  assert.ok(welcome, 'the welcome is in the chat');
  assert.match(welcome.body, new RegExp(`Olá, Carla! Recebemos o seu chamado urgente #${number}`));
  assert.equal(conv.lastMessagePreview, 'Descrição longa o bastante para o teste', 'it does not replace the customer\'s message in the inbox');
  assert.equal((await store.getConversation(conv.id)).unreadOwner, 1, 'and is not something for the owner to read');

  const toCustomer = evo.sink.filter((call) => call.body.number === '5521955550006');
  assert.equal(toCustomer.length, 1, 'the same welcome went to the customer\'s WhatsApp');
  assert.match(toCustomer[0].body.text, new RegExp(`^\\*Suporte NextRotta\\* — chamado #${number}\\n.*no WhatsApp, e no chat do sistema`));

  // the owner is told on the official number itself (the alerts WhatsApp is not configured)
  const settings = (await sql`SELECT data->'alerts' AS alerts FROM platform_settings LIMIT 1`)[0];
  if (!settings?.alerts?.phone) {
    const alert = evo.sink.find((call) => call.body.number === '5521997792422');
    assert.ok(alert, 'an alert went to the official number');
    assert.match(alert.body.text, /^🚨 \*NextRotta — Livechat \(urgente\)\*\n/);
    assert.match(alert.body.text, new RegExp(`Chamado #${number}`));
  }

  // without a number: only the chat
  evo.sink.length = 0;
  const plain = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Sem número ${stamp}` });
  extraTickets.push(plain.id);
  assert.ok((await store.getMessages((await store.findWebConversation(plain.id)).id)).some((m) => m.direction === 'out' && m.kind === 'text'), 'the chat still says it');
  assert.equal(evo.sink.filter((call) => call.url.endsWith('/message/sendText/nextrotta-suporte') && call.body.text.includes('Recebemos o seu chamado')).length, 0, 'nothing to WhatsApp without a number');

  // nobody can use this to message strangers: only a few welcomes per hour go out to numbers typed by the customer
  await sql`UPDATE livechat_conversations SET created_at = created_at - interval '3 hours' WHERE organization_id = ${org}`;
  evo.sink.length = 0;
  for (let i = 0; i < 8; i += 1) {
    const t = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Limite ${i} ${stamp}`, whatsapp: `(21) 95555-01${String(i).padStart(2, '0')}` });
    extraTickets.push(t.id);
  }
  const welcomesOut = evo.sink.filter((call) => /Recebemos o seu chamado/.test(call.body.text ?? '')).length;
  assert.equal(welcomesOut, 5, 'the sixth, seventh and eighth stayed in the chat');
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const savedBlobs = [];

test('attachments: kept in the company\'s own storage, charged to it when the customer sends them, served only through the system', async () => {
  const { saveChatFile, chatFileResponse } = require('../lib/livechat/files.ts');
  const { createBugReport } = require('../lib/platform/bugs.ts');
  const t = await createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: `Anexos ${stamp}`, description: 'Descrição longa o bastante para o teste', channel: 'chat' });
  extraTickets.push(t.id);
  const conv = await store.findWebConversation(t.id);
  const used = async () => Number((await sql`SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM organization_files WHERE organization_id = ${org}`)[0].n);
  const before = await used();

  // the customer pastes a screenshot with a text
  const saved = await saveChatFile({ organizationId: org, conversationId: conv.id, fileName: null, contentType: 'image/png', buffer: png });
  savedBlobs.push(saved.url);
  assert.deepEqual([saved.fileName, saved.contentType, saved.size], ['arquivo.png', 'image/png', png.length]);
  const sent = await store.sendCustomerAttachment(conv, 'Carla Chat', 'olha o erro', saved);
  assert.deepEqual([sent.body, sent.attachment.fileName, sent.attachment.size], ['olha o erro', 'arquivo.png', png.length]);
  assert.equal((await store.getConversation(conv.id)).lastMessagePreview, 'olha o erro');
  assert.equal(await used(), before + png.length, 'it counts against the company\'s storage');

  // only a file: the list shows its name
  const pdf = await saveChatFile({ organizationId: org, conversationId: conv.id, fileName: 'folha-outubro.pdf', contentType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  savedBlobs.push(pdf.url);
  await store.sendCustomerAttachment(conv, 'Carla Chat', '', pdf);
  assert.equal((await store.getConversation(conv.id)).lastMessagePreview, '📎 folha-outubro.pdf');
  const listed = (await store.getMessages(conv.id)).filter((m) => m.attachment);
  assert.deepEqual(listed.map((m) => m.attachment.fileName), ['arquivo.png', 'folha-outubro.pdf']);

  // served: the type comes from our record; an image shows in place, a pdf too, "download" saves; never sniffed
  const record = await store.getAttachment(listed[0].attachment.id);
  assert.deepEqual([record.organizationId, record.conversationId, record.contentType], [org, conv.id, 'image/png']);
  const inline = await chatFileResponse(record, false);
  assert.equal(inline.headers.get('content-type'), 'image/png');
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
  assert.equal(inline.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(inline.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await inline.arrayBuffer()), png, 'the same bytes come back');
  assert.match((await chatFileResponse(record, true)).headers.get('content-disposition'), /^attachment;/);
  const docx = { ...record, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  assert.match((await chatFileResponse(docx, false)).headers.get('content-disposition'), /^attachment;/, 'what the browser cannot show safely is downloaded');
  const forged = { ...record, contentType: 'text/html' };
  assert.equal((await chatFileResponse(forged, false)).headers.get('content-type'), 'application/octet-stream', 'a type that is not on the list is never trusted');
  assert.equal(await store.getAttachment('00000000-0000-0000-0000-000000000000'), null);
  assert.equal(await store.getAttachment('not-an-id'), null);
});

test('attachments from the team: sent through the official number as media, kept without charging the customer', async () => {
  const { createBugReport } = require('../lib/platform/bugs.ts');
  const t = await createBugReport({ organizationId: org, userId: user }, { type: 'support', category: 'billing', title: `Anexo equipe ${stamp}`, description: 'Descrição longa o bastante para o teste', channel: 'chat', whatsapp: '(21) 95555-0007' });
  extraTickets.push(t.id);
  const conv = await store.findWebConversation(t.id);
  const number = Number((await sql`SELECT ticket_number FROM bug_reports WHERE id = ${t.id}`)[0].ticket_number);
  const used = async () => Number((await sql`SELECT COALESCE(SUM(bytes), 0)::bigint AS n FROM organization_files WHERE organization_id = ${org}`)[0].n);
  const before = await used();
  const file = { buffer: png, fileName: 'orientacao.png', contentType: 'image/png' };

  await withEvolution(async (calls) => {
    const result = await sendOwnerAttachment(conv.id, file, 'Siga estes passos');
    assert.equal(result.whatsapp, 'sent');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/message\/sendMedia\/nextrotta-suporte$/);
    assert.deepEqual([calls[0].body.number, calls[0].body.mediatype, calls[0].body.mimetype, calls[0].body.fileName], ['5521955550007', 'image', 'image/png', 'orientacao.png']);
    assert.equal(calls[0].body.media, png.toString('base64'));
    assert.equal(calls[0].body.caption, `*Suporte NextRotta* — chamado #${number}\nSiga estes passos`);
    const stored = (await store.getMessages(conv.id)).find((m) => m.attachment?.fileName === 'orientacao.png');
    assert.equal(stored.direction, 'out');
    savedBlobs.push((await store.getAttachment(stored.attachment.id)).url);
    assert.equal(await used(), before, 'what the team sends is not charged to the customer');

    // a PDF is a document; "mirror: false" keeps it in the chat only
    calls.length = 0;
    const doc = await sendOwnerAttachment(conv.id, { buffer: Buffer.from('%PDF-1.4 x'), fileName: 'guia.pdf', contentType: 'application/pdf' }, '', { mirror: false });
    assert.equal(doc.whatsapp, 'skipped');
    assert.equal(calls.length, 0);
    savedBlobs.push((await store.getAttachment((await store.getMessages(conv.id)).find((m) => m.attachment?.fileName === 'guia.pdf').attachment.id)).url);
  });

  // WhatsApp down: on a web chat the file still reaches the chat, and the failure is reported
  await withEvolution(async () => {
    const failed = await sendOwnerAttachment(conv.id, { buffer: png, fileName: 'de-novo.png', contentType: 'image/png' }, '');
    assert.equal(failed.whatsapp, 'failed');
    assert.ok(failed.whatsappError);
    assert.ok((await store.getMessages(conv.id)).some((m) => m.attachment?.fileName === 'de-novo.png'));
    savedBlobs.push((await store.getAttachment((await store.getMessages(conv.id)).find((m) => m.attachment?.fileName === 'de-novo.png').attachment.id)).url);
  }, { fail: true });

  // on a WhatsApp conversation WhatsApp must accept the file first: nothing is stored when it does not
  const [incoming] = rules.parseEvolutionWebhook(upsert({ key: { remoteJid: '5521955550002@s.whatsapp.net', fromMe: false, id: `WA-${stamp}-ATT` } }, { messageTimestamp: Math.floor(Date.now() / 1000) }));
  await store.storeWhatsAppMessage(incoming);
  const wa = (await store.listConversations({ status: 'open', search: '5521955550002' })).find((c) => c.channel === 'whatsapp');
  await withEvolution(async () => {
    await assert.rejects(sendOwnerAttachment(wa.id, file, ''), /não foi enviado/);
    assert.equal((await store.getMessages(wa.id)).filter((m) => m.attachment).length, 0);
  }, { fail: true });
  await withEvolution(async (calls) => {
    assert.equal((await sendOwnerAttachment(wa.id, file, 'Segue o print')).whatsapp, 'sent');
    assert.equal(calls[0].body.caption, 'Segue o print', 'on a WhatsApp conversation there is no ticket prefix');
    savedBlobs.push((await store.getAttachment((await store.getMessages(wa.id)).find((m) => m.attachment).attachment.id)).url);
  });
});

after(async () => {
  // The only deletion allowed: the files of the test attachments.
  const { del } = require('@vercel/blob');
  for (const url of savedBlobs) await del(url).catch(() => undefined);
  global.fetch = realFetch;
});

after(async () => {
  await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW() WHERE (organization_id = ${org} OR contact_phone IN ('5521955550001', '5521955550002')) AND status = 'open'`;
  await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id IN (${ticket}, ${otherTicket}) AND status <> 'resolved'`;
  for (const id of extraTickets) await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id = ${id} AND status <> 'resolved'`;
  await sql`UPDATE organizations SET deleted_at = NOW(), status = 'canceled' WHERE id = ${org}`;
});
