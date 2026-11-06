// Run with: node scripts/test-cases.cjs
// The cases of the team (service-console style): the rules (pure), then, in the development database, turning a conversation into a
// case, the history, owner, status and notes, the listing filters, and a customer who writes again joining their open case.
// Cases are never deleted: the ones made here are left "resolved", with subjects starting "zz teste".
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
const rules = require('../lib/cases/rules.ts');
const cases = require('../lib/cases/store.ts');
const { sql } = require('../lib/db.ts');
const store = require('../lib/livechat/store.ts');
const team = require('../lib/platform/team.ts');

const stamp = Date.now();
const created = [];
const phones = [];
const phone = (n) => {
  const value = `55219${String(stamp).slice(-4)}${String(n).padStart(4, '0')}`;
  phones.push(value);
  return value;
};
const inbound = (number, text) => ({ kind: 'message', phone: number, name: 'Joana Silva', text, media: false, fromMe: false, waId: `WA-CASE-${stamp}-${Math.random().toString(36).slice(2, 8)}`, at: new Date() });

// ------------------------------------------------------------------------------------------------------------- pure

test('rules: the vocabulary and the subject suggestion', () => {
  assert.deepEqual([...rules.CASE_STATUSES], ['new', 'working', 'waiting', 'resolved']);
  assert.equal(rules.formatCaseNumber(5001), '#5001');
  assert.equal(rules.suggestedSubject({ ticketTitle: '  Sistema   parado ', firstCustomerMessage: 'oi' }), 'Sistema parado');
  assert.equal(rules.suggestedSubject({ firstCustomerMessage: 'Preciso de ajuda com a folha' }), 'Preciso de ajuda com a folha');
  assert.equal(rules.suggestedSubject({ firstCustomerMessage: 'x'.repeat(200) }).length, 80);
  assert.equal(rules.suggestedSubject({ contactName: 'Joana' }), 'Conversa com Joana');
  assert.equal(rules.suggestedSubject({ organizationName: 'Kappa' }), 'Conversa com Kappa');
  assert.equal(rules.suggestedSubject({}), 'Conversa sem resolução');
});

test('rules: the transcript, the limits and the history lines', () => {
  const text = rules.transcript([
    { direction: 'in', body: 'Oi   tudo bem?', kind: 'text' },
    { direction: 'out', body: 'Olá!', kind: 'text', autoKey: 'whatsapp_greeting' },
    { direction: 'out', body: 'Como posso ajudar?', kind: 'text' },
    { direction: 'in', body: 'aviso do sistema', kind: 'system' },
    { direction: 'in', body: '', kind: 'text' },
  ], 'Joana');
  assert.equal(text, 'Joana: Oi tudo bem?\nEquipe (automática): Olá!\nEquipe: Como posso ajudar?');
  const many = Array.from({ length: 30 }, (_, i) => ({ direction: 'in', body: `mensagem ${i}`, kind: 'text' }));
  assert.equal(rules.transcript(many, 'X').split('\n').length, 12, 'only the end of the conversation');
  assert.match(rules.textProblem('', 'o assunto', 10, true), /Escreva o assunto/);
  assert.equal(rules.textProblem('', 'a nota', 10, false), null);
  assert.match(rules.textProblem('x'.repeat(11), 'o assunto', 10, true), /até 10 caracteres/);
  assert.equal(rules.statusLine('new', 'working'), 'Status: Novo → Em andamento');
  assert.equal(rules.statusLine('resolved', 'working'), 'Status: Resolvido → Em andamento (caso reaberto)');
  assert.equal(rules.changeLine.owner(null, 'Ana'), 'Responsável: ninguém → Ana');
  assert.equal(rules.changeLine.owner('Ana', null), 'Responsável removido (era Ana)');
  assert.equal(rules.changeLine.priority('low', 'critical'), 'Prioridade: Baixa → Crítica');
});

// ------------------------------------------------------------------------------------------------------------ database

