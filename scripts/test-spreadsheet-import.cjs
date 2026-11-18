// Run with: node scripts/test-spreadsheet-import.cjs
// readSpreadsheet loads SheetJS on demand (so the OS and Escala screens open without it) and must keep reading
// exactly as before: a CSV stays text (no US guessing), an Excel date keeps its real day, and dates become dd/mm/aaaa.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const XLSX = require('xlsx');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const { readSpreadsheet, applyBrazilianDateText, isTextSpreadsheet } = require('../lib/spreadsheet-import.ts');

const toBuffer = (text) => new TextEncoder().encode(text).buffer;

test('readSpreadsheet is asynchronous and reads a CSV as text', async () => {
  const pending = readSpreadsheet(toBuffer('Data;Valor\n05/10/2026;500,00\n'), 'os.csv');
  assert.ok(pending instanceof Promise);
  const workbook = await pending;
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
  assert.equal(rows.length, 1);
  assert.equal(Object.values(rows[0])[0] !== undefined, true);
  assert.equal(isTextSpreadsheet('os.csv'), true);
});

test('a CSV with accents is decoded as Windows-1252 when it is not UTF-8', async () => {
  const bytes = Uint8Array.from([...Buffer.from('Colaborador;Tipo\n', 'latin1'), ...Buffer.from('José;Instalação\n', 'latin1')]);
  const workbook = await readSpreadsheet(bytes.buffer, 'os.csv');
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: true });
  assert.equal(rows[0]['Colaborador'], 'José');
  assert.equal(rows[0]['Tipo'], 'Instalação');
});

test('an Excel file keeps its real dates, shown as dd/mm/aaaa after applyBrazilianDateText', async () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Data', 'Hora'], [new Date(2026, 9, 5), new Date(2026, 9, 5, 14, 30)]], { cellDates: true });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Banco de Dados');
  const file = XLSX.write(book, { type: 'array', bookType: 'xlsx', cellDates: true });

  const workbook = applyBrazilianDateText(await readSpreadsheet(file, 'horas.xlsx'));
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['Banco de Dados'], { defval: '', raw: false });
  assert.equal(rows[0]['Data'], '05/10/2026');
  assert.equal(rows[0]['Hora'], '05/10/2026 14:30');
});

test('Excel day numbers still convert through SheetJS SSF (the OS and Escala import helpers use it)', async () => {
  const parsed = XLSX.SSF.parse_date_code(46300.5);
  assert.deepEqual([parsed.y, parsed.m, parsed.d, parsed.H, parsed.M], [2026, 10, 5, 12, 0]);
});
