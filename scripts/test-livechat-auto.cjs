// Run with: node scripts/test-livechat-auto.cjs
// The automatic messages of the Livechat: the templates and business hours (pure), then, in the development database with the
// Evolution server always simulated (nothing is sent anywhere), saving them and the automatic replies to a message that arrives
// on WhatsApp. The settings found in the database are saved first and put back at the end.
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
const auto = require('../lib/livechat/auto-messages.ts');
const rules = require('../lib/livechat/rules.ts');
const { sql } = require('../lib/db.ts');
const store = require('../lib/livechat/store.ts');
const autoStore = require('../lib/livechat/auto-store.ts');
const wa = require('../lib/livechat/whatsapp.ts');

// Evolution is always simulated: every call is recorded here and answered with a new message id.
const stamp = Date.now();
const realFetch = global.fetch;
process.env.EVOLUTION_API_URL = 'http://evolution.test';
process.env.EVOLUTION_API_KEY = 'test-key';
const evo = { sent: [], ids: 0, fail: false };
global.fetch = async (url, init) => {
  if (!String(url).startsWith('http://evolution.test')) return realFetch(url, init);
  evo.sent.push({ url: String(url), body: JSON.parse(init.body) });
  evo.ids += 1;
  return evo.fail ? { ok: false, status: 500, text: async () => 'down', json: async () => ({}) } : { ok: true, status: 200, text: async () => '', json: async () => ({ key: { id: `WA-AUTO-${stamp}-${evo.ids}` } }) };
};
const texts = () => evo.sent.map((call) => call.body.text);

// ------------------------------------------------------------------------------------------------------------- pure

test('templates: the variables fill in and what is missing disappears with its punctuation', () => {
  assert.equal(auto.renderAutoMessage('Olá, {nome}! Seu chamado {chamado} foi encerrado.', { nome: 'Maria', chamado: '#12' }), 'Olá, Maria! Seu chamado #12 foi encerrado.');
  assert.equal(auto.renderAutoMessage('Olá, {nome}! Seu chamado {chamado} foi encerrado.', {}), 'Olá! Seu chamado foi encerrado.');
  assert.equal(auto.renderAutoMessage('Recebemos o chamado {chamado}. Já vamos.', {}), 'Recebemos o chamado. Já vamos.');
  assert.equal(auto.renderAutoMessage('linha 1\n{nome} \nlinha 3', {}), 'linha 1\n\nlinha 3');
  assert.equal(auto.firstName('  Carla Souza '), 'Carla');
  assert.equal(auto.firstName(null), '');
  assert.equal(auto.ticketVariable(5), '#5');
  assert.equal(auto.ticketVariable(null), '');
});

