// Run with: node scripts/test-expenses-store.cjs
// Needs the development database (.env). Controle de despesas on the database: creating bills and series, payments
// (partial, never more than what is left, undone), editing one or a whole series, deleting and restoring, the
// budget, the spreadsheet import and the isolation between companies. Uses two test companies and leaves them archived.
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
const x = require('../lib/expenses.ts');
const store = require('../lib/expenses-store.ts');

console.log('banco:', new URL(process.env.DATABASE_URL).hostname);

let orgA;
let orgB;
let actorA;
let actorB;
const from = '2000-01-01';
const to = '2100-01-01';

async function organization(slug, name) {
  const existing = (await sql`SELECT id FROM organizations WHERE slug = ${slug}`)[0];
  const id = existing?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${slug}, ${name}, 'active') RETURNING id`)[0].id;
  await sql`UPDATE organizations SET deleted_at = NULL WHERE id = ${id}`;
  await sql`UPDATE financial_entries SET deleted_at = NOW() WHERE organization_id = ${id} AND deleted_at IS NULL`;
  return id;
}
const input = (patch = {}) => x.parseEntryInput({ type: 'payable', description: 'Aluguel', amount: 1000, due_date: '2026-11-10', category: 'Aluguel', ...patch }).entry;
const list = (org) => store.listEntries(org, from, to);

test('setup: two companies and one person', async () => {
  orgA = await organization('zz-teste-despesas-a', 'Teste despesas A');
  orgB = await organization('zz-teste-despesas-b', 'Teste despesas B');
  const user = (await sql`SELECT id FROM users WHERE role = 'admin' LIMIT 1`)[0].id;
  actorA = { organizationId: orgA, userId: user, role: 'admin' };
  actorB = { organizationId: orgB, userId: user, role: 'admin' };
});

test('a bill is created with its details and starts open', async () => {
  const [entry] = await store.createEntries(actorA, input({ supplier: 'Imobiliária', payment_method: 'boleto', payment_code: '34191.79001', notes: 'Contrato 12' }));
  assert.equal(entry.status, 'pending');
  assert.equal(entry.paid_amount, 0);
  assert.equal(entry.supplier, 'Imobiliária');
  assert.equal(entry.payment_method, 'boleto');
  assert.equal(entry.payment_code, '34191.79001');
  assert.equal(entry.nature, 'variable');
  assert.deepEqual(entry.payments, []);
});

test('installments and monthly repetitions make a series', async () => {
  const entries = await store.createEntries(actorA, input({ description: 'Notebook', amount: 1000, repeat: 'installments', repeat_count: 4, due_date: '2026-01-31' }));
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map((entry) => entry.amount), [250, 250, 250, 250]);
  assert.deepEqual(entries.map((entry) => entry.due_date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(new Set(entries.map((entry) => entry.series_id)).size, 1);
  const monthly = await store.createEntries(actorA, input({ description: 'Internet', amount: 120, repeat: 'recurring', repeat_count: 3 }));
  assert.ok(monthly.every((entry) => entry.is_recurring && entry.nature === 'fixed'));
});

test('payments: partial, then the rest, never more than what is left', async () => {
  const [entry] = await store.createEntries(actorA, input({ description: 'Seguro', amount: 500 }));
  const partial = await store.addPayment(actorA, entry.id, { amount: 200, paid_at: '2026-11-01', method: 'pix', note: null });
  assert.equal(partial.paid_amount, 200);
  assert.equal(partial.status, 'pending');
  assert.equal(partial.payment_method, 'pix');
  await assert.rejects(() => store.addPayment(actorA, entry.id, { amount: 400, paid_at: '2026-11-02', method: null, note: null }), /passa do que falta/);
  const done = await store.addPayment(actorA, entry.id, { amount: 300, paid_at: '2026-11-05', method: null, note: 'Restante' });
  assert.equal(done.status, 'paid');
  assert.equal(done.paid_amount, 500);
  assert.equal(done.paid_at, '2026-11-05');
  assert.equal(done.payments.length, 2);
  await assert.rejects(() => store.addPayment(actorA, entry.id, { amount: 1, paid_at: '2026-11-06', method: null, note: null }), /já está paga/);
});

test('two payments at the same time never overpay', async () => {
  const [entry] = await store.createEntries(actorA, input({ description: 'Corrida', amount: 100 }));
  const attempts = await Promise.allSettled([1, 2, 3].map(() => store.addPayment(actorA, entry.id, { amount: 100, paid_at: '2026-11-01', method: null, note: null })));
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  const [saved] = (await list(orgA)).filter((item) => item.id === entry.id);
  assert.equal(saved.paid_amount, 100);
});

test('undoing a payment reopens the bill', async () => {
  const [entry] = await store.createEntries(actorA, input({ description: 'Energia', amount: 300 }));
  const paid = await store.addPayment(actorA, entry.id, { amount: 300, paid_at: '2026-11-01', method: 'boleto', note: null });
  assert.equal(paid.status, 'paid');
  const reopened = await store.undoPayment(actorA, paid.payments[0].id);
  assert.equal(reopened.status, 'pending');
  assert.equal(reopened.paid_amount, 0);
  assert.equal(reopened.paid_at, null);
  await assert.rejects(() => store.undoPayment(actorA, paid.payments[0].id), /não encontrado/);
});

test('born paid: "já foi paga" leaves the payment on record', async () => {
  const [entry] = await store.createEntries(actorA, input({ description: 'Pix na hora', amount: 80, paid_at: '2026-11-03', payment_method: 'pix' }));
  assert.equal(entry.status, 'paid');
  assert.equal(entry.payments.length, 1);
  assert.equal(entry.payments[0].paid_at, '2026-11-03');
});

test('editing: one bill, or the shared fields across the rest of a series', async () => {
  const series = await store.createEntries(actorA, input({ description: 'Plano', amount: 100, repeat: 'recurring', repeat_count: 4 }));
  await store.addPayment(actorA, series[0].id, { amount: 100, paid_at: '2026-11-10', method: null, note: null });

  const updated = await store.updateEntry(actorA, series[1].id, { description: 'Plano Pro', amount: 150, supplier: 'Operadora' }, 'following');
  assert.deepEqual(updated.map((entry) => [entry.description, entry.amount]), [['Plano Pro', 150], ['Plano Pro', 150], ['Plano Pro', 150]]);
  const all = (await list(orgA)).filter((entry) => entry.series_id === series[0].series_id).sort((a, b) => a.installment_number - b.installment_number);
  assert.equal(all[0].description, 'Plano', 'the earlier installment keeps its text');
  assert.equal(all[3].supplier, 'Operadora');

  await assert.rejects(() => store.updateEntry(actorA, series[0].id, { amount: 50 }, 'this'), /menor que o já pago/);
  const moved = await store.updateEntry(actorA, series[2].id, { due_date: '2027-05-15' }, 'this');
  assert.equal(moved[0].due_date, '2027-05-15');
  assert.equal(moved[0].competence_month, '2027-05', 'the competence follows the new date');
});

test('deleting only marks it deleted, and restoring brings it back', async () => {
  const [entry] = await store.createEntries(actorA, input({ description: 'Apagar', amount: 10 }));
  await store.deleteEntries(actorA, entry.id, 'this');
  assert.ok(!(await list(orgA)).some((item) => item.id === entry.id));
  assert.equal((await sql`SELECT deleted_at IS NOT NULL AS gone FROM financial_entries WHERE id = ${entry.id}`)[0].gone, true);
  const restored = await store.restoreEntries(actorA, [entry.id]);
  assert.equal(restored.length, 1);
  assert.ok((await list(orgA)).some((item) => item.id === entry.id));
});

test('pay many pays what is left of each and skips the paid ones', async () => {
  const [first] = await store.createEntries(actorA, input({ description: 'Lote 1', amount: 100 }));
  const [second] = await store.createEntries(actorA, input({ description: 'Lote 2', amount: 200, paid_at: '2026-11-01' }));
  const [third] = await store.createEntries(actorA, input({ description: 'Lote 3', amount: 300 }));
  await store.addPayment(actorA, third.id, { amount: 100, paid_at: '2026-11-01', method: null, note: null });
  const result = await store.payMany(actorA, [first.id, second.id, third.id], '2026-11-09', 'pix');
  assert.deepEqual(result.map((entry) => entry.description).sort(), ['Lote 1', 'Lote 3']);
  assert.ok(result.every((entry) => entry.status === 'paid'));
  assert.equal(result.find((entry) => entry.description === 'Lote 3').paid_amount, 300);
});

test('the budget is saved per category and can be set back to zero', async () => {
  await store.saveBudgets(actorA, [{ category: 'Aluguel', amount: 3500 }, { category: 'Combustível', amount: 1200.5 }]);
  assert.deepEqual(await store.listBudgets(orgA), [{ category: 'Aluguel', amount: 3500 }, { category: 'Combustível', amount: 1200.5 }]);
  await store.saveBudgets(actorA, [{ category: 'Aluguel', amount: 0 }]);
  assert.equal((await store.listBudgets(orgA)).find((item) => item.category === 'Aluguel').amount, 0);
});

test('importing a spreadsheet: payments come with the rows that were paid', async () => {
  const inputs = [
    { input: input({ description: 'Importada 1', amount: 100 }), paid_amount: 0, paid_at: null },
    { input: input({ description: 'Importada 2', amount: 200 }), paid_amount: 200, paid_at: '2026-11-02' },
    { input: input({ description: 'Importada 3', amount: 300 }), paid_amount: 100, paid_at: null },
  ];
  assert.equal(await store.importEntries(actorA, inputs), 3);
  const found = (await list(orgA)).filter((entry) => entry.description.startsWith('Importada')).sort((a, b) => a.description.localeCompare(b.description));
  assert.deepEqual(found.map((entry) => [entry.status, entry.paid_amount]), [['pending', 0], ['paid', 200], ['pending', 100]]);
});

test('the lists respect the window but a late open bill never drops off', async () => {
  const [old] = await store.createEntries(actorA, input({ description: 'Muito antiga', amount: 5, due_date: '2020-03-01' }));
  const [paidOld] = await store.createEntries(actorA, input({ description: 'Antiga paga', amount: 5, due_date: '2020-03-02', paid_at: '2020-03-02' }));
  const window = await store.listEntries(orgA, '2026-01-01', '2026-12-31');
  assert.ok(window.some((entry) => entry.id === old.id), 'open and late: always there');
  assert.ok(!window.some((entry) => entry.id === paidOld.id), 'paid and out of the window: not there');
});

test('one company never sees or touches the bills of another', async () => {
  const [mine] = await store.createEntries(actorA, input({ description: 'Só da A', amount: 77 }));
  assert.ok(!(await list(orgB)).some((entry) => entry.id === mine.id));
  await assert.rejects(() => store.addPayment(actorB, mine.id, { amount: 77, paid_at: '2026-11-01', method: null, note: null }), /não encontrada/);
  await assert.rejects(() => store.updateEntry(actorB, mine.id, { amount: 1 }, 'this'), /não encontrada/);
  await assert.rejects(() => store.deleteEntries(actorB, mine.id, 'this'), /não encontrada/);
  assert.equal((await store.listBudgets(orgB)).length, 0);
});

after(async () => {
  // nothing is deleted: the test bills are archived and so are the test companies
  for (const org of [orgA, orgB]) {
    if (!org) continue;
    await sql`UPDATE financial_entries SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
    await sql`UPDATE financial_payments SET deleted_at = NOW() WHERE organization_id = ${org} AND deleted_at IS NULL`;
    await sql`UPDATE organizations SET deleted_at = NOW() WHERE id = ${org}`;
  }
});
