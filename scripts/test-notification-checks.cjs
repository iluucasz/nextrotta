// Run with: node scripts/test-notification-checks.cjs
// Needs the development database (.env). What the system notices on its own: the folha of the month that ended
// and was not closed (says it once, names the technicians, clears itself when they are all closed), and the
// WhatsApp that lost its connection. Creates one test company and leaves it archived: nothing is ever deleted.
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
const checks = require('../lib/notification-checks.ts');
const { brasiliaDateKey } = require('../lib/formatters.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

const SLUG = 'zz-teste-avisos';
let org;
let ana;
let beto;
let userId;

const previous = (() => {
  const [year, month] = brasiliaDateKey().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
})();

const titles = async (prefix) =>
  (await n.listNotifications({ organizationId: org, userId, isAdmin: true, limit: 100 })).filter((item) => item.title.startsWith(prefix));

test('setup: a test company with two technicians who produced last month', async () => {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste avisos', 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET created_at = NOW() - interval '60 days', deleted_at = NULL WHERE id = ${org}`;
  userId = (await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)[0].id;
  await sql`UPDATE notifications SET archived_at = NOW() WHERE organization_id = ${org} AND archived_at IS NULL`;
  await sql`UPDATE technicians SET status = 'inactive', deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;

  ana = (await sql`INSERT INTO technicians (organization_id, name, status) VALUES (${org}, 'Ana Teste', 'active') RETURNING id`)[0].id;
  beto = (await sql`INSERT INTO technicians (organization_id, name, status) VALUES (${org}, 'Beto Teste', 'active') RETURNING id`)[0].id;
  for (const technician of [ana, beto]) {
    await sql`
      INSERT INTO services (organization_id, order_code, technician_id, service_type, value, date_performed, competence_month)
      VALUES (${org}, ${`T-${technician}`}, ${technician}, 'Reboque', 100, ${`${previous}-10`}, ${previous})`;
  }
});

test('pending folhas: who is missing is found', async () => {
  const pending = await checks.findPendingPayroll(org, previous);
  assert.deepEqual(pending.map((row) => row.name), ['Ana Teste', 'Beto Teste']);
  assert.deepEqual(await checks.findPendingPayroll(org, '1999-01'), []);
});

test('a draft is not a closed folha', async () => {
  await sql`INSERT INTO payroll (organization_id, technician_id, competence_month, status) VALUES (${org}, ${ana}, ${previous}, 'draft')`;
  assert.equal((await checks.findPendingPayroll(org, previous)).length, 2);
});

test('the reminder is created once, naming them, and only from the 3rd of the month', async () => {
  await checks.checkPayroll(org);
  await checks.checkPayroll(org);
  const found = await titles('Folha de ');
  if (Number(brasiliaDateKey().slice(8, 10)) < checks.PAYROLL_REMINDER_DAY) {
    assert.equal(found.length, 0, 'before the 3rd nothing is said');
    return;
  }
  assert.equal(found.length, 1, 'said once');
  assert.ok(found[0].body.includes('Ana Teste') && found[0].body.includes('Beto Teste'));
  assert.equal(found[0].href, '/admin/payroll');
});

test('closing every folha takes the reminder off the bell and says it was concluded, once', async () => {
  await sql`UPDATE payroll SET status = 'closed' WHERE organization_id = ${org} AND technician_id = ${ana} AND competence_month = ${previous}`;
  await sql`INSERT INTO payroll (organization_id, technician_id, competence_month, status) VALUES (${org}, ${beto}, ${previous}, 'closed')`;
  assert.deepEqual(await checks.findPendingPayroll(org, previous), []);
  await checks.checkPayroll(org);
  await checks.checkPayroll(org);
  const found = await titles('Folha de ');
  assert.equal(found.length, 1, 'o lembrete saiu e só ficou o aviso de conclusão');
  assert.match(found[0].title, /fechada$/);
  assert.equal(found[0].severity, 'success');
  assert.match(found[0].body, /2 técnicos/);
});

test('a disconnected WhatsApp is told once and cleared when it connects again', async () => {
  await sql`
    INSERT INTO whatsapp_config (organization_id, instance_name, connection_state, connection_checked_at)
    VALUES (${org}, ${SLUG}, 'disconnected', NOW())
    ON CONFLICT (organization_id) DO UPDATE SET instance_name = EXCLUDED.instance_name, connection_state = 'disconnected', connection_checked_at = NOW()`;
  await checks.checkWhatsAppConnection(org);
  await checks.checkWhatsAppConnection(org);
  assert.equal((await titles('O WhatsApp')).length, 1);

  await sql`UPDATE whatsapp_config SET connection_state = 'connected' WHERE organization_id = ${org}`;
  await checks.checkWhatsAppConnection(org);
  assert.equal((await titles('O WhatsApp')).length, 0);
});

test('a stale state is not trusted', async () => {
  await sql`UPDATE whatsapp_config SET connection_state = 'disconnected', connection_checked_at = NOW() - interval '10 days' WHERE organization_id = ${org}`;
  await checks.checkWhatsAppConnection(org);
  assert.equal((await titles('O WhatsApp')).length, 0);
});

test('bills: late and due-soon are told once a day, and clear when they are paid', async () => {
  const today = brasiliaDateKey();
  const day = (offset) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const bill = async (description, due, amount) => (await sql`
    INSERT INTO financial_entries (id, organization_id, type, description, category, amount, due_date, competence_month)
    VALUES (${`t-${description}-${Date.now()}`}, ${org}, 'payable', ${description}, 'Teste orçamento', ${amount}, ${due}, ${due.slice(0, 7)}) RETURNING id`)[0].id;
  const late = await bill('Atrasada', day(-3), 100);
  const near = await bill('Perto', day(2), 50);

  await checks.checkExpenses(org);
  await checks.checkExpenses(org);
  assert.equal((await titles('1 conta vencida')).length, 1, 'said once');
  assert.ok((await titles('1 conta vencida'))[0].body.includes('R$') && (await titles('1 conta vencida'))[0].body.includes('100'));
  assert.equal((await titles('1 conta vence em breve')).length, 1);

  await sql`UPDATE financial_entries SET paid_amount = amount, status = 'paid' WHERE id IN (${late}, ${near})`;
  await checks.checkExpenses(org);
  assert.equal((await titles('1 conta vencida')).length, 0);
  assert.equal((await titles('1 conta vence em breve')).length, 0);
});

test('bills: a category over its monthly budget is told once', async () => {
  const month = brasiliaDateKey().slice(0, 7);
  await sql`INSERT INTO finance_budgets (organization_id, category, amount) VALUES (${org}, 'Teste orçamento', 100) ON CONFLICT (organization_id, category) DO UPDATE SET amount = 100`;
  await sql`INSERT INTO financial_entries (id, organization_id, type, description, category, amount, due_date, competence_month, status, paid_amount)
            VALUES (${`t-orc-${Date.now()}`}, ${org}, 'payable', 'Gasto', 'Teste orçamento', 150, ${`${month}-28`}, ${month}, 'paid', 150)`;
  await checks.checkExpenses(org);
  await checks.checkExpenses(org);
  assert.equal((await titles('Orçamento de Teste orçamento')).length, 1);
});

test('resolveNotifications only touches the company and the prefix it was given', async () => {
  const mine = await n.createNotification({ organizationId: org, kind: 'x', title: 'Do prefixo', dedupeKey: 'teste:um:1' });
  const other = await n.createNotification({ organizationId: org, kind: 'x', title: 'De outro prefixo', dedupeKey: 'teste:dois:1' });
  assert.ok(mine && other);
  await n.resolveNotifications(org, 'teste:um:');
  const left = (await n.listNotifications({ organizationId: org, userId, isAdmin: true, limit: 100 })).map((item) => item.title);
  assert.ok(!left.includes('Do prefixo'));
  assert.ok(left.includes('De outro prefixo'));
});

test('parts: low stock is told once a day and clears when the stock is refilled', async () => {
  const part = (await sql`INSERT INTO parts (organization_id, name, min_stock) VALUES (${org}, 'Peça de teste', 3) RETURNING id`)[0].id;
  await sql`INSERT INTO part_movements (organization_id, part_id, quantity, kind) VALUES (${org}, ${part}, 2, 'purchase')`;

  const today = brasiliaDateKey();
  const parts = require('../lib/parts/notices.ts');
  await parts.checkParts(org, today);
  await parts.checkParts(org, today);
  const low = await titles('1 peça com estoque baixo');
  assert.equal(low.length, 1, 'said once');
  assert.equal(low[0].severity, 'warning');
  assert.match(low[0].body, /Peça de teste/);

  await sql`INSERT INTO part_movements (organization_id, part_id, quantity, kind) VALUES (${org}, ${part}, 10, 'purchase')`;
  await parts.checkParts(org, today);
  assert.equal((await titles('1 peça com estoque baixo')).length, 0, 'refilled: the notice leaves the bell');
  await sql`UPDATE parts SET deleted_at = NOW() WHERE id = ${part}`;
});

after(async () => {
  // nothing is deleted: notices and the company are archived, test rows are marked deleted like everywhere else
  await sql`UPDATE notifications SET archived_at = NOW() WHERE organization_id = ${org} AND archived_at IS NULL`;
  await sql`UPDATE payroll SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE financial_entries SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE finance_budgets SET amount = 0 WHERE organization_id = ${org}`;
  await sql`UPDATE services SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE technicians SET status = 'inactive', deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
  await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
});
