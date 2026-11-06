// Run with: node scripts/test-cases.cjs
// The cases of the team. A case is ONE kind of record (the tickets customers open and the cases the team opens from a conversation
// are the same table; Suporte, Bug and Sugestão are its types). The rules (pure), then, in the development database: turning a
// conversation into a case, the history, owner, status and notes, the listing filters, a customer who writes again joining their
// open case, and what must never leak: a customer never sees the team's internal cases, and they are not in a company's backup.
// Cases are never deleted: the ones made here are left resolved, with subjects starting "zz teste" or created from the test numbers.
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
const bugs = require('../lib/platform/bugs.ts');
const backupTables = require('../lib/backup/tables.ts');
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

test('rules: the vocabulary is the one of the tickets, with the status of each type in its own words', () => {
  assert.deepEqual([...rules.CASE_STATUSES], ['new', 'investigating', 'waiting', 'resolved', 'not_reproduced']);
  assert.deepEqual([...rules.OPEN_STATUSES], ['new', 'investigating', 'waiting']);
  assert.equal(rules.isOpenStatus('waiting'), true);
  assert.equal(rules.isOpenStatus('resolved'), false);
  assert.equal(rules.caseStatusLabel('support', 'investigating'), 'Em atendimento');
  assert.equal(rules.caseStatusLabel('bug', 'investigating'), 'Em análise');
  assert.equal(rules.caseStatusLabel('suggestion', 'resolved'), 'Concluída');
  assert.equal(rules.caseStatusLabel('support', 'waiting'), 'Aguardando cliente');
  assert.equal(rules.isCaseType('suggestion'), true);
  assert.equal(rules.isCaseType('chamado'), false);
  assert.equal(rules.formatCaseNumber(1328), '#1328');
});

test('rules: the subject suggestion, the transcript, the limits and the history lines', () => {
  assert.equal(rules.suggestedSubject({ ticketTitle: '  Sistema   parado ', firstCustomerMessage: 'oi' }), 'Sistema parado');
  assert.equal(rules.suggestedSubject({ firstCustomerMessage: 'x'.repeat(200) }).length, 80);
  assert.equal(rules.suggestedSubject({ contactName: 'Joana' }), 'Conversa com Joana');
  assert.equal(rules.suggestedSubject({}), 'Conversa sem resolução');
  const text = rules.transcript([
    { direction: 'in', body: 'Oi   tudo bem?', kind: 'text' },
    { direction: 'out', body: 'Olá!', kind: 'text', autoKey: 'whatsapp_greeting' },
    { direction: 'out', body: 'Como posso ajudar?', kind: 'text' },
    { direction: 'in', body: 'aviso do sistema', kind: 'system' },
  ], 'Joana');
  assert.equal(text, 'Joana: Oi tudo bem?\nEquipe (automática): Olá!\nEquipe: Como posso ajudar?');
  assert.match(rules.textProblem('', 'o assunto', 10, true), /Escreva o assunto/);
  assert.equal(rules.textProblem('', 'a nota', 10, false), null);
  assert.match(rules.textProblem('x'.repeat(11), 'o assunto', 10, true), /até 10 caracteres/);
  assert.equal(rules.statusLine('support', 'new', 'investigating'), 'Status: Aberto → Em atendimento');
  assert.equal(rules.statusLine('bug', 'new', 'waiting'), 'Status: Novo → Aguardando cliente');
  assert.equal(rules.statusLine('support', 'resolved', 'investigating'), 'Status: Resolvido → Em atendimento (caso reaberto)');
  assert.equal(rules.statusLine('support', 'not_reproduced', 'resolved'), 'Status: Encerrado → Resolvido');
  assert.equal(rules.changeLine.owner(null, 'Ana'), 'Responsável: ninguém → Ana');
  assert.equal(rules.changeLine.owner('Ana', null), 'Responsável removido (era Ana)');
  assert.equal(rules.changeLine.priority('low', 'critical'), 'Prioridade: Baixa → Crítica');
});

