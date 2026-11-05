// Run with: node scripts/test-notifications.cjs
// Needs the development database (.env). Notifications: what each company sees (its own plus the general ones),
// who sees what (admins and everyone), read state per person, dedupe, expiry and archive.
// It creates one test company ("zz-teste-notificacoes") and leaves it archived: nothing is ever deleted.
process.loadEnvFile('.env');
process.env.JWT_SECRET ??= 'test';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { sql } = require('../lib/db.ts');
const n = require('../lib/notifications.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const TAG = `teste-${Date.now()}`;
const ids = [];
let kappa;
let other;
let admin;
let colleague;

async function titles(organizationId, userId, isAdmin) {
  const items = await n.listNotifications({ organizationId, userId, isAdmin, limit: 100 });
  return items.filter((item) => item.title.includes(TAG)).map((item) => item.title.replace(` ${TAG}`, ''));
}

test('setup: two companies and two people', async () => {
  kappa = (await sql`SELECT id FROM organizations WHERE slug = 'kappa' AND deleted_at IS NULL`)[0]?.id;
  assert.ok(kappa, 'a empresa de teste kappa precisa existir');
  const users = await sql`SELECT id FROM users WHERE organization_id = ${kappa} ORDER BY created_at LIMIT 2`;
  assert.ok(users.length >= 2, 'a kappa precisa ter duas pessoas');
  admin = users[0].id;
  colleague = users[1].id;

  // the general notice must exist BEFORE the second company: companies never see what came before them
  ids.push(await n.createNotification({ organizationId: null, kind: 'system', title: `Geral antigo ${TAG}` }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const existing = (await sql`SELECT id FROM organizations WHERE slug = 'zz-teste-notificacoes'`)[0];
  other = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES ('zz-teste-notificacoes', 'Teste notificações', 'active') RETURNING id`)[0].id;
  // a company created now is newer than the notice above
  await sql`UPDATE organizations SET created_at = NOW(), deleted_at = NULL WHERE id = ${other}`;
});

test('what each company sees: its own and the general ones', async () => {
  ids.push(await n.createNotification({ organizationId: null, kind: 'system', title: `Geral ${TAG}`, severity: 'warning' }));
  ids.push(await n.createNotification({ organizationId: kappa, kind: 'billing', title: `Só da kappa ${TAG}` }));
  ids.push(await n.createNotification({ organizationId: other, kind: 'billing', title: `Só da outra ${TAG}` }));

  const kappaSees = await titles(kappa, admin, true);
  assert.deepEqual(kappaSees.sort(), ['Geral', 'Geral antigo', 'Só da kappa'].sort(), 'a kappa vê o geral e o seu');
  const otherSees = await titles(other, admin, true);
  assert.deepEqual(otherSees.sort(), ['Geral', 'Só da outra'].sort(), 'a outra vê o geral novo e o seu, nunca o da kappa nem o que veio antes dela');
});

test('who sees it: admins only, or everyone', async () => {
  ids.push(await n.createNotification({ organizationId: kappa, kind: 'support', title: `Para todos ${TAG}`, audience: 'everyone' }));
  const technician = await titles(kappa, colleague, false);
  assert.ok(technician.includes('Para todos'));
  assert.ok(!technician.includes('Só da kappa'), 'quem não é admin não vê o que é só dos admins');
});

test('read state is per person', async () => {
  const before = await n.countUnreadNotifications({ organizationId: kappa, userId: admin, isAdmin: true });
  // The two people may already differ (earlier runs read things for one of them): only what a read changes counts.
  const colleagueBefore = await n.countUnreadNotifications({ organizationId: kappa, userId: colleague, isAdmin: true });
  const mine = (await n.listNotifications({ organizationId: kappa, userId: admin, isAdmin: true, limit: 100 })).find((item) => item.title.startsWith('Só da kappa'));
  await n.markNotificationsRead({ organizationId: kappa, userId: admin, isAdmin: true, ids: [mine.id] });
  assert.equal(await n.countUnreadNotifications({ organizationId: kappa, userId: admin, isAdmin: true }), before - 1);
  assert.equal(await n.countUnreadNotifications({ organizationId: kappa, userId: colleague, isAdmin: true }), colleagueBefore, 'a leitura de um admin não muda a do outro');

  await n.markNotificationsRead({ organizationId: kappa, userId: admin, isAdmin: true });
  assert.equal(await n.countUnreadNotifications({ organizationId: kappa, userId: admin, isAdmin: true }), 0, 'marcar todas zera');
  // reading is idempotent
  await n.markNotificationsRead({ organizationId: kappa, userId: admin, isAdmin: true });
});

test('marking read never touches another company', async () => {
  const otherBefore = await n.countUnreadNotifications({ organizationId: other, userId: admin, isAdmin: true });
  assert.ok(otherBefore >= 1, 'a outra empresa ainda tem as dela por ler');
});

test('the same event never notifies twice', async () => {
  const first = await n.createNotification({ organizationId: kappa, kind: 'billing', title: `Cobrança ${TAG}`, dedupeKey: `${TAG}:cobranca` });
  const second = await n.createNotification({ organizationId: kappa, kind: 'billing', title: `Cobrança ${TAG}`, dedupeKey: `${TAG}:cobranca` });
  const elsewhere = await n.createNotification({ organizationId: other, kind: 'billing', title: `Cobrança ${TAG}`, dedupeKey: `${TAG}:cobranca` });
  assert.ok(first && elsewhere, 'a primeira de cada empresa é criada');
  assert.equal(second, null, 'a repetição da mesma empresa é ignorada');
  ids.push(first, elsewhere);
});

test('expired and archived notices disappear; a bad link is dropped', async () => {
  ids.push(await n.createNotification({ organizationId: kappa, kind: 'system', title: `Vencida ${TAG}`, expiresAt: new Date(Date.now() - 1000) }));
  const toArchive = await n.createNotification({ organizationId: kappa, kind: 'system', title: `Retirada ${TAG}` });
  ids.push(toArchive);
  assert.ok((await titles(kappa, admin, true)).includes('Retirada'));
  assert.ok(await n.archiveNotification(toArchive));
  const sees = await titles(kappa, admin, true);
  assert.ok(!sees.includes('Vencida') && !sees.includes('Retirada'));
  assert.equal(n.safeInternalHref('https://evil.example'), null);
  assert.equal(n.safeInternalHref('//evil.example'), null);
  assert.equal(n.safeInternalHref('/admin/assinatura'), '/admin/assinatura');
});

test('clearing is per person, reversible, and respects the filters', async () => {
  const kind = 'ztest';
  const make = async (title, severity) => {
    const id = await n.createNotification({ organizationId: kappa, kind, severity, title: `${title} ${TAG}` });
    ids.push(id);
    return id;
  };
  const critical = await make('Crítica', 'critical');
  const success = await make('Concluída', 'success');
  await make('Atenção', 'warning');
  const view = (userId, state, extra = {}) => n.listNotifications({ organizationId: kappa, userId, isAdmin: true, limit: 100, kind, state, ...extra });
  const mineIn = async (userId, state, extra) => (await view(userId, state, extra)).filter((item) => item.title.includes(TAG)).map((item) => item.title.replace(` ${TAG}`, '')).sort();

  assert.deepEqual(await mineIn(admin, 'active'), ['Atenção', 'Concluída', 'Crítica']);
  assert.deepEqual(await mineIn(admin, 'active', { severity: 'success' }), ['Concluída'], 'o filtro de importância');

  const unreadBefore = await n.countUnreadNotifications({ organizationId: kappa, userId: admin, isAdmin: true });
  await n.clearNotifications({ organizationId: kappa, userId: admin, isAdmin: true, ids: [critical] });
  assert.deepEqual(await mineIn(admin, 'active'), ['Atenção', 'Concluída'], 'limpa sai da lista');
  assert.deepEqual(await mineIn(admin, 'cleared'), ['Crítica'], 'e aparece em Limpas');
  assert.equal(await n.countUnreadNotifications({ organizationId: kappa, userId: admin, isAdmin: true }), unreadBefore - 1, 'limpar tira do contador do sino');
  assert.deepEqual(await mineIn(colleague, 'active'), ['Atenção', 'Concluída', 'Crítica'], 'o outro admin continua vendo tudo');

  const summary = await n.summarizeNotifications({ organizationId: kappa, userId: admin, isAdmin: true });
  assert.ok(summary.cleared >= 1 && summary.byKind[kind] === 2, 'o resumo conta só as ativas por área');
  assert.equal(summary.bySeverity.critical + summary.bySeverity.warning + summary.bySeverity.success + summary.bySeverity.info, summary.active);

  // everything the filter matches, and nothing outside it
  await n.clearNotifications({ organizationId: kappa, userId: admin, isAdmin: true, kind, severity: 'success' });
  assert.deepEqual(await mineIn(admin, 'active'), ['Atenção']);
  await n.clearNotifications({ organizationId: kappa, userId: admin, isAdmin: true, kind });
  assert.deepEqual(await mineIn(admin, 'active'), []);
  assert.equal((await n.listNotifications({ organizationId: kappa, userId: admin, isAdmin: true, limit: 100 })).some((item) => item.title.startsWith('Só da kappa')), true, 'o que está fora do filtro não foi limpo');

  // restore one, then the rest; a cleared notice never notifies again (same dedupe key is still taken)
  await n.clearNotifications({ organizationId: kappa, userId: admin, isAdmin: true, ids: [success], restore: true });
  assert.deepEqual(await mineIn(admin, 'active'), ['Concluída']);
  await n.clearNotifications({ organizationId: kappa, userId: admin, isAdmin: true, kind, restore: true });
  assert.deepEqual(await mineIn(admin, 'active'), ['Atenção', 'Concluída', 'Crítica']);

  const keyed = await n.createNotification({ organizationId: kappa, kind, title: `Única ${TAG}`, dedupeKey: `${TAG}:unica` });
  ids.push(keyed);
  await n.clearNotifications({ organizationId: kappa, userId: admin, isAdmin: true, ids: [keyed] });
  assert.equal(await n.createNotification({ organizationId: kappa, kind, title: `Única ${TAG}`, dedupeKey: `${TAG}:unica` }), null, 'limpar não reabre a chave de repetição');

  // pagination
  const page1 = await view(admin, 'active', { limit: 2 });
  const page2 = await view(admin, 'active', { limit: 2, offset: 2 });
  assert.equal(page1.length, 2);
  assert.ok(page2.every((item) => !page1.some((first) => first.id === item.id)), 'a segunda página não repete a primeira');
});

after(async () => {
  // nothing is deleted: the test notices are archived and the test company is archived too
  await sql`UPDATE notifications SET archived_at = NOW() WHERE title LIKE ${`%${TAG}%`} AND archived_at IS NULL`;
  if (other) await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${other}`;
});