let me;
let attendant;
let orgUser;
let conv;
let caseA;

test('setup: people to act as', async () => {
  me = (await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  const made = await team.createTeamMember({ name: 'Zeca Atendente', email: `zz-caso-${stamp}@example.test` }, { id: me.id });
  attendant = { id: String(made.user.id) };
  created.push(attendant.id);
  orgUser = (await sql`SELECT id FROM users WHERE organization_id IS NOT NULL AND deleted_at IS NULL LIMIT 1`)[0];
  assert.ok(me && attendant && orgUser);
  const list = await cases.listAssignees();
  assert.ok(list.some((person) => person.id === attendant.id) && list.every((person) => ['platform_owner', 'platform_support'].includes(person.role)));
  assert.ok(list.every((person) => !('email' in person)), 'only names and roles');
});

test('create: a conversation becomes a case with its contact, the end of the talk and the creator as owner', async () => {
  const number = phone(1);
  const first = await store.storeWhatsAppMessage(inbound(number, 'A folha de outubro não fecha, preciso de ajuda'));
  await store.storeWhatsAppMessage(inbound(number, 'Alguém aí?'));
  const conversationId = String((await sql`SELECT conversation_id FROM livechat_messages WHERE id = ${first.id}`)[0].conversation_id);
  conv = conversationId;

  await assert.rejects(cases.createCase({ conversationId, subject: 'x'.repeat(141) }, { id: me.id }), /até 140/);
  await assert.rejects(cases.createCase({ conversationId, priority: 'urgentissima' }, { id: me.id }), /Prioridade/);
  await assert.rejects(cases.createCase({ conversationId, status: 'resolved' }, { id: me.id }), /não pode nascer resolvido/);
  await assert.rejects(cases.createCase({ conversationId, ownerId: orgUser.id }, { id: me.id }), /equipe/);

  caseA = await cases.createCase({ conversationId, priority: 'high', note: 'Cliente com pressa, fecha a folha hoje.' }, { id: me.id, role: 'platform_owner' });
  assert.equal(caseA.origin, 'whatsapp');
  assert.equal(caseA.subject, 'A folha de outubro não fecha, preciso de ajuda', 'the subject comes from what the customer said first');
  assert.match(caseA.description, /^Joana Silva: A folha de outubro não fecha[\s\S]*Joana Silva: Alguém aí\?$/);
  assert.equal(caseA.contactPhone, number);
  assert.equal(caseA.ownerId, me.id, 'the creator is the owner unless told otherwise');
  assert.equal(caseA.status, 'new');
  assert.equal(caseA.priority, 'high');
  assert.ok(caseA.number >= 5001);
  assert.equal(caseA.conversationCount, 1);

  const conversation = await store.getConversation(conversationId);
  assert.equal(conversation.caseId, caseA.id);
  assert.equal(conversation.caseNumber, caseA.number);
  assert.equal(conversation.caseStatus, 'new');
  await assert.rejects(cases.createCase({ conversationId }, { id: me.id }), /já tem o caso #/, 'one case per conversation');

  const events = await cases.getCaseEvents(caseA.id);
  assert.deepEqual(events.map((event) => event.kind).sort(), ['created', 'note']);
  assert.ok(events.some((event) => event.kind === 'note' && event.authorName));
  const listed = await cases.getCaseConversations(caseA.id);
  assert.deepEqual(listed.map((item) => [item.id, item.channel]), [[conversationId, 'whatsapp']]);
});

test('update: every change is in the history, a resolved case keeps its time and reopening clears it', async () => {
  const actor = { id: me.id, role: 'platform_owner' };
  await assert.rejects(cases.updateCase(caseA.id, { status: 'dormindo' }, actor), /Status inválido/);
  await assert.rejects(cases.updateCase(caseA.id, { ownerId: orgUser.id }, actor), /equipe/);
  await assert.rejects(cases.updateCase(caseA.id, { subject: '   ' }, actor), /assunto/);
  await assert.rejects(cases.updateCase('nao-uuid', { status: 'working' }, actor), /não encontrado/);

  const same = await cases.updateCase(caseA.id, { status: 'new', priority: 'high' }, actor);
  assert.equal(same.updatedAt, caseA.updatedAt, 'nothing changed: nothing recorded');

  let updated = await cases.updateCase(caseA.id, { status: 'working', ownerId: attendant.id, priority: 'critical' }, actor);
  assert.deepEqual([updated.status, updated.ownerId, updated.priority], ['working', attendant.id, 'critical']);
  assert.equal(updated.ownerName, 'Zeca Atendente');
  assert.equal(updated.resolvedAt, null);

  updated = await cases.updateCase(caseA.id, { status: 'waiting', subject: 'Folha de outubro não fecha' }, { id: attendant.id, role: 'platform_support' });
  assert.equal(updated.subject, 'Folha de outubro não fecha');

  updated = await cases.updateCase(caseA.id, { status: 'resolved' }, actor);
  assert.ok(updated.resolvedAt, 'resolving stamps the time');
  const stampedAt = updated.resolvedAt;
  updated = await cases.updateCase(caseA.id, { description: 'Descrição ajustada pelo atendente.' }, actor);
  assert.equal(updated.resolvedAt, stampedAt, 'editing a resolved case does not move the time');

  updated = await cases.updateCase(caseA.id, { status: 'working', ownerId: null }, actor);
  assert.equal(updated.resolvedAt, null, 'reopened');
  assert.equal(updated.ownerId, null);

  const lines = (await cases.getCaseEvents(caseA.id)).map((event) => event.body);
  for (const expected of ['Status: Novo → Em andamento', 'Prioridade: Alta → Crítica', 'Responsável: ' + (updated.createdByName ?? '') + ' → Zeca Atendente', 'Status: Em andamento → Aguardando cliente', 'Status: Aguardando cliente → Resolvido', 'Status: Resolvido → Em andamento (caso reaberto)', 'Responsável removido (era Zeca Atendente)']) {
    assert.ok(lines.includes(expected), `history has "${expected}": ${JSON.stringify(lines)}`);
  }
  assert.ok(lines.some((line) => line.startsWith('Assunto alterado para')));

  const audit = await sql`SELECT actor_role FROM audit_events WHERE target_id = ${caseA.id} AND action = 'case.updated'`;
  assert.ok(audit.some((row) => row.actor_role === 'platform_support'), 'the audit keeps who acted, with their role');
});

test('notes: internal notes join the history, with their author', async () => {
  await assert.rejects(cases.addCaseNote(caseA.id, '   ', { id: me.id }), /Escreva a anotação/);
  await assert.rejects(cases.addCaseNote(caseA.id, 'x'.repeat(2001), { id: me.id }), /até 2000/);
  const events = await cases.addCaseNote(caseA.id, 'Liguei para o cliente, vai mandar o arquivo amanhã.', { id: attendant.id });
  assert.equal(events[0].kind, 'note');
  assert.equal(events[0].authorName, 'Zeca Atendente');
  assert.equal(events[0].body, 'Liguei para o cliente, vai mandar o arquivo amanhã.');
});

test('manual: a case by hand with a company and a typed number', async () => {
  const org = (await sql`SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  await assert.rejects(cases.createCase({ subject: 'zz teste manual', contactPhone: '123' }, { id: me.id }), /WhatsApp informado/);
  await assert.rejects(cases.createCase({ subject: 'zz teste manual', organizationId: '00000000-0000-4000-8000-000000000000' }, { id: me.id }), /Empresa não encontrada/);
  await assert.rejects(cases.createCase({}, { id: me.id }), /assunto/);
  const manual = await cases.createCase({ subject: 'zz teste manual', organizationId: org.id, contactName: 'Rui', contactPhone: '(21) 98888-7777', ownerId: null }, { id: me.id });
  created.push();
  assert.equal(manual.origin, 'manual');
  assert.equal(manual.organizationName, org.name);
  assert.equal(manual.contactPhone, '5521988887777');
  assert.equal(manual.ownerId, null, 'ownerId null leaves it without an owner');
  await cases.updateCase(manual.id, { status: 'resolved' }, { id: me.id });
});

test('list: filters by status, owner, priority and search', async () => {
  const a = await cases.getCase(caseA.id);
  const open = await cases.listCases({}, me.id);
  assert.ok(open.some((item) => item.id === a.id), 'open is the default');
  assert.ok(open.every((item) => item.status !== 'resolved'));
  assert.ok((await cases.listCases({ status: 'all' }, me.id)).some((item) => item.subject === 'zz teste manual'), 'resolved ones are in "all"');
  assert.ok(!(await cases.listCases({ status: 'resolved' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ status: 'working' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ owner: 'none' }, me.id)).some((item) => item.id === a.id), 'it has no owner now');
  assert.ok(!(await cases.listCases({ owner: 'me' }, me.id)).some((item) => item.id === a.id));
  assert.ok(!(await cases.listCases({ owner: attendant.id }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ priority: 'critical' }, me.id)).some((item) => item.id === a.id));
  assert.ok(!(await cases.listCases({ priority: 'low' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ q: 'folha de outubro' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ q: `#${a.number}` }, me.id)).some((item) => item.id === a.id), 'by number');
  assert.ok((await cases.listCases({ q: phones[0].slice(-8) }, me.id)).some((item) => item.id === a.id), 'by phone');
  assert.deepEqual(await cases.listCases({ q: `zz-nada-${stamp}` }, me.id), []);
});

test('join: a customer who writes again while the case is open lands in it; a resolved case is left alone', async () => {
  const number = phones[0];
  await store.closeConversation(conv, 'owner');
  const again = await store.storeWhatsAppMessage(inbound(number, 'Voltei, o arquivo está pronto'));
  const newConversation = String((await sql`SELECT conversation_id FROM livechat_messages WHERE id = ${again.id}`)[0].conversation_id);
  assert.notEqual(newConversation, conv, 'the old one was closed: this is a new conversation');
  assert.equal(await cases.linkInboundToOpenCase(again.id), caseA.id);
  assert.equal((await store.getConversation(newConversation)).caseId, caseA.id);
  assert.equal(await cases.linkInboundToOpenCase(again.id), null, 'already linked');
  assert.equal((await cases.getCaseConversations(caseA.id)).length, 2, 'the case gathers both');
  assert.ok((await cases.getCaseEvents(caseA.id)).some((event) => event.kind === 'conversation'));

  // A case that is resolved does not pull the next conversation in.
  await cases.updateCase(caseA.id, { status: 'resolved' }, { id: me.id });
  await store.closeConversation(newConversation, 'owner');
  const third = await store.storeWhatsAppMessage(inbound(number, 'Mais uma dúvida'));
  assert.equal(await cases.linkInboundToOpenCase(third.id), null);

  // A conversation of another number is not touched, and nor is a message of the customer that is not WhatsApp.
  const stranger = await store.storeWhatsAppMessage(inbound(phone(9), 'Oi, sou outra pessoa'));
  assert.equal(await cases.linkInboundToOpenCase(stranger.id), null);
});

// ---------------------------------------------------------------------------------------------------------------- end

after(async () => {
  // Cases stay (nothing is deleted): resolved; conversations are closed; the test attendant is made inactive and hidden.
  await sql`UPDATE support_cases SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW()) WHERE contact_phone = ANY(${phones}) OR subject LIKE 'zz teste%'`;
  if (phones.length) await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW() WHERE contact_phone = ANY(${phones}) AND status = 'open'`;
  if (created.length) await sql`UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ANY(${created}::uuid[])`;
});