// ------------------------------------------------------------------------------------------------------------ database

let me;
let attendant;
let orgUser;
let org;
let conv;
let caseA;

test('setup: people and a company to act on', async () => {
  me = (await sql`SELECT id FROM users WHERE role = 'platform_owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  const made = await team.createTeamMember({ name: 'Zeca Atendente', email: `zz-caso-${stamp}@example.test` }, { id: me.id });
  attendant = { id: String(made.user.id) };
  created.push(attendant.id);
  orgUser = (await sql`SELECT u.id, u.organization_id FROM users u JOIN organizations o ON o.id = u.organization_id WHERE o.deleted_at IS NULL AND u.deleted_at IS NULL ORDER BY o.created_at, u.created_at LIMIT 1`)[0];
  org = (await sql`SELECT id, name FROM organizations WHERE id = ${orgUser.organization_id}`)[0];
  assert.ok(me && attendant && orgUser && org);
  const list = await cases.listAssignees();
  assert.ok(list.some((person) => person.id === attendant.id) && list.every((person) => ['platform_owner', 'platform_support'].includes(person.role)));
  assert.ok(list.every((person) => !('email' in person)), 'only names and roles');
});

test('create: a conversation becomes a case of a type, with its contact, the end of the talk and the creator as owner', async () => {
  const number = phone(1);
  const first = await store.storeWhatsAppMessage(inbound(number, 'A folha de outubro não fecha, preciso de ajuda'));
  await store.storeWhatsAppMessage(inbound(number, 'Alguém aí?'));
  const conversationId = String((await sql`SELECT conversation_id FROM livechat_messages WHERE id = ${first.id}`)[0].conversation_id);
  conv = conversationId;

  await assert.rejects(cases.createCase({ conversationId, subject: 'x'.repeat(141) }, { id: me.id }), /até 140/);
  await assert.rejects(cases.createCase({ conversationId, priority: 'urgentissima' }, { id: me.id }), /Prioridade/);
  await assert.rejects(cases.createCase({ conversationId, type: 'chamado' }, { id: me.id }), /Suporte, Bug ou Sugestão/);
  await assert.rejects(cases.createCase({ conversationId, status: 'resolved' }, { id: me.id }), /não pode nascer concluído/);
  await assert.rejects(cases.createCase({ conversationId, ownerId: orgUser.id }, { id: me.id }), /equipe/);

  caseA = await cases.createCase({ conversationId, type: 'bug', priority: 'high', note: 'Cliente com pressa, fecha a folha hoje.' }, { id: me.id, role: 'platform_owner' });
  assert.equal(caseA.type, 'bug');
  assert.equal(caseA.origin, 'whatsapp');
  assert.equal(caseA.internal, true);
  assert.equal(caseA.channel, 'case');
  assert.equal(caseA.subject, 'A folha de outubro não fecha, preciso de ajuda', 'the subject comes from what the customer said first');
  assert.match(caseA.description, /^Joana Silva: A folha de outubro não fecha[\s\S]*Joana Silva: Alguém aí\?$/);
  assert.equal(caseA.contactPhone, number);
  assert.equal(caseA.organizationId, null, 'a stranger on WhatsApp has no company');
  assert.equal(caseA.ownerId, me.id, 'the creator is the owner unless told otherwise');
  assert.equal(caseA.status, 'new');
  assert.equal(caseA.priority, 'high');
  assert.ok(caseA.number >= 1001, 'the number is the ticket number: one numbering for every case');
  assert.equal(caseA.conversationCount, 1);

  const conversation = await store.getConversation(conversationId);
  assert.equal(conversation.caseId, caseA.id);
  assert.equal(conversation.caseNumber, caseA.number);
  assert.equal(conversation.caseStatus, 'new');
  await assert.rejects(cases.createCase({ conversationId }, { id: me.id }), /já é o caso #/, 'one case per conversation');

  const timeline = await cases.getCaseEvents(caseA.id);
  assert.deepEqual(timeline.map((event) => event.kind).sort(), ['created', 'note']);
  const [row] = await sql`SELECT user_id, organization_id, support_category, report_type FROM bug_reports WHERE id = ${caseA.id}`;
  assert.deepEqual([row.user_id, row.organization_id, row.support_category, row.report_type], [null, null, null, 'bug']);
  assert.deepEqual((await cases.getCaseConversations(caseA.id)).map((item) => [item.id, item.channel]), [[conversationId, 'whatsapp']]);
});

test('a live chat opened from a ticket already is a case: it is not turned into another', async () => {
  const ticket = await sql`
    INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category, channel, priority)
    VALUES (${org.id}, ${orgUser.id}, ${`zz teste chat ${stamp}`}, 'Chat urgente de teste dos casos', 'support', 'billing', 'chat', 'high') RETURNING id, ticket_number`;
  const web = await store.startWebConversation({ organizationId: org.id, userId: orgUser.id, ticketId: ticket[0].id, userName: 'Cliente Teste', opening: { message: 'Preciso de ajuda agora' } });
  const conversation = await store.getConversation(web.id);
  assert.equal(conversation.caseId, ticket[0].id, 'its ticket is its case');
  assert.equal(conversation.caseNumber, Number(ticket[0].ticket_number));
  await assert.rejects(cases.createCase({ conversationId: web.id }, { id: me.id }), /já é o caso #/);
  assert.deepEqual((await cases.getCaseConversations(ticket[0].id)).map((item) => item.id), [web.id]);
  await store.closeConversation(web.id, 'owner');
  await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id = ${ticket[0].id}`;
});

