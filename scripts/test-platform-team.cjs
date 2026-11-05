// Run with: node scripts/test-platform-team.cjs
// The NextRotta's own team (owner + support users "atendentes"): which pages a role may open (pure), then, in the development
// database, creating and managing support users, the temporary password, and what each role may call. The users made here use
// e-mails stamped "zz-equipe-<time>@example.test" and are made inactive and hidden (deleted_at) at the end.
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
const access = require('../lib/platform-access.ts');
const { sql } = require('../lib/db.ts');
const team = require('../lib/platform/team.ts');
const organizations = require('../lib/platform/organizations.ts');
const auth = require('../lib/auth.ts');
const route = require('../lib/platform/route.ts');

const stamp = Date.now();
const email = (name) => `zz-equipe-${name}-${stamp}@example.test`;
const created = [];

// ------------------------------------------------------------------------------------------------------------- pure

test('access: the owner opens every page of the panel', () => {
  for (const path of ['/plataforma', '/plataforma/financeiro', '/plataforma/equipe', '/plataforma/organizacoes/nova', '/plataforma/organizacoes/x/provisionamento']) {
    assert.equal(access.mayOpenPanelPath('platform_owner', path), true, path);
  }
});

test('access: a support user opens Reports, the companies (read-only) and their account, nothing else', () => {
  const allowed = ['/plataforma/reports', '/plataforma/reports/abc', '/plataforma/bugs', '/plataforma/organizacoes', '/plataforma/organizacoes/abc', '/plataforma/configuracoes', '/plataforma/configuracoes/'];
  const denied = ['/plataforma', '/plataforma/', '/plataforma/financeiro', '/plataforma/planos', '/plataforma/cupons', '/plataforma/creditos-ia', '/plataforma/recursos', '/plataforma/leads', '/plataforma/site', '/plataforma/operacao', '/plataforma/privacidade', '/plataforma/auditoria', '/plataforma/equipe', '/plataforma/organizacoes/nova', '/plataforma/organizacoes/abc/provisionamento', '/plataforma/organizacoes/abc/acesso', '/plataformax', '/login'];
  for (const path of allowed) assert.equal(access.mayOpenPanelPath('platform_support', path), true, path);
  for (const path of denied) assert.equal(access.mayOpenPanelPath('platform_support', path), false, path);
});

test('access: any other role opens nothing of the panel', () => {
  for (const role of ['admin', 'technician', '', undefined, null]) assert.equal(access.mayOpenPanelPath(role, '/plataforma/reports'), false, String(role));
  assert.equal(access.isPlatformRole('platform_support'), true);
  assert.equal(access.isPlatformRole('admin'), false);
});

// -------------------------------------------------------------------------------------------------------------- team

let owner;
let support;
let supportPassword;

const call = (cookieToken, handler) => route.withPlatformStaff(new Request('http://nextrotta.test/api/platform/x', { headers: { cookie: `auth-token=${cookieToken}` } }), async (staff) => Response.json({ role: staff.role }));
const callOwner = (cookieToken) => route.withPlatformOwner(new Request('http://nextrotta.test/api/platform/x', { headers: { cookie: `auth-token=${cookieToken}` } }), async () => Response.json({ ok: true }));
const tokenFor = (user) => auth.createToken({ userId: user.id, email: user.email, role: user.role, organizationId: null });

test('team: there is an owner to act as', async () => {
  const rows = await sql`SELECT id, email, name, role FROM users WHERE role = 'platform_owner' AND organization_id IS NULL AND deleted_at IS NULL LIMIT 1`;
  assert.equal(rows.length, 1);
  owner = rows[0];
});

test('team: creating a support user checks the data and hands over a temporary password', async () => {
  await assert.rejects(team.createTeamMember({ name: 'A', email: email('curto') }, { id: owner.id }), /nome/i);
  await assert.rejects(team.createTeamMember({ name: 'Maria Atendente', email: 'sem-arroba' }, { id: owner.id }), /e-mail/i);
  await assert.rejects(team.createTeamMember({ name: 'Maria Atendente', email: email('dono'), role: 'platform_owner' }, { id: owner.id }), /atendentes/i);

  const result = await team.createTeamMember({ name: 'Maria Atendente', email: email('maria').toUpperCase() }, { id: owner.id });
  support = { id: String(result.user.id), email: email('maria'), role: 'platform_support' };
  supportPassword = result.temporaryPassword;
  created.push(support.id);
  assert.equal(result.user.role, 'platform_support');
  assert.ok(supportPassword.length >= 12);
  const [row] = await sql`SELECT organization_id, must_change_password, password_hash, email FROM users WHERE id = ${support.id}`;
  assert.equal(row.organization_id, null);
  assert.equal(row.must_change_password, true, 'must choose their own password at the first access');
  assert.equal(row.email, support.email, 'e-mail is kept in lower case');
  assert.notEqual(row.password_hash, supportPassword, 'the password is stored hashed');
  assert.equal(await auth.verifyPassword(supportPassword, row.password_hash), true);
  await assert.rejects(team.createTeamMember({ name: 'Outra Pessoa', email: support.email }, { id: owner.id }), /já é usado/i);
});

test('team: the list shows the owner first and never anyone from a company', async () => {
  const list = await team.listTeam();
  assert.equal(list[0].role, 'platform_owner');
  assert.ok(list.some((member) => member.id === support.id));
  assert.ok(list.every((member) => ['platform_owner', 'platform_support'].includes(member.role)));
  assert.ok(list.every((member) => !('password_hash' in member)));
});

