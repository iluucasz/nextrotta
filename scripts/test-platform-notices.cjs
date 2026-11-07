// Run with: node scripts/test-platform-notices.cjs
// The inbox of the NextRotta's own people (platform_notices): the pure rules (what a company's notification becomes, usage levels),
// then, in the development database, the notice's life (the same open key counts instead of repeating, a resolved one comes back as
// a new one, a check resolves what went away), what an owner and a support user each see, and reading/clearing per person.
// The test company is "zz-avisos-plataforma" (kept archived) and the two users are made inactive at the end. Nothing here is
// critical on purpose: a critical notice also goes to the owner's real WhatsApp.
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
const meta = require('../lib/platform/notice-meta.ts');

// ------------------------------------------------------------------------------------------------------------- pure

test('mirrorRule: only what needs a person reaches the NextRotta inbox', () => {
  assert.deepEqual(meta.mirrorRule('billing', 'critical'), { category: 'billing', severity: 'critical' });
  assert.deepEqual(meta.mirrorRule('billing', 'success'), { category: 'billing', severity: 'success' });
  assert.equal(meta.mirrorRule('billing', 'info'), null, 'a new charge is routine');
  assert.deepEqual(meta.mirrorRule('credits', 'warning'), { category: 'ai', severity: 'warning' });
  assert.deepEqual(meta.mirrorRule('porto', 'critical'), { category: 'automation', severity: 'critical' });
  assert.equal(meta.mirrorRule('porto', 'success'), null);
  // The customer's own business and what the platform checks already cover.
  for (const kind of ['payroll', 'expenses', 'parts', 'schedule', 'technician', 'support', 'storage', 'whatsapp', 'maintenance']) {
    assert.equal(meta.mirrorRule(kind, 'critical'), null, kind);
  }
  assert.equal(meta.mirrorRule('billing', 'nonsense'), null);
});

test('limits: nothing below 90%, a warning from 90%, full from 100%, unlimited is silent', () => {
  assert.equal(meta.limitLevel(meta.limitShare(89, 100)), null);
  assert.equal(meta.limitLevel(meta.limitShare(90, 100)), 'near');
  assert.equal(meta.limitLevel(meta.limitShare(100, 100)), 'full');
  assert.equal(meta.limitLevel(meta.limitShare(150, 100)), 'full');
  assert.equal(meta.limitLevel(meta.limitShare(5, null)), null);
  assert.equal(meta.limitLevel(meta.limitShare(5, 0)), null);
});

test('audience and alert kinds: support users only get what is about attending customers', () => {
  assert.equal(meta.defaultAudience('support'), 'staff');
  for (const category of ['billing', 'limits', 'automation', 'whatsapp', 'backup', 'ai', 'growth', 'security', 'system']) assert.equal(meta.defaultAudience(category), 'owner', category);
  assert.equal(meta.noticeForAlertKind('livechat').audience, 'staff');
  assert.equal(meta.noticeForAlertKind('porto_layout').severity, 'critical');
  assert.equal(meta.noticeForAlertKind('unknown-kind').category, 'system');
  assert.equal(meta.NOTICE_CATEGORIES.every((category) => meta.NOTICE_CATEGORY_LABELS[category]), true);
});

// ------------------------------------------------------------------------------------------------------------- database

const { sql } = require('../lib/db.ts');
const notices = require('../lib/platform/notices.ts');
const alerts = require('../lib/platform/notice-alerts.ts');
const checks = require('../lib/platform/notice-checks.ts');
const n = require('../lib/notifications.ts');
const team = require('../lib/platform/team.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-avisos-plataforma';
const stamp = Date.now();
const KEY = `test:${stamp}:`;
const users = [];
let org;
let owner;
let support;

const titles = async (viewer, filters = {}) => (await notices.listNotices(viewer, filters, { limit: 200 })).filter((item) => item.title.startsWith('[teste]')).map((item) => item.title);

test('setup: a test company and two people of the team', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste avisos da plataforma', 'active') RETURNING id`)[0].id;
  const first = (await sql`SELECT id FROM users WHERE organization_id IS NULL AND role = 'platform_owner' AND deleted_at IS NULL ORDER BY created_at LIMIT 1`)[0];
  const mine = await team.createTeamMember({ name: 'Teste Admin', email: `zz-avisos-admin-${stamp}@example.test`, role: 'platform_owner' }, { id: String(first.id) });
  const other = await team.createTeamMember({ name: 'Teste Atendente', email: `zz-avisos-atendente-${stamp}@example.test`, role: 'platform_support' }, { id: String(first.id) });
  owner = { userId: String(mine.user.id), role: 'platform_owner' };
  support = { userId: String(other.user.id), role: 'platform_support' };
  users.push(owner.userId, support.userId);
});