test('templates: the old functions give the same texts as before', () => {
  assert.equal(rules.chatWelcomeMessage({ name: 'Carla Souza', ticketNumber: 1120, channel: 'chat' }).startsWith('Olá, Carla! Recebemos o seu chamado urgente #1120. Em instantes'), true);
  assert.match(rules.chatWelcomeMessage({ name: null, ticketNumber: null, channel: 'whatsapp' }), /^Olá! Recebemos o seu chamado urgente\. .*no WhatsApp, e no chat do sistema/);
  assert.match(rules.caseClosingMessage(7), /^Olá! Seu chamado #7 foi encerrado\./);
  assert.match(rules.caseClosingMessage(null), /^Olá! Seu chamado foi encerrado\./);
  assert.match(rules.chatClosingMessage('web'), /novo chat ao vivo/);
  assert.match(rules.chatClosingMessage('whatsapp'), /escreva de novo para este número/);
});

test('templates: what cannot be saved', () => {
  assert.equal(auto.templateProblem('case_closing', 'Seu chamado {chamado} acabou.'), null);
  assert.match(auto.templateProblem('case_closing', '   '), /Escreva/);
  assert.match(auto.templateProblem('case_closing', 'Oi {nome}'), /\{nome\} não existe/);
  assert.match(auto.templateProblem('whatsapp_greeting', 'Oi {inventada}'), /\{inventada\}/);
  assert.match(auto.templateProblem('whatsapp_greeting', 'a'.repeat(1001)), /1000/);
  assert.equal(auto.templateProblem('whatsapp_away', 'Atendemos {horario}, {nome}.'), null);
});

test('hours: normalizing, validating and describing', () => {
  assert.deepEqual(auto.normalizeHours(undefined), auto.DEFAULT_HOURS);
  assert.deepEqual(auto.normalizeHours({ days: [3, 1, 1, 9, 'x'], start: '8:00', end: '17:30' }), { days: [1, 3], start: '09:00', end: '17:30' });
  assert.equal(auto.hoursProblem({ days: [1], start: '09:00', end: '18:00' }), null);
  assert.match(auto.hoursProblem({ days: [], start: '09:00', end: '18:00' }), /pelo menos um dia/);
  assert.match(auto.hoursProblem({ days: [1], start: '18:00', end: '09:00' }), /depois do início/);
  assert.match(auto.hoursProblem({ days: [1], start: '9h', end: '18:00' }), /horário de início/);
  assert.equal(auto.describeHours(auto.DEFAULT_HOURS), 'segunda a sexta, das 9h às 18h');
  assert.equal(auto.describeHours({ days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '12:30' }), 'todos os dias, das 8h às 12h30');
  assert.equal(auto.describeHours({ days: [1, 3, 5], start: '09:00', end: '18:00' }), 'segunda, quarta e sexta, das 9h às 18h');
  assert.equal(auto.describeHours({ days: [6], start: '09:00', end: '13:00' }), 'sábado, das 9h às 13h');
});

test('hours: judged in Brasília time, whatever the server zone', () => {
  const at = (iso) => new Date(iso);
  const hours = auto.DEFAULT_HOURS;
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-04T12:00:00-03:00')), true, 'Wednesday noon');
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-04T08:59:00-03:00')), false, 'a minute before opening');
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-04T09:00:00-03:00')), true, 'opening');
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-04T17:59:00-03:00')), true);
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-04T18:00:00-03:00')), false, 'closing time is outside');
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-07T12:00:00-03:00')), false, 'Saturday');
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-08T12:00:00-03:00')), false, 'Sunday');
  // 21:30 in Brasília on Wednesday is already Thursday in UTC: still Wednesday there, and outside the hours.
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-05T00:30:00Z')), false);
  // 12:00 UTC on Wednesday is 09:00 in Brasília: inside.
  assert.equal(auto.isWithinBusinessHours(hours, at('2026-11-04T12:00:00Z')), true);
});

test('plan: which automatic replies a WhatsApp message deserves', () => {
  const base = { first: true, media: false, withinHours: true, enabled: { whatsapp_greeting: true, whatsapp_away: true, whatsapp_media: true }, awayRecently: false, mediaRecently: false };
  assert.deepEqual(auto.planInboundReplies(base), ['whatsapp_greeting']);
  assert.deepEqual(auto.planInboundReplies({ ...base, first: false }), [], 'only the first message of a conversation is greeted');
  assert.deepEqual(auto.planInboundReplies({ ...base, withinHours: false }), ['whatsapp_away'], 'the away notice takes the place of the greeting');
  assert.deepEqual(auto.planInboundReplies({ ...base, withinHours: false, first: false }), ['whatsapp_away'], 'and it is said even on a later message');
  assert.deepEqual(auto.planInboundReplies({ ...base, withinHours: false, awayRecently: true }), [], 'but not again soon');
  assert.deepEqual(auto.planInboundReplies({ ...base, withinHours: false, enabled: { ...base.enabled, whatsapp_away: false } }), ['whatsapp_greeting'], 'with the away notice off the greeting returns');
  assert.deepEqual(auto.planInboundReplies({ ...base, first: false, media: true }), ['whatsapp_media']);
  assert.deepEqual(auto.planInboundReplies({ ...base, first: true, media: true }), ['whatsapp_greeting', 'whatsapp_media']);
  assert.deepEqual(auto.planInboundReplies({ ...base, first: false, media: true, mediaRecently: true }), []);
  assert.deepEqual(auto.planInboundReplies({ ...base, enabled: { whatsapp_greeting: false, whatsapp_away: false, whatsapp_media: false }, media: true }), []);
});

test('catalog: every message has a default that its own rules accept', () => {
  assert.equal(new Set(auto.AUTO_KEYS).size, auto.AUTO_KEYS.length);
  for (const message of auto.AUTO_MESSAGES) {
    assert.equal(auto.templateProblem(message.key, message.defaultText), null, message.key);
    assert.ok(message.help.length > 20, message.key);
  }
  // The new ones start off: nothing new goes out on its own until the owner turns it on.
  for (const key of ['whatsapp_greeting', 'whatsapp_away', 'whatsapp_media']) assert.equal(auto.autoDefinition(key).defaultEnabled, false, key);
  for (const key of ['chat_welcome', 'chat_welcome_whatsapp', 'chat_closing_web', 'chat_closing_whatsapp', 'case_closing']) assert.equal(auto.autoDefinition(key).defaultEnabled, true, key);
});

// ------------------------------------------------------------------------------------------------------------ database

let owner;
let snapshot;
const phones = [];
const phone = (n) => {
  // A valid Brazilian mobile number: 55 + DDD 21 + 9 + eight digits (the simulated Evolution still checks the number's shape).
  const value = `55219${String(stamp).slice(-4)}${String(n).padStart(4, '0')}`;
  phones.push(value);
  return value;
};
const inbound = (number, text, extra = {}) => ({ kind: 'message', phone: number, name: 'Joana Silva', text, media: false, fromMe: false, waId: `WA-IN-${stamp}-${Math.random().toString(36).slice(2, 8)}`, at: new Date(), ...extra });

test('setup: remember the settings found and start from the defaults', async () => {
  owner = (await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  snapshot = await sql`SELECT key, enabled, body, config, updated_by, updated_at FROM livechat_auto_messages`;
  for (const key of auto.AUTO_KEYS) await autoStore.saveAutoMessage(key, { reset: true }, { id: owner.id });
  const { messages } = await autoStore.loadAutoMessages();
  assert.ok(messages.every((message) => !message.customized));
});

test('save: change a text, turn one off, restore the default, and the audit trail', async () => {
  const actor = { id: owner.id };
  assert.equal(await autoStore.getAutoMessage('case_closing', { chamado: '#9' }), rules.caseClosingMessage(9), 'the default is the old text');

  await autoStore.saveAutoMessage('case_closing', { body: 'Chamado {chamado} resolvido! Obrigado.' }, actor);
  assert.equal(await autoStore.getAutoMessage('case_closing', { chamado: '#9' }), 'Chamado #9 resolvido! Obrigado.');
  assert.equal((await autoStore.loadAutoMessages()).messages.find((m) => m.key === 'case_closing').customized, true);

  await autoStore.saveAutoMessage('case_closing', { enabled: false }, actor);
  assert.equal(await autoStore.getAutoMessage('case_closing', { chamado: '#9' }), null, 'turned off: no message');
  const kept = (await autoStore.loadAutoMessages()).messages.find((m) => m.key === 'case_closing');
  assert.equal(kept.text, 'Chamado {chamado} resolvido! Obrigado.', 'turning it off keeps the text');

  // Saving the default text as is keeps it "the default".
  await autoStore.saveAutoMessage('chat_closing_web', { body: auto.autoDefinition('chat_closing_web').defaultText }, actor);
  assert.equal((await autoStore.loadAutoMessages()).messages.find((m) => m.key === 'chat_closing_web').textCustomized, false);

  await autoStore.saveAutoMessage('case_closing', { reset: true }, actor);
  assert.equal(await autoStore.getAutoMessage('case_closing', { chamado: '#9' }), rules.caseClosingMessage(9));

  const audit = await sql`SELECT action, details FROM audit_events WHERE target_type = 'livechat_auto_message' AND created_at > NOW() - interval '5 minutes' ORDER BY created_at`;
  assert.ok(audit.some((row) => row.action === 'livechat_auto.updated') && audit.some((row) => row.action === 'livechat_auto.reset'));
});

test('save: what is refused', async () => {
  const actor = { id: owner.id };
  await assert.rejects(autoStore.saveAutoMessage('nao_existe', { enabled: true }, actor), /não encontrada/);
  await assert.rejects(autoStore.saveAutoMessage('case_closing', { body: 'Oi {nome}' }, actor), /não existe/);
  await assert.rejects(autoStore.saveAutoMessage('case_closing', { body: '   ' }, actor), /Escreva/);
  await assert.rejects(autoStore.saveAutoMessage('case_closing', { hours: auto.DEFAULT_HOURS }, actor), /fora do horário/);
  await assert.rejects(autoStore.saveAutoMessage('whatsapp_away', { hours: { days: [], start: '09:00', end: '18:00' } }, actor), /pelo menos um dia/);
});

test('save: the business hours belong to the away message and survive a change of text', async () => {
  const actor = { id: owner.id };
  const saved = await autoStore.saveAutoMessage('whatsapp_away', { hours: { days: [1, 2, 3], start: '10:00', end: '16:00' } }, actor);
  assert.deepEqual(saved.hours, { days: [1, 2, 3], start: '10:00', end: '16:00' });
  const again = await autoStore.saveAutoMessage('whatsapp_away', { body: 'Voltamos {horario}.' }, actor);
  assert.deepEqual(again.hours, { days: [1, 2, 3], start: '10:00', end: '16:00' }, 'changing the text does not touch the hours');
  const reset = await autoStore.saveAutoMessage('whatsapp_away', { reset: true }, actor);
  assert.deepEqual(reset.hours, auto.DEFAULT_HOURS);
});

test('whatsapp: everything off (the default) answers nothing', async () => {
  const number = phone(1);
  evo.sent.length = 0;
  const event = inbound(number, 'Oi, tudo bem?');
  const saved = await store.storeWhatsAppMessage(event);
  assert.deepEqual(await wa.autoReplyToInbound(event, saved.id), []);
  assert.equal(evo.sent.length, 0);
});

test('whatsapp: the greeting goes once, to the first message only, and is kept marked as automatic', async () => {
  const actor = { id: owner.id };
  await autoStore.saveAutoMessage('whatsapp_greeting', { enabled: true }, actor);
  const number = phone(2);
  evo.sent.length = 0;
  const noon = new Date('2026-11-04T15:00:00Z'); // Wednesday 12:00 in Brasília: inside the hours

  const first = inbound(number, 'Preciso de ajuda');
  const savedFirst = await store.storeWhatsAppMessage(first);
  assert.deepEqual(await wa.autoReplyToInbound(first, savedFirst.id, noon), ['whatsapp_greeting']);
  assert.equal(evo.sent.length, 1);
  assert.equal(evo.sent[0].body.number, number);
  assert.match(evo.sent[0].body.text, /^Olá, Joana! Obrigado por falar com a NextRotta\./);

  const second = inbound(number, 'Alguém aí?');
  const savedSecond = await store.storeWhatsAppMessage(second);
  assert.deepEqual(await wa.autoReplyToInbound(second, savedSecond.id, noon), [], 'a second message is not greeted again');
  assert.equal(evo.sent.length, 1);

  const conversationId = String((await sql`SELECT conversation_id FROM livechat_messages WHERE id = ${savedFirst.id}`)[0].conversation_id);
  const conversation = await store.getConversation(conversationId);
  const thread = await store.getMessages(conversationId);
  const autoOnes = thread.filter((m) => m.autoKey);
  assert.deepEqual(autoOnes.map((m) => [m.direction, m.autoKey]), [['out', 'whatsapp_greeting']]);
  assert.equal(conversation.unreadOwner, 2, 'an automatic answer does not make the conversation look attended');
  assert.equal(conversation.lastMessagePreview, 'Alguém aí?');

  // The echo of our own message through the webhook is the same message, not a new one.
  const echo = { ...inbound(number, evo.sent[0].body.text, { fromMe: true }), waId: `WA-AUTO-${stamp}-${evo.ids}` };
  assert.equal(await store.storeWhatsAppMessage(echo), null);
  assert.deepEqual(await wa.autoReplyToInbound(echo, savedFirst.id, noon), [], 'the team\'s own message is never answered');
  assert.equal(evo.sent.length, 1);
});

test('whatsapp: outside the hours the away notice takes the place of the greeting, and is not repeated soon', async () => {
  const actor = { id: owner.id };
  await autoStore.saveAutoMessage('whatsapp_away', { enabled: true }, actor);
  const number = phone(3);
  evo.sent.length = 0;
  const night = new Date('2026-11-04T02:00:00Z'); // Tuesday 23:00 in Brasília

  const first = inbound(number, 'Boa noite');
  const savedFirst = await store.storeWhatsAppMessage(first);
  assert.deepEqual(await wa.autoReplyToInbound(first, savedFirst.id, night), ['whatsapp_away']);
  assert.equal(evo.sent.length, 1);
  assert.match(evo.sent[0].body.text, /^Olá, Joana! No momento estamos fora do horário de atendimento \(segunda a sexta, das 9h às 18h\)\./);

  const second = inbound(number, 'Está aí?');
  const savedSecond = await store.storeWhatsAppMessage(second);
  assert.deepEqual(await wa.autoReplyToInbound(second, savedSecond.id, night), []);
  assert.equal(evo.sent.length, 1);
});

test('whatsapp: a photo or audio gets its own note, once an hour; a failed send is not recorded', async () => {
  const actor = { id: owner.id };
  await autoStore.saveAutoMessage('whatsapp_media', { enabled: true }, actor);
  const number = phone(4);
  const noon = new Date('2026-11-04T15:00:00Z');
  evo.sent.length = 0;

  const greeted = inbound(number, 'Oi');
  await wa.autoReplyToInbound(greeted, (await store.storeWhatsAppMessage(greeted)).id, noon);
  evo.sent.length = 0;

  evo.fail = true;
  const photo = inbound(number, '📷 Imagem', { media: true });
  const savedPhoto = await store.storeWhatsAppMessage(photo);
  assert.deepEqual(await wa.autoReplyToInbound(photo, savedPhoto.id, noon), [], 'Evolution is down: nothing is claimed as sent');
  evo.fail = false;
  evo.sent.length = 0;

  const again = inbound(number, '📷 Imagem', { media: true });
  assert.deepEqual(await wa.autoReplyToInbound(again, (await store.storeWhatsAppMessage(again)).id, noon), ['whatsapp_media'], 'the next file is answered');
  assert.match(evo.sent[0].body.text, /só conseguimos ler mensagens de texto/);

  const third = inbound(number, '🎤 Áudio', { media: true });
  assert.deepEqual(await wa.autoReplyToInbound(third, (await store.storeWhatsAppMessage(third)).id, noon), [], 'not again within the hour');
});

test('whatsapp: a number that is in a web chat is not answered here (the chat has its own welcome)', async () => {
  const number = phone(5);
  const orgs = await sql`SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`;
  const users = await sql`SELECT id, name FROM users WHERE organization_id = ${orgs[0].id} AND deleted_at IS NULL LIMIT 1`;
  const ticket = await sql`
    INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category, channel)
    VALUES (${orgs[0].id}, ${users[0].id}, ${`zz auto ${stamp}`}, 'Descrição do chamado de teste', 'support', 'billing', 'chat') RETURNING id`;
  const web = await store.startWebConversation({ organizationId: orgs[0].id, userId: users[0].id, ticketId: ticket[0].id, userName: users[0].name, contactPhone: number, opening: { message: 'Preciso de ajuda agora' } });
  evo.sent.length = 0;
  const event = inbound(number, 'respondendo pelo WhatsApp');
  const saved = await store.storeWhatsAppMessage(event);
  assert.deepEqual(await wa.autoReplyToInbound(event, saved.id), []);
  assert.equal(evo.sent.length, 0);
  assert.equal(evo.sent.length, 0);
  await store.closeConversation(web.id, 'owner');
  await sql`UPDATE bug_reports SET status = 'resolved' WHERE id = ${ticket[0].id}`;
});

test('welcome and closing: the owner\'s text is used, and turning them off silences them', async () => {
  const actor = { id: owner.id };
  const conversation = { id: 'x', ticketNumber: 31, contactPhone: null, organizationId: null };
  await autoStore.saveAutoMessage('chat_welcome', { body: 'Oi {nome}, chamado {chamado} aberto!' }, actor);
  assert.equal(await autoStore.getAutoMessage('chat_welcome', { nome: 'Rui', chamado: '#31' }), 'Oi Rui, chamado #31 aberto!');
  await autoStore.saveAutoMessage('chat_welcome', { enabled: false }, actor);
  await autoStore.saveAutoMessage('chat_welcome_whatsapp', { enabled: false }, actor);
  assert.equal(await wa.storeChatWelcome(conversation, 'Rui'), null, 'a welcome that is off stores nothing');
  assert.equal(await wa.mirrorChatWelcome({ ...conversation, contactPhone: '5521999990000' }, 'Rui'), 'skipped');
});

// ---------------------------------------------------------------------------------------------------------------- end

after(async () => {
  // Put the settings found back exactly as they were, and close the conversations of the test numbers.
  await sql`UPDATE livechat_auto_messages SET enabled = NULL, body = NULL, config = '{}'::jsonb`;
  for (const row of snapshot ?? []) {
    await sql`
      INSERT INTO livechat_auto_messages (key, enabled, body, config, updated_by, updated_at)
      VALUES (${row.key}, ${row.enabled}, ${row.body}, ${JSON.stringify(row.config)}::jsonb, ${row.updated_by}, ${row.updated_at})
      ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, body = EXCLUDED.body, config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    `;
  }
  if (phones.length) await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW() WHERE contact_phone = ANY(${phones}) AND status = 'open'`;
});