test('team: editing, the owner is not editable here, and the audit records who did it', async () => {
  const updated = await team.updateTeamMember(support.id, { name: 'Maria S. Atendente' }, { id: owner.id });
  assert.equal(updated.name, 'Maria S. Atendente');
  await assert.rejects(team.updateTeamMember(support.id, { status: 'banana' }, { id: owner.id }), /Situação/);
  await assert.rejects(team.updateTeamMember(owner.id, { name: 'Outro nome' }, { id: owner.id }), /dono/i);
  await assert.rejects(team.updateTeamMember('nao-e-uuid', {}, { id: owner.id }), /não encontrada/i);
  const audit = await sql`SELECT actor_role FROM audit_events WHERE target_id = ${support.id} AND action = 'team.updated'`;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_role, 'platform_owner');
});

test('routes: what each role may call', async () => {
  const supportToken = await tokenFor(support);
  const ownerToken = await tokenFor(owner);

  // The support user: open routes work, owner-only routes answer 403 (the screen must not send them to the login page).
  const open = await call(supportToken);
  assert.equal(open.status, 200);
  assert.equal((await open.json()).role, 'platform_support');
  assert.equal((await callOwner(supportToken)).status, 403);
  // The owner reaches both. Without a session, both answer 401.
  assert.equal((await call(ownerToken)).status, 200);
  assert.equal((await callOwner(ownerToken)).status, 200);
  assert.equal((await call('lixo')).status, 401);
  assert.equal((await callOwner('lixo')).status, 401);
});

test('routes: a support user is not an owner for the platform-wide checks of the app', async () => {
  const supportToken = await tokenFor(support);
  const request = new Request('http://nextrotta.test/x', { headers: { cookie: `auth-token=${supportToken}` } });
  assert.equal((await auth.verifyPlatformOwner(request))?.userId ?? null, null);
  assert.equal((await auth.verifyPlatformStaff(request))?.userId, support.id);
});

test('team: resetting the password gives a new temporary one and invalidates the old', async () => {
  const result = await team.resetTeamPassword(support.id, { id: owner.id });
  assert.notEqual(result.temporaryPassword, supportPassword);
  const [row] = await sql`SELECT password_hash, must_change_password FROM users WHERE id = ${support.id}`;
  assert.equal(await auth.verifyPassword(supportPassword, row.password_hash), false);
  assert.equal(await auth.verifyPassword(result.temporaryPassword, row.password_hash), true);
  assert.equal(row.must_change_password, true);
  await assert.rejects(team.resetTeamPassword(owner.id, { id: owner.id }), /dono/i);
});

test('team: deactivating ends the session on the next request, reactivating brings it back', async () => {
  const token = await tokenFor(support);
  const request = () => new Request('http://nextrotta.test/x', { headers: { cookie: `auth-token=${token}` } });
  assert.ok(await auth.verifyPlatformStaff(request()));
  await team.updateTeamMember(support.id, { status: 'inactive' }, { id: owner.id });
  assert.equal(await auth.verifyPlatformStaff(request()), null, 'an inactive person is out at once, even with the cookie');
  assert.equal((await call(token)).status, 401);
  await team.updateTeamMember(support.id, { status: 'active' }, { id: owner.id });
  assert.ok(await auth.verifyPlatformStaff(request()));
  const actions = (await sql`SELECT action FROM audit_events WHERE target_id = ${support.id} ORDER BY created_at`).map((row) => row.action);
  assert.ok(actions.includes('team.deactivated') && actions.includes('team.activated') && actions.includes('team.password_reset') && actions.includes('team.created'), actions.join(','));
});

// ------------------------------------------------------------------------------------------------------ companies view

test('companies: the support view lists and details the companies without the money', async () => {
  const list = await organizations.listOrganizationsForSupport({});
  assert.ok(list.length > 0, 'the development database has companies');
  const allowedKeys = ['id', 'name', 'legalName', 'slug', 'status', 'email', 'phone', 'city', 'state', 'createdAt', 'lifetime', 'test', 'planName', 'activeTechnicians', 'openTickets'];
  assert.deepEqual(Object.keys(list[0]).sort(), [...allowedKeys].sort());

  const found = await organizations.listOrganizationsForSupport({ search: String(list[0].name).slice(0, 4) });
  assert.ok(found.some((row) => row.id === list[0].id));
  assert.deepEqual(await organizations.listOrganizationsForSupport({ search: `zz-nada-${stamp}` }), []);

  const detail = await organizations.getOrganizationForSupport(String(list[0].id));
  assert.equal(detail.organization.id, list[0].id);
  const text = JSON.stringify(detail);
  for (const forbidden of ['subscription', 'value', 'mrr', 'asaas', 'customerId', 'password', 'limits', 'usage', 'token']) assert.ok(!text.toLowerCase().includes(forbidden.toLowerCase()), `support view must not carry "${forbidden}"`);
  for (const user of detail.users) assert.ok(!('password_hash' in user));
});

// ---------------------------------------------------------------------------------------------------------------- end

after(async () => {
  if (created.length) await sql`UPDATE users SET status = 'inactive', deleted_at = NOW() WHERE id = ANY(${created}::uuid[])`;
});
