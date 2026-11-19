// Run with: node scripts/test-parts-corrections.cjs
// Venda de Peças: fixing what was launched wrong (undo/correct an entry, undo a remittance, correct a sale, undo a closed
// inventory), permanent delete of parts and undoing a spreadsheet import. Uses the development database on a test company of its
// own ("zz-teste-pecas"); when done, erase it for real with purge-test-blobs.mjs and purge-test-orgs.mjs (see CLAUDE.md).
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
const { sql } = require('../lib/db.ts');
const catalog = require('../lib/parts/catalog.ts');
const stock = require('../lib/parts/stock.ts');
const sales = require('../lib/parts/sales.ts');
const fix = require('../lib/parts/corrections.ts');

const SLUG = 'zz-teste-pecas';
const stamp = Date.now();
let org;
let actor;
let techA;
let techB;

const central = async (partId) => Number((await sql`SELECT COALESCE(SUM(quantity), 0) AS q FROM part_movements WHERE organization_id = ${org} AND part_id = ${partId} AND technician_id IS NULL`)[0].q);
const withTech = async (partId, technicianId) => Number((await sql`SELECT COALESCE(SUM(quantity), 0) AS q FROM part_movements WHERE organization_id = ${org} AND part_id = ${partId} AND technician_id = ${technicianId}`)[0].q);
const owed = async (technicianId) => Number((await sql`SELECT COALESCE(SUM(amount), 0) AS a FROM part_account_entries WHERE organization_id = ${org} AND technician_id = ${technicianId}`)[0].a);
const exists = async (partId) => (await sql`SELECT 1 FROM parts WHERE id = ${partId}`).length === 1;
const newPart = async (name, extra = {}) => catalog.createPart(org, { name: `${name} ${stamp}`, costPrice: 10, technicianPrice: 30, suggestedPrice: 50, ...extra }, actor);
const rejects = (promise, pattern) => assert.rejects(promise, (error) => { assert.match(error.message, pattern); return true; });

test('setup: a test company with an admin and two technicians', async () => {
  const found = (await sql`SELECT id FROM organizations WHERE slug = ${SLUG}`)[0];
  org = found?.id ?? (await sql`INSERT INTO organizations (slug, name, status) VALUES (${SLUG}, 'Teste peças', 'active') RETURNING id`)[0].id;
  const user = (await sql`INSERT INTO users (organization_id, email, name, role, password_hash) VALUES (${org}, ${`pecas-${stamp}@exemplo.com`}, 'Admin Peças', 'admin', 'x') RETURNING id`)[0].id;
  actor = { id: user, role: 'admin', impersonationId: null };
  techA = (await sql`INSERT INTO technicians (organization_id, name, email) VALUES (${org}, 'Técnico A', ${`a-${stamp}@exemplo.com`}) RETURNING id`)[0].id;
  techB = (await sql`INSERT INTO technicians (organization_id, name, email) VALUES (${org}, 'Técnico B', ${`b-${stamp}@exemplo.com`}) RETURNING id`)[0].id;
  // A sale needs the technician's Mercado Pago account connected, even when it is paid in cash.
  await sql`INSERT INTO mercadopago_accounts (organization_id, technician_id, mp_user_id, access_token_enc) VALUES (${org}, ${techA}, ${`mp-${stamp}`}, 'x')`;
});