test('insertNotice: the same open key counts instead of repeating; once resolved it is a new notice', async () => {
  const input = { organizationId: org, category: 'limits', severity: 'warning', title: '[teste] limite', body: 'x', dedupeKey: `${KEY}limit` };
  const first = await notices.insertNotice(input);
  assert.equal(first.created, true);
  const again = await notices.insertNotice(input);
  assert.equal(again.created, false);
  assert.equal(again.id, first.id);
  const refreshed = await notices.insertNotice({ ...input, body: 'novo texto' }, 'refresh');
  assert.equal(refreshed.created, false);
  const row = (await sql`SELECT occurrences, body FROM platform_notices WHERE id = ${first.id}`)[0];
  assert.equal(row.occurrences, 2, 'a refresh does not count itself');
  assert.equal(row.body, 'novo texto');

  assert.equal(await notices.resolveNotices(`${KEY}limit`), 1);
  const next = await notices.insertNotice(input);
  assert.equal(next.created, true, 'after it was resolved, the same problem is news again');
  assert.notEqual(next.id, first.id);
  await notices.resolveNotices(`${KEY}limit`);
});

test('syncPlatformNotices: notifies the new, keeps the standing quiet and resolves what went away', async () => {
  const prefix = `${KEY}sync:`;
  const make = (name) => ({ organizationId: org, category: 'whatsapp', severity: 'warning', title: `[teste] ${name}`, dedupeKey: `${prefix}${name}` });
  assert.deepEqual(await alerts.syncPlatformNotices(prefix, [make('a'), make('b')]), { created: 2, resolved: 0 });
  assert.deepEqual(await alerts.syncPlatformNotices(prefix, [make('a'), make('b')]), { created: 0, resolved: 0 });
  assert.deepEqual(await alerts.syncPlatformNotices(prefix, [make('a')]), { created: 0, resolved: 1 });
  const open = await sql`SELECT dedupe_key FROM platform_notices WHERE starts_with(dedupe_key, ${prefix}) AND resolved_at IS NULL`;
  assert.deepEqual(open.map((row) => row.dedupe_key), [`${prefix}a`]);
  await assert.rejects(alerts.syncPlatformNotices(prefix, [{ ...make('c'), dedupeKey: 'other:c' }]), /não começa/);
  await alerts.syncPlatformNotices(prefix, []);
});

test('mirror: a company notification reaches the inbox and its resolution resolves it', async () => {
  const dedupeKey = `billing:paid:${KEY}`;
  await n.notifyOrganization(org, { kind: 'billing', severity: 'success', title: '[teste] Pagamento confirmado: R$ 10,00', body: 'texto para a empresa', dedupeKey });
  await n.notifyOrganization(org, { kind: 'payroll', severity: 'warning', title: '[teste] folha', dedupeKey: `payroll:${KEY}` });
  await n.notifyOrganization(org, { kind: 'billing', severity: 'info', title: '[teste] nova cobrança', dedupeKey: `billing:charge:${KEY}` });
  const list = await notices.listNotices(owner, { organizationId: org, includeResolved: true }, { limit: 200 });
  const mirrored = list.find((item) => item.title === '[teste] Pagamento confirmado: R$ 10,00');
  assert.ok(mirrored, 'the payment is in the inbox');
  assert.equal(mirrored.category, 'billing');
  assert.equal(mirrored.body, '', "the company's own wording is not copied for billing");
  assert.match(mirrored.href, new RegExp(`/plataforma/organizacoes/${org}`));
  assert.equal(list.some((item) => item.title === '[teste] folha'), false, "payroll is the customer's own business");
  assert.equal(list.some((item) => item.title === '[teste] nova cobrança'), false, 'a new charge is routine');

  await n.resolveNotifications(org, `billing:paid:${KEY}`);
  const after = (await notices.listNotices(owner, { organizationId: org, includeResolved: true }, { limit: 200 })).find((item) => item.id === mirrored.id);
  assert.ok(after.resolvedAt, 'resolving it for the company resolves it here');
});