test('update: every change is in the history (in the words of the type), a closed case keeps its time and reopening clears it', async () => {
  const actor = { id: me.id, role: 'platform_owner' };
  await assert.rejects(cases.updateCase(caseA.id, { status: 'dormindo' }, actor), /Estado inválido/);
  await assert.rejects(cases.updateCase(caseA.id, { ownerId: orgUser.id }, actor), /equipe/);
  await assert.rejects(cases.updateCase(caseA.id, { subject: '   ' }, actor), /assunto/);
  await assert.rejects(cases.getCase('nao-uuid'), /não encontrado/);

  let updated = await cases.updateCase(caseA.id, { status: 'investigating', ownerId: attendant.id, priority: 'critical' }, actor);
  assert.deepEqual([updated.status, updated.ownerId, updated.priority], ['investigating', attendant.id, 'critical']);
  assert.equal(updated.ownerName, 'Zeca Atendente');

  updated = await cases.updateCase(caseA.id, { status: 'waiting', subject: 'Folha de outubro não fecha' }, { id: attendant.id, role: 'platform_support' });
  assert.equal(updated.subject, 'Folha de outubro não fecha');
  assert.equal(updated.status, 'waiting');
  assert.equal(updated.resolvedAt, null, 'waiting for the customer is still open');

  updated = await cases.updateCase(caseA.id, { status: 'resolved' }, actor);
  assert.ok(updated.resolvedAt, 'resolving stamps the time');
  const stampedAt = updated.resolvedAt;
  updated = await cases.updateCase(caseA.id, { description: 'Descrição ajustada pelo atendente.' }, actor);
  assert.equal(updated.resolvedAt, stampedAt, 'editing a closed case does not move the time');
  assert.equal(updated.description, 'Descrição ajustada pelo atendente.');

  updated = await cases.updateCase(caseA.id, { status: 'investigating', ownerId: null }, actor);
  assert.equal(updated.resolvedAt, null, 'reopened');
  assert.equal(updated.ownerId, null);

  const lines = (await cases.getCaseEvents(caseA.id)).map((event) => event.body);
  for (const expected of ['Status: Novo → Em análise', 'Prioridade: Alta → Crítica', 'Status: Em análise → Aguardando cliente', 'Status: Aguardando cliente → Resolvido', 'Status: Resolvido → Em análise (caso reaberto)', 'Responsável removido (era Zeca Atendente)']) {
    assert.ok(lines.includes(expected), `history has "${expected}": ${JSON.stringify(lines)}`);
  }
  assert.ok(lines.some((line) => /^Responsável: .* → Zeca Atendente$/.test(line)));
  assert.ok(lines.some((line) => line.startsWith('Assunto alterado para')));

  const audit = await sql`SELECT actor_role FROM audit_events WHERE target_id = ${caseA.id} AND action = 'bug.updated'`;
  assert.ok(audit.some((row) => row.actor_role === 'platform_support'), 'the audit keeps who acted, with their role');
});