test('an entry launched wrong is undone; a second undo and an undo with the units gone are refused', async () => {
  const part = await newPart('Entrada');
  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 10, unitCost: 5 }] }, actor);
  const [entry] = await sql`SELECT id FROM part_movements WHERE part_id = ${part.id} AND kind = 'purchase'`;
  await rejects(fix.reverseMovement(org, entry.id, {}, actor), /motivo/i);
  await fix.reverseMovement(org, entry.id, { reason: 'lancei errado' }, actor);
  assert.equal(await central(part.id), 0);
  await rejects(fix.reverseMovement(org, entry.id, { reason: 'de novo' }, actor), /já foi desfeito/);
  const rows = await sql`SELECT kind, quantity, corrects_id, correction_kind FROM part_movements WHERE part_id = ${part.id} ORDER BY created_at, quantity DESC`;
  assert.equal(rows.length, 2, 'the original stays; the undo is a new row');
  assert.equal(rows[1].correction_kind, 'reversal');

  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 4, unitCost: 5 }] }, actor);
  await stock.createTransfer(org, { technicianId: techA, direction: 'out', items: [{ partId: part.id, quantity: 3 }] }, actor);
  const [again] = await sql`SELECT id FROM part_movements WHERE part_id = ${part.id} AND kind = 'purchase' AND quantity = 4`;
  await rejects(fix.reverseMovement(org, again.id, { reason: 'x' }, actor), /já saíram do estoque central/);
  assert.equal(await central(part.id), 1, 'nothing changed');
});

test('a purchase is corrected in one step and the Financeiro sum follows', async () => {
  const part = await newPart('Compra');
  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 10, unitCost: 5 }] }, actor);
  const [entry] = await sql`SELECT id FROM part_movements WHERE part_id = ${part.id} AND kind = 'purchase'`;
  await rejects(fix.correctPurchase(org, entry.id, { quantity: 10, unitCost: 5, reason: 'x' }, actor), /Nada mudou/);
  await fix.correctPurchase(org, entry.id, { quantity: 8, unitCost: 6, reason: 'contei errado' }, actor);
  assert.equal(await central(part.id), 8);
  const spent = Number((await sql`SELECT SUM(quantity * unit_cost) AS s FROM part_movements WHERE part_id = ${part.id} AND kind = 'purchase'`)[0].s);
  assert.equal(spent, 48, 'what the Financeiro adds up as bought: 8 × 6');
  await rejects(fix.correctPurchase(org, entry.id, { quantity: 9, unitCost: 6, reason: 'x' }, actor), /já foi desfeito/, 'the old entry cannot be corrected twice');
  const [fresh] = await sql`SELECT id FROM part_movements WHERE part_id = ${part.id} AND kind = 'purchase' AND corrects_id IS NULL AND quantity = 8`;
  await fix.correctPurchase(org, fresh.id, { quantity: 12, unitCost: 6, reason: 'faltou contar' }, actor);
  assert.equal(await central(part.id), 12, 'the corrected entry can be corrected again');
});

test('a remittance is undone, once, and only while the technician still has the units', async () => {
  const part = await newPart('Remessa');
  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 10 }] }, actor);
  const transfer = await stock.createTransfer(org, { technicianId: techA, direction: 'out', items: [{ partId: part.id, quantity: 4 }] }, actor);
  assert.equal([await central(part.id), await withTech(part.id, techA)].join(), '6,4');
  await fix.undoTransfer(org, transfer.id, { reason: 'técnico errado' }, actor);
  assert.equal([await central(part.id), await withTech(part.id, techA)].join(), '10,0');
  await rejects(fix.undoTransfer(org, transfer.id, { reason: 'x' }, actor), /já foi desfeita/);
  assert.equal((await stock.getTransfer(org, transfer.id)).units, 4, 'the unit count ignores the undo rows');
  assert.ok((await stock.getTransfer(org, transfer.id)).canceledAt);
  await rejects(stock.acknowledgeTransfer(org, transfer.id, techA, actor, null), /foi desfeita/);

  const second = await stock.createTransfer(org, { technicianId: techA, direction: 'out', items: [{ partId: part.id, quantity: 5 }] }, actor);
  await stock.adjustStock(org, { partId: part.id, technicianId: techA, quantity: -3, note: 'vendeu por fora' }, actor);
  await rejects(fix.undoTransfer(org, second.id, { reason: 'x' }, actor), /já saíram do carro do técnico/);
  assert.equal(await withTech(part.id, techA), 2, 'nothing changed');
});

