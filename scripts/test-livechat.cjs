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
const { webhookToken, webhookTokenMatches } = require('../lib/livechat/whatsapp.ts');

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
const stamp = Date.now();

async function makeTicket(organizationId, userId, title) {
  const row = await sql`
    INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category)
    VALUES (${organizationId}, ${userId}, ${title}, 'Descrição do chamado de teste', 'support', 'billing') RETURNING id`;
  return String(row[0].id);
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
  assert.deepEqual([found.status, found.urgent, found.unreadOwner, found.lastMessagePreview], ['open', true, 1, `Urgente: Urgente ${stamp}`]);
  const owner = await getBugReport(urgent.id, { kind: 'owner' });
  assert.equal(owner.report.priority, 'high');
  assert.deepEqual([owner.chat.id, owner.chat.status, owner.chat.unread], [found.id, 'open', 1], 'the owner sees the chat from the ticket');
  assert.equal((await getBugReport(urgent.id, { kind: 'organization', organizationId: org })).chat, null, 'the customer side has no owner data');
  assert.equal((await store.listConversations({ status: 'open', search: `Urgente ${stamp}` })).length, 1, 'it is in the inbox');
  assert.equal((await store.getMessages(found.id)).filter((message) => message.kind === 'system').length, 1);

  const normal = await createBugReport({ organizationId: org, userId: user }, { ...base, title: `Normal ${stamp}` });
  extraTickets.push(normal.id);
  assert.equal(await store.findWebConversation(normal.id), null, 'no chat without "urgent"');
  assert.equal((await getBugReport(normal.id, { kind: 'owner' })).report.priority, 'medium');

  // only support tickets can be urgent
  const bug = await createBugReport({ organizationId: org, userId: user }, { type: 'bug', title: `Bug ${stamp}`, description: 'Descrição longa o bastante para o teste', urgent: true });
  extraTickets.push(bug.id);
  assert.equal(await store.findWebConversation(bug.id), null);
  assert.equal((await getBugReport(bug.id, { kind: 'owner' })).report.priority, 'medium');
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

test('web: closing, and a new message of the customer reopens the same conversation', async () => {
  const closed = await store.closeConversation(conversation.id, 'owner');
  assert.deepEqual([closed.status, closed.unreadOwner], ['closed', 0]);
  assert.equal((await store.findWebConversation(ticket)).id, conversation.id, 'the last chat of the ticket is still found');
  await store.sendCustomerMessage(closed, 'Carla Chat', 'Voltei, ainda com problema');
  const reopened = await store.getConversation(conversation.id);
  assert.deepEqual([reopened.status, reopened.closedAt], ['open', null]);
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

after(async () => {
  await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW() WHERE (organization_id = ${org} OR contact_phone IN ('5521955550001', '5521955550002')) AND status = 'open'`;
  await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id IN (${ticket}, ${otherTicket}) AND status <> 'resolved'`;
  for (const id of extraTickets) await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id = ${id} AND status <> 'resolved'`;
  await sql`UPDATE organizations SET deleted_at = NOW(), status = 'canceled' WHERE id = ${org}`;
});