test('notes: internal notes join the timeline with their author, and are messages of the case marked internal', async () => {
  await assert.rejects(cases.addCaseNote(caseA.id, '   ', { id: me.id }), /Escreva a anotação/);
  await assert.rejects(cases.addCaseNote(caseA.id, 'x'.repeat(2001), { id: me.id }), /até 2000/);
  const events = await cases.addCaseNote(caseA.id, 'Liguei para o cliente, vai mandar o arquivo amanhã.', { id: attendant.id });
  assert.equal(events[0].kind, 'note');
  assert.equal(events[0].authorName, 'Zeca Atendente');
  const [stored] = await sql`SELECT internal, from_owner FROM bug_messages WHERE bug_id = ${caseA.id} AND text LIKE 'Liguei para%'`;
  assert.deepEqual([stored.internal, stored.from_owner], [true, true]);
});

test('internal cases: the customer never sees them, no goodbye is sent, and they are not in the company backup', async () => {
  const manual = await cases.createCase({ type: 'suggestion', subject: 'zz teste manual', organizationId: org.id, contactName: 'Rui', contactPhone: '(21) 98888-7777', ownerId: null }, { id: me.id });
  assert.equal(manual.origin, 'manual');
  assert.equal(manual.type, 'suggestion');
  assert.equal(manual.organizationName, org.name);
  assert.equal(manual.contactPhone, '5521988887777');
  assert.equal(manual.ownerId, null, 'ownerId null leaves it without an owner');
  await assert.rejects(cases.createCase({ subject: 'zz teste manual', contactPhone: '123' }, { id: me.id }), /WhatsApp informado/);
  await assert.rejects(cases.createCase({ subject: 'zz teste manual', organizationId: '00000000-0000-4000-8000-000000000000' }, { id: me.id }), /Empresa não encontrada/);
  await assert.rejects(cases.createCase({}, { id: me.id }), /assunto/);

  // The customer's own list and page do not know it.
  const seen = await bugs.listBugReports({ organizationId: org.id, portalOnly: true });
  assert.ok(!seen.some((item) => item.id === manual.id), 'not in the customer list');
  await assert.rejects(bugs.getBugReport(manual.id, { kind: 'organization', organizationId: org.id }), /não encontrado/i);
  assert.ok((await bugs.listBugReports({ organizationId: org.id })).some((item) => item.id === manual.id), 'the team sees it, also on the company page');

  // A reply to the customer makes no sense on it; and resolving it does not post a goodbye (nor notify the company).
  await assert.rejects(bugs.addBugMessage(manual.id, { userId: me.id, fromOwner: true }, { text: 'Olá, cliente' }), /interno/);
  await cases.updateCase(manual.id, { status: 'resolved' }, { id: me.id });
  const messages = await sql`SELECT COUNT(*)::int AS n FROM bug_messages WHERE bug_id = ${manual.id}`;
  assert.equal(messages[0].n, 0, 'no closing message was written');

  // The customer's own text cannot be rewritten by the team; the team's own can.
  const ticket = await sql`INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category) VALUES (${org.id}, ${orgUser.id}, ${`zz teste portal ${stamp}`}, 'Descrição do cliente de teste', 'support', 'billing') RETURNING id`;
  await assert.rejects(cases.updateCase(ticket[0].id, { subject: 'Outro assunto' }, { id: me.id }), /relato do cliente/i);
  const owned = await cases.updateCase(ticket[0].id, { ownerId: attendant.id, status: 'waiting' }, { id: me.id });
  assert.deepEqual([owned.ownerId, owned.status, owned.internal], [attendant.id, 'waiting', false], 'a customer ticket can still be given an owner');
  assert.ok((await bugs.listBugReports({ organizationId: org.id, portalOnly: true })).some((item) => item.id === ticket[0].id), 'and the customer still sees it');
  await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id = ${ticket[0].id}`;

  // A customer writing back on a ticket that waited for them moves it on.
  const waiting = await sql`INSERT INTO bug_reports (organization_id, user_id, title, description, report_type, support_category, status) VALUES (${org.id}, ${orgUser.id}, ${`zz teste espera ${stamp}`}, 'Aguardando o cliente de teste', 'support', 'billing', 'waiting') RETURNING id`;
  await bugs.addBugMessage(waiting[0].id, { userId: orgUser.id, fromOwner: false, organizationId: org.id }, { text: 'Aqui está a informação' });
  assert.equal((await cases.getCase(waiting[0].id)).status, 'investigating');
  await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = NOW() WHERE id = ${waiting[0].id}`;

  // The company's backup leaves the team's internal cases out.
  assert.equal(backupTables.backupRowFilter('bug_reports', 't'), "t.origin = 'portal'");
  assert.equal(backupTables.backupRowFilter('services', 't'), null);
});