test('visibility: a support user sees only what is for the whole staff', async () => {
  await alerts.notifyPlatform({ organizationId: org, category: 'billing', severity: 'warning', title: '[teste] dinheiro', dedupeKey: `${KEY}money` });
  await alerts.notifyPlatform({ organizationId: org, category: 'support', severity: 'info', audience: 'staff', title: '[teste] caso novo', dedupeKey: `${KEY}case` });
  assert.deepEqual((await titles(owner)).sort(), ['[teste] caso novo', '[teste] dinheiro']);
  assert.deepEqual(await titles(support), ['[teste] caso novo']);
  // The support user cannot read, clear or count what is not theirs.
  const money = (await notices.listNotices(owner, { organizationId: org }, { limit: 50 })).find((item) => item.title === '[teste] dinheiro');
  assert.equal(await notices.markNoticesRead(support, { ids: [money.id] }), 0);
  assert.equal(await notices.clearNotices(support, { ids: [money.id] }), 0);
  const summary = await notices.summarizeNotices(support);
  assert.equal(summary.byCategory.billing ?? 0, 0);
});

test('reading and clearing are per person, and a cleared notice can be restored', async () => {
  const list = await notices.listNotices(owner, { organizationId: org }, { limit: 50 });
  const money = list.find((item) => item.title === '[teste] dinheiro');
  assert.equal(money.read, false);
  const before = (await notices.summarizeNotices(owner)).unread;

  assert.equal(await notices.markNoticesRead(owner, { ids: [money.id] }), 1);
  assert.equal((await notices.summarizeNotices(owner)).unread, before - 1);
  const asOwner = (await notices.listNotices(owner, { organizationId: org }, { limit: 50 })).find((item) => item.id === money.id);
  const asSupportView = await notices.listNotices(support, { organizationId: org }, { limit: 50 });
  assert.equal(asOwner.read, true);
  const caseForSupport = asSupportView.find((item) => item.title === '[teste] caso novo');
  assert.equal(caseForSupport.read, false, 'the other person still has it unread');

  assert.equal(await notices.clearNotices(owner, { ids: [money.id] }), 1);
  assert.equal((await titles(owner, { organizationId: org })).includes('[teste] dinheiro'), false);
  assert.deepEqual(await titles(owner, { organizationId: org, state: 'cleared' }), ['[teste] dinheiro']);
  assert.equal((await titles(support)).includes('[teste] caso novo'), true, 'clearing is only for the one who cleared');

  assert.equal(await notices.clearNotices(owner, { ids: [money.id] }, true), 1);
  assert.equal((await titles(owner, { organizationId: org })).includes('[teste] dinheiro'), true);

  // "All that the filters show".
  const cleared = await notices.clearNotices(owner, { all: true, filters: { organizationId: org, category: 'billing' } });
  assert.ok(cleared >= 1);
  assert.equal((await titles(owner, { organizationId: org, category: 'billing' })).length, 0);
});

test('the platform checks run against the real data and only read (no notice is written)', async () => {
  const before = Number((await sql`SELECT COUNT(*)::int AS total FROM platform_notices`)[0].total);
  const findings = await checks.collectPlatformFindings();
  assert.deepEqual(Object.keys(findings).sort(), ['automation:stale:', 'backup:stale:', 'growth:inactive:', 'limits:', 'support:waiting:', 'sys:', 'whatsapp:down:']);
  for (const [prefix, found] of Object.entries(findings)) {
    assert.equal(Array.isArray(found), true, `${prefix} failed: ${JSON.stringify(found)}`);
    for (const item of found) {
      assert.ok(item.dedupeKey.startsWith(prefix), item.dedupeKey);
      assert.ok(item.title.length > 0 && item.title.length <= 200);
    }
  }
  console.log('achados reais (sem gravar):', Object.fromEntries(Object.entries(findings).map(([prefix, found]) => [prefix, found.length])));
  assert.equal(Number((await sql`SELECT COUNT(*)::int AS total FROM platform_notices`)[0].total), before);
});

after(async () => {
  // Everything the test made is resolved (nothing is deleted); the people are made inactive and hidden.
  if (org) await sql`UPDATE platform_notices SET resolved_at = COALESCE(resolved_at, NOW()) WHERE organization_id = ${org}`;
  if (users.length) await sql`UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ANY(${users}::uuid[])`;
  if (org) await sql`UPDATE organizations SET status = 'canceled', deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ${org}`.catch(() => undefined);
});