test('a sale is corrected without rewriting the ledger, and canceling it afterwards still nets to zero', async () => {
  const part = await newPart('Venda');
  const other = await newPart('Outra');
  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 10 }, { partId: other.id, quantity: 10 }] }, actor);
  await stock.createTransfer(org, { technicianId: techA, direction: 'out', items: [{ partId: part.id, quantity: 5 }, { partId: other.id, quantity: 5 }] }, actor);
  const ownedBefore = await owed(techA);
  const sale = await sales.createSale(org, techA, { paymentMethod: 'cash', customerPhone: '(21) 99779-2422', customerName: 'Cliente', items: [{ partId: part.id, quantity: 2, unitPrice: '50,00' }] }, actor);
  assert.equal([await withTech(part.id, techA), (await owed(techA)) - ownedBefore].join(), '3,60');

  await rejects(sales.editSale(org, sale.id, { customerName: 'Novo' }, actor), /motivo/i);
  await rejects(sales.editSale(org, sale.id, { reason: 'x' }, actor), /Nada mudou/);
  const renamed = await sales.editSale(org, sale.id, { reason: 'nome errado', customerName: 'Maria' }, actor);
  assert.equal(renamed.customerName, 'Maria');
  assert.ok(renamed.editedAt);

  const edited = await sales.editSale(org, sale.id, { reason: 'quantidade errada', items: [{ partId: part.id, quantity: 3, unitPrice: '55,00' }, { partId: other.id, quantity: 1, unitPrice: '40,00' }] }, actor);
  assert.equal(edited.totalAmount, 205);
  assert.equal(edited.totalTechnicianPrice, 120);
  assert.equal([await withTech(part.id, techA), await withTech(other.id, techA)].join(), '2,4', 'one more unit of the first, one of the new part');
  assert.equal((await owed(techA)) - ownedBefore, 120, 'what the technician owes follows the sale');
  const ledger = await sql`SELECT kind, correction_kind, quantity FROM part_movements WHERE sale_id = ${sale.id} AND part_id = ${part.id} ORDER BY created_at`;
  assert.deepEqual(ledger.map((row) => [row.kind, row.correction_kind, Number(row.quantity)]), [['sale', null, -2], ['sale', 'delta', -1]]);

  const trimmed = await sales.editSale(org, sale.id, { reason: 'tirei a outra', items: [{ partId: part.id, quantity: 3, unitPrice: '55,00' }] }, actor);
  assert.equal(trimmed.items.length, 1);
  assert.equal(await withTech(other.id, techA), 5, 'the part taken out of the sale went back to the car');
  assert.equal((await owed(techA)) - ownedBefore, 90);
  await rejects(sales.editSale(org, sale.id, { reason: 'x', items: [{ partId: part.id, quantity: 99, unitPrice: '55,00' }] }, actor), /Estoque|estoque|mudou/);

  await sales.cancelSale(org, sale.id, { reason: 'cliente desistiu' }, actor);
  assert.equal(await withTech(part.id, techA), 5, 'everything is back');
  assert.equal((await owed(techA)) - ownedBefore, 0, 'the technician owes nothing for it');
  await rejects(sales.editSale(org, sale.id, { reason: 'x', customerName: 'Y' }, actor), /cancelada/);
});

test('a sale with a Mercado Pago charge only lets the customer data be corrected', async () => {
  const part = await newPart('Cobrada');
  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 5 }] }, actor);
  await stock.createTransfer(org, { technicianId: techA, direction: 'out', items: [{ partId: part.id, quantity: 5 }] }, actor);
  const sale = await sales.createSale(org, techA, { paymentMethod: 'cash', customerPhone: '(21) 99779-2422', items: [{ partId: part.id, quantity: 1, unitPrice: '50,00' }] }, actor);
  await sql`UPDATE part_sales SET mp_payment_id = ${`pay-${stamp}`} WHERE id = ${sale.id}`;
  await rejects(sales.editSale(org, sale.id, { reason: 'x', items: [{ partId: part.id, quantity: 2, unitPrice: '50,00' }] }, actor), /Mercado Pago/);
  const ok = await sales.editSale(org, sale.id, { reason: 'telefone errado', customerPhone: '(21) 98888-7777', items: [{ partId: part.id, quantity: 1, unitPrice: '50,00' }] }, actor);
  assert.match(ok.customerPhone, /988887777$/);
});