test('list: filters by type, status, owner, priority and search', async () => {
  const a = await cases.getCase(caseA.id);
  const open = await cases.listCases({}, me.id);
  assert.ok(open.some((item) => item.id === a.id), 'open is the default');
  assert.ok(open.every((item) => rules.isOpenStatus(item.status)));
  assert.ok((await cases.listCases({ status: 'all' }, me.id)).some((item) => item.subject === 'zz teste manual'), 'closed ones are in "all"');
  assert.ok(!(await cases.listCases({ status: 'resolved' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ type: 'bug' }, me.id)).some((item) => item.id === a.id));
  assert.ok(!(await cases.listCases({ type: 'suggestion' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ owner: 'none' }, me.id)).some((item) => item.id === a.id), 'it has no owner now');
  assert.ok(!(await cases.listCases({ owner: 'me' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ priority: 'critical' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ q: 'folha de outubro' }, me.id)).some((item) => item.id === a.id));
  assert.ok((await cases.listCases({ q: `#${a.number}` }, me.id)).some((item) => item.id === a.id), 'by number');
  assert.ok((await cases.listCases({ q: phones[0].slice(-8) }, me.id)).some((item) => item.id === a.id), 'by phone');
  assert.deepEqual(await cases.listCases({ q: `zz-nada-${stamp}` }, me.id), []);
});

test('join: a customer who writes again while the case is open lands in it; a closed case is left alone', async () => {
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

  // A case that is closed does not pull the next conversation in.
  await cases.updateCase(caseA.id, { status: 'resolved' }, { id: me.id });
  await store.closeConversation(newConversation, 'owner');
  const third = await store.storeWhatsAppMessage(inbound(number, 'Mais uma dúvida'));
  assert.equal(await cases.linkInboundToOpenCase(third.id), null);

  // Another number is not touched.
  const stranger = await store.storeWhatsAppMessage(inbound(phone(9), 'Oi, sou outra pessoa'));
  assert.equal(await cases.linkInboundToOpenCase(stranger.id), null);
});

// ---------------------------------------------------------------------------------------------------------------- end

after(async () => {
  // Cases stay (nothing is deleted): resolved; conversations are closed; the test attendant is made inactive and hidden.
  await sql`UPDATE bug_reports SET status = 'resolved', resolved_at = COALESCE(resolved_at, NOW()) WHERE status NOT IN ('resolved', 'not_reproduced') AND (contact_phone = ANY(${phones}) OR title LIKE 'zz teste%')`;
  if (phones.length) await sql`UPDATE livechat_conversations SET status = 'closed', closed_at = NOW() WHERE contact_phone = ANY(${phones}) AND status = 'open'`;
  if (created.length) await sql`UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ANY(${created}::uuid[])`;
});
