// Run with: node scripts/test-backup-workbook.cjs
// The backup as a spreadsheet (lib/backup/workbook.ts): synthetic data, no database. Reads the .xlsx back and checks the
// tabs, what a person sees in them (names instead of ids, real dates and money, the status in words), the archived
// records, the split of a tab that is too big, and that a company with years of records does not blow the memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const ExcelJS = require('exceljs');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  filename,
);
const { buildBackupWorkbook, SPECS } = require('../lib/backup/workbook.ts');
const { BACKUP_TABLES } = require('../lib/backup/tables.ts');

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORG = uuid(999);
const INFO = { kind: 'daily', createdAt: '2026-11-05T14:34:19Z' };

function file(extra = {}) {
  const tables = Object.fromEntries(BACKUP_TABLES.map((table) => [table, []]));
  tables.users = [{ id: uuid(1), organization_id: ORG, name: 'Carla Admin', email: 'carla@exemplo.com', role: 'admin', status: 'active', last_login_at: '2026-11-04T13:00:00Z', created_at: '2026-01-02T12:00:00Z' }];
  tables.technicians = [
    { id: uuid(10), organization_id: ORG, name: 'Ana Souza', qra: '123', email: 'ana@exemplo.com', status: 'active', commission_percentage: 25, base_salary: '2664.53', va_allowance: 249, vr_allowance: 783, created_at: '2026-02-01T15:30:00Z', deleted_at: null },
    { id: uuid(11), organization_id: ORG, name: 'Beto Lima', qra: '456', email: 'beto@exemplo.com', status: 'inactive', commission_percentage: 20, base_salary: 0, created_at: '2026-02-02T15:30:00Z', deleted_at: '2026-06-01T10:00:00Z' },
  ];
  tables.services = [
    { id: uuid(20), organization_id: ORG, order_code: 'OS-1', technician_id: uuid(10), service_type: 'Instalação', value: 150.5, date_performed: '2026-10-28', time_performed: '14:30:00', competence_month: '2026-10', fortnight_period: 'Q2', created_at: '2026-10-28T20:00:00Z', deleted_at: null },
    { id: uuid(21), organization_id: ORG, order_code: 'OS-2', technician_id: uuid(11), service_type: 'Reparo', value: 80, date_performed: '2026-10-29', time_performed: '09:05:00', competence_month: '2026-10', fortnight_period: 'Q2', created_at: '2026-10-29T12:00:00Z', deleted_at: null },
  ];
  tables.payroll = [{ id: uuid(30), organization_id: ORG, technician_id: uuid(10), competence_month: '2026-10', status: 'closed', total_services_value: 1000, net_total: 3500.25, hour_bank_balance: 2.5 }];
  tables.organization_settings = [{ organization_id: ORG, commission_mode: 'excess', commission_percentage: 25, base_salary: 2664.53, monthly_hours: 220, updated_at: '2026-11-04T13:23:06Z', updated_by: uuid(1), service_award_tiers: [{ min: 10, value: 100 }] }];
  tables.parts = [{ id: uuid(40), organization_id: ORG, name: 'Filtro', cost_price: 10, technician_price: 15, min_stock: 3, active: true, created_at: '2026-03-01T12:00:00Z' }];
  tables.part_movements = [{ id: uuid(41), organization_id: ORG, part_id: uuid(40), technician_id: null, quantity: 5, kind: 'purchase', created_at: '2026-03-02T12:00:00Z' }];
  tables.notifications = [{ id: uuid(50), organization_id: ORG, kind: 'billing', severity: 'info', title: 'Teste', body: 'Corpo', created_at: '2026-11-01T12:00:00Z', dedupe_key: 'x' }];
  Object.assign(tables, extra);
  return { format: 'nextrotta-backup', version: 1, createdAt: INFO.createdAt, organization: { id: ORG, name: 'Empresa Teste', slug: 'teste' }, tables };
}

async function load(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}
const rowOf = (sheet, number) => sheet.getRow(number).values.slice(1);