test('a closed inventory is undone: stock goes back and the debt it generated is canceled', async () => {
  const part = await newPart('Inventário');
  await stock.addPurchase(org, { items: [{ partId: part.id, quantity: 10 }] }, actor);
  await stock.createTransfer(org, { technicianId: techB, direction: 'out', items: [{ partId: part.id, quantity: 6 }] }, actor);
  const inventory = await stock.startInventory(org, { technicianId: techB }, actor);
  await stock.countInventoryItem(org, inventory.id, { partId: part.id, set: 4 }, actor);
  await stock.closeInventory(org, inventory.id, { resolutions: { [part.id]: 'charge' }, installments: 1 }, actor);
  assert.equal(await withTech(part.id, techB), 4);
  const debt = (await sql`SELECT id, status FROM part_debts WHERE inventory_id = ${inventory.id}`)[0];
  assert.equal(debt.status, 'active');
  const owedBefore = await owed(techB);
  assert.equal(owedBefore, 60, '2 missing × R$ 30');

  await rejects(fix.revertInventory(org, inventory.id, {}, actor), /motivo/i);
  await fix.revertInventory(org, inventory.id, { reason: 'contagem errada' }, actor);
  assert.equal(await withTech(part.id, techB), 6, 'the stock is what it was before the count');
  assert.equal((await sql`SELECT status FROM part_debts WHERE id = ${debt.id}`)[0].status, 'canceled');
  assert.equal(await owed(techB), 0);
  assert.equal((await stock.getInventory(org, inventory.id)).status, 'reverted');
  await rejects(fix.revertInventory(org, inventory.id, { reason: 'x' }, actor), /já foi desfeito/);
});

test('permanent delete: only parts with no history go, a dry run touches nothing, and the audit keeps what was erased', async () => {
  const sold = await newPart('Com remessa');
  const withInventory = await newPart('Com inventário');
  await stock.addPurchase(org, { items: [{ partId: sold.id, quantity: 3 }, { partId: withInventory.id, quantity: 2 }] }, actor);
  await stock.createTransfer(org, { technicianId: techB, direction: 'out', items: [{ partId: sold.id, quantity: 1 }] }, actor);
  // A central count lists every part in stock, so the clean part is created after it.
  const inv = await stock.startInventory(org, {}, actor);
  await stock.countInventoryItem(org, inv.id, { partId: withInventory.id, set: 2 }, actor);
  await stock.closeInventory(org, inv.id, {}, actor);
  const clean = await newPart('Limpa');
  await stock.addPurchase(org, { items: [{ partId: clean.id, quantity: 7 }] }, actor);

  const dry = await fix.purgeParts(org, [clean.id, sold.id, withInventory.id], { dryRun: true }, actor);
  assert.deepEqual([dry.eligible.length, dry.blocked.length, dry.deleted, dry.units], [1, 2, 0, 7]);
  assert.ok(await exists(clean.id), 'a dry run erases nothing');
  assert.match(dry.blocked.find((part) => part.id === sold.id).blockedReason, /técnico/);
  assert.match(dry.blocked.find((part) => part.id === withInventory.id).blockedReason, /inventário/);

  const result = await fix.purgeParts(org, [clean.id, sold.id, withInventory.id], {}, actor);
  assert.equal(result.deleted, 1);
  assert.equal(await exists(clean.id), false);
  assert.equal((await sql`SELECT 1 FROM part_movements WHERE part_id = ${clean.id}`).length, 0, 'its entries went with it');
  assert.ok(await exists(sold.id) && (await exists(withInventory.id)), 'the others stay');
  const audit = (await sql`SELECT details FROM audit_events WHERE organization_id = ${org} AND action = 'part.purged' ORDER BY created_at DESC LIMIT 1`)[0];
  assert.equal(audit.details.count, 1);
  await rejects(fix.purgeParts(org, [], {}, actor), /ao menos uma/);
});

test('a spreadsheet import is undone: created parts erased, updated ones put back, the units reversed', async () => {
  const kept = await newPart('Existente', { barcode: `7${String(stamp).slice(-12)}` });
  const first = await catalog.importParts(org, [
    { name: `Planilha A ${stamp}`, costPrice: 4, technicianPrice: 8, suggestedPrice: 12, quantity: 10 },
    { name: `Planilha B ${stamp}`, costPrice: 5, technicianPrice: 9, suggestedPrice: 13, quantity: 5 },
    { name: kept.name, barcode: kept.barcode, costPrice: 99, technicianPrice: 98, suggestedPrice: 97, quantity: 3 },
  ], actor);
  assert.deepEqual([first.created, first.updated, first.units], [2, 1, 18]);
  const created = (await sql`SELECT id FROM parts WHERE import_id = ${first.importId}`).map((row) => row.id);
  assert.equal(created.length, 2);
  assert.equal(Number((await catalog.getPart(org, kept.id)).costPrice), 99);
  assert.equal((await fix.listImports(org))[0].id, first.importId);

  const result = await fix.undoImport(org, first.importId, actor);
  assert.deepEqual([result.erased, result.restored], [2, 1]);
  for (const id of created) assert.equal(await exists(id), false);
  const back = await catalog.getPart(org, kept.id);
  assert.deepEqual([back.costPrice, back.technicianPrice, back.suggestedPrice, back.centralStock], [10, 30, 50, 0], 'the part is as before and the 3 units left');
  await rejects(fix.undoImport(org, first.importId, actor), /já foi desfeita/);
  assert.ok((await fix.listImports(org))[0].undoneAt);
});

test('an import cannot be undone once what it created has history: nothing is touched', async () => {
  const second = await catalog.importParts(org, [{ name: `Planilha C ${stamp}`, costPrice: 4, technicianPrice: 8, suggestedPrice: 12, quantity: 10 }], actor);
  const [created] = await sql`SELECT id FROM parts WHERE import_id = ${second.importId}`;
  await stock.createTransfer(org, { technicianId: techB, direction: 'out', items: [{ partId: created.id, quantity: 2 }] }, actor);
  await rejects(fix.undoImport(org, second.importId, actor), /Planilha C.*já foi enviada a um técnico/);
  assert.ok(await exists(created.id));
  assert.equal(await central(created.id), 8);
  assert.equal((await sql`SELECT undone_at FROM part_imports WHERE id = ${second.importId}`)[0].undone_at, null);
});

test('an import whose units already left the central stock is refused for the part it only updated', async () => {
  const part = await newPart('Atualizada', { barcode: `8${String(stamp).slice(-12)}` });
  const entry = await catalog.importParts(org, [{ name: part.name, barcode: part.barcode, quantity: 6 }], actor);
  await stock.createTransfer(org, { technicianId: techA, direction: 'out', items: [{ partId: part.id, quantity: 5 }] }, actor);
  await rejects(fix.undoImport(org, entry.importId, actor), /já saiu/);
  assert.equal(await central(part.id), 1);
});

after(() => {
  console.log(`\nEmpresa de teste: ${SLUG} (apague de vez: node scripts/purge-test-blobs.mjs --apply e node scripts/purge-test-orgs.mjs --apply)`);
  setTimeout(() => process.exit(0), 100).unref();
});