test('every table of the backup is in the summary, in a tab when it has data', async () => {
  const workbook = await load(await buildBackupWorkbook(file(), INFO));
  const summary = workbook.getWorksheet('Resumo');
  assert.equal(workbook.worksheets[0].name, 'Resumo', 'the summary comes first');
  const listed = [];
  summary.eachRow((row) => { const cell = row.getCell(2).value; listed.push(typeof cell === 'object' && cell ? cell.text : cell); });
  for (const table of BACKUP_TABLES) {
    const spec = SPECS.find((entry) => entry.table === table);
    if (spec) assert.ok(listed.includes(spec.sheet), `${table} (${spec.sheet}) is in the summary`);
  }
  // Empty tables are listed but get no tab: the workbook is not full of blank tabs.
  assert.ok(!workbook.getWorksheet('Descontos e adiantamentos'));
  assert.ok(workbook.getWorksheet('Técnicos') && workbook.getWorksheet('Serviços (OS)') && workbook.getWorksheet('Folhas'));
  assert.ok(workbook.getWorksheet('Notificações'), 'a table with no curated tab still gets a generic one');
});

test('a person can read it: names instead of ids, real dates, money, status in words', async () => {
  const workbook = await load(await buildBackupWorkbook(file(), { kind: 'manual', createdAt: INFO.createdAt }));

  const services = workbook.getWorksheet('Serviços (OS)');
  assert.deepEqual(rowOf(services, 1).slice(0, 6), ['Data', 'Hora', 'Código da OS', 'Técnico', 'Tipo de serviço', 'Valor']);
  const first = services.getRow(2); // newest first: 29/10
  assert.equal(first.getCell(1).value.toISOString().slice(0, 10), '2026-10-29');
  assert.equal(first.getCell(1).numFmt, 'dd/mm/yyyy');
  assert.equal(first.getCell(4).value, 'Beto Lima', 'the technician is a name, not an id');
  assert.equal(first.getCell(6).numFmt, '"R$" #,##0.00');
  assert.equal(services.getRow(3).getCell(6).value, 150.5);
  assert.equal(services.getRow(3).getCell(2).numFmt, 'hh:mm');

  const payroll = workbook.getWorksheet('Folhas');
  assert.equal(payroll.getRow(2).getCell(3).value, 'Fechada');
  assert.equal(payroll.getRow(2).getCell(2).value, 'Ana Souza');

  const technicians = workbook.getWorksheet('Técnicos');
  assert.equal(technicians.getRow(2).getCell(3).value, 'Ativo');
  assert.equal(technicians.getRow(2).getCell(6).numFmt, '0.##"%"');

  const movements = workbook.getWorksheet('Movimentações de peças');
  assert.equal(movements.getRow(2).getCell(2).value, 'Filtro');
  assert.equal(movements.getRow(2).getCell(3).value, 'Estoque central');
  assert.equal(movements.getRow(2).getCell(5).value, 'Compra');
});

test('Brasília clock: a timestamp shows the hour of Brasília, not UTC', async () => {
  const workbook = await load(await buildBackupWorkbook(file(), INFO));
  const created = workbook.getWorksheet('Técnicos').getRow(2).getCell(12).value; // 2026-02-01T15:30Z -> 12:30 in Brasília (UTC-3)
  assert.equal(created.toISOString().slice(0, 16), '2026-02-01T12:30');
  assert.equal(workbook.getWorksheet('Resumo').getRow(4).getCell(2).value.toISOString().slice(0, 16), '2026-11-05T11:34');
});

test('archived records stay, marked with when they were archived; the settings are a list in words', async () => {
  const workbook = await load(await buildBackupWorkbook(file(), INFO));
  const technicians = workbook.getWorksheet('Técnicos');
  const header = rowOf(technicians, 1);
  assert.equal(header[header.length - 1], 'Arquivado em');
  assert.equal(technicians.rowCount, 3, 'the archived technician is in the sheet');
  assert.ok(technicians.getRow(3).getCell(header.length).value instanceof Date);
  assert.ok(!technicians.getRow(2).getCell(header.length).value, 'an active one has no archive date');

  const settings = workbook.getWorksheet('Configurações');
  assert.deepEqual(rowOf(settings, 1), ['Configuração', 'Valor']);
  const labels = [];
  settings.eachRow((row) => labels.push(row.getCell(1).value));
  assert.ok(labels.includes('Jornada mensal (horas)') && labels.includes('Faixas de prêmio por produção'));
  assert.equal(labels[labels.length - 1], 'Atualizado em', 'the date of the last change comes last');
  assert.ok(!labels.some((label) => /updated_by|organization_id/.test(String(label))));
});

test('header row and filter are set, columns have widths, and secrets never appear', async () => {
  const workbook = await load(await buildBackupWorkbook(file(), INFO));
  const services = workbook.getWorksheet('Serviços (OS)');
  assert.equal(services.views[0].ySplit, 1, 'the first row is frozen');
  assert.equal(services.autoFilter, 'A1:J3', 'the filter covers all the data');
  assert.ok(services.getColumn(5).width >= 20);
  const all = [];
  for (const sheet of workbook.worksheets) sheet.eachRow((row) => row.eachCell((cell) => all.push(String(cell.value && cell.value.text ? cell.value.text : cell.value))));
  assert.ok(!all.some((text) => /password_hash|encrypted_password|access_token/.test(text)));
});

test('a table over the limit continues on the next tab; the summary links to both', async () => {
  const many = Array.from({ length: 25 }, (_, index) => ({ id: uuid(100 + index), organization_id: ORG, order_code: `OS-${index}`, technician_id: uuid(10), service_type: 'X', value: index, date_performed: '2026-10-01', time_performed: '10:00:00' }));
  const workbook = await load(await buildBackupWorkbook(file({ services: many }), INFO, { maxRowsPerSheet: 10 }));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name).filter((name) => name.startsWith('Serviços')), ['Serviços (OS)', 'Serviços (OS) (2)', 'Serviços (OS) (3)']);
  assert.equal(workbook.getWorksheet('Serviços (OS)').rowCount, 11);
  assert.equal(workbook.getWorksheet('Serviços (OS) (3)').rowCount, 6);
  let found = null;
  workbook.getWorksheet('Resumo').eachRow((row) => { const cell = row.getCell(2).value; if (cell && cell.text && cell.text.startsWith('Serviços')) found = cell; });
  assert.match(found.text, /Serviços \(OS\) … Serviços \(OS\) \(3\)/);
});

test('cells cannot run as formulas and odd characters do not break the file', async () => {
  const odd = 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(7) + 'c';
  const tricky = [{ id: uuid(60), organization_id: ORG, order_code: '=HYPERLINK("http://x")', technician_id: uuid(10), service_type: odd, value: 1, date_performed: '2026-10-01', time_performed: '10:00:00', description: 'x'.repeat(40000) }];
  const workbook = await load(await buildBackupWorkbook(file({ services: tricky }), INFO));
  const row = workbook.getWorksheet('Serviços (OS)').getRow(2);
  assert.equal(typeof row.getCell(3).value, 'string');
  assert.equal(row.getCell(3).value, '=HYPERLINK("http://x")');
  assert.equal(row.getCell(5).value, 'abc');
  assert.ok(String(row.getCell(9).value).length <= 32000, 'the cell limit of Excel is respected');
});

test('years of records: 250 thousand services in one tab, in seconds and without a large memory', async () => {
  const big = Array.from({ length: 250_000 }, (_, index) => ({
    id: uuid(1_000 + index), organization_id: ORG, order_code: `OS-${index}`, technician_id: uuid(10 + (index % 2)), service_type: 'Instalação de ponto de energia', value: 100 + (index % 50),
    date_performed: `2024-${String(1 + (index % 12)).padStart(2, '0')}-${String(1 + (index % 28)).padStart(2, '0')}`, time_performed: '10:30:00', competence_month: '2024-06', fortnight_period: 'Q1', created_at: '2024-06-01T12:00:00Z',
  }));
  const before = process.memoryUsage().rss;
  const started = Date.now();
  const buffer = await buildBackupWorkbook(file({ services: big }), INFO);
  const seconds = (Date.now() - started) / 1000;
  const grew = (process.memoryUsage().rss - before) / 1048576;
  console.log(`   250k rows: ${seconds.toFixed(1)} s, ${(buffer.length / 1048576).toFixed(1)} MB file, memory +${grew.toFixed(0)} MB`);
  assert.ok(seconds < 60, 'inside the time of a request');
  assert.ok(grew < 800, 'streamed: the memory does not follow the number of cells');
  assert.ok(buffer.length > 1_000_000);
});
