// Run with: node scripts/test-expenses.cjs
// The rules of Controle de despesas (lib/expenses.ts): where a bill stands, what is late and by how much, the
// forecast by week, the budget per category, the month calendar, installments and monthly repetitions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  filename,
);
const x = require('../lib/expenses.ts');

const TODAY = '2026-10-31';
const entry = (patch) => ({
  id: String(Math.random()), type: 'payable', description: 'Conta', category: 'Aluguel', supplier: null, amount: 100, paid_amount: 0,
  due_date: TODAY, competence_month: TODAY.slice(0, 7), status: 'pending', paid_at: null, payment_method: null, payment_code: null,
  nature: 'variable', series_id: null, installment_number: 1, installment_total: 1, is_recurring: false, notes: null, payments: [], ...patch,
});

test('dates: months never spill over and weeks are exact', () => {
  assert.equal(x.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(x.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(x.addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(x.addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(x.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(x.daysBetween('2026-10-31', '2026-11-03'), 3);
  assert.equal(x.lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(x.isDateKey('2026-02-30'), false);
  assert.equal(x.isDateKey('2026-02-28'), true);
});

test('state: overdue wins, then today, partial and upcoming; paid when nothing is left', () => {
  assert.equal(x.entryState(entry({ due_date: '2026-10-30' }), TODAY), 'overdue');
  assert.equal(x.entryState(entry({ due_date: '2026-10-30', paid_amount: 50 }), TODAY), 'overdue');
  assert.equal(x.entryState(entry({ due_date: TODAY }), TODAY), 'due_today');
  assert.equal(x.entryState(entry({ due_date: '2026-11-05', paid_amount: 40 }), TODAY), 'partial');
  assert.equal(x.entryState(entry({ due_date: '2026-11-05' }), TODAY), 'upcoming');
  assert.equal(x.entryState(entry({ due_date: '2026-09-01', paid_amount: 100 }), TODAY), 'paid');
  assert.equal(x.remainingOf(entry({ amount: 100, paid_amount: 30.5 })), 69.5);
});

test('labels say how far a bill is', () => {
  assert.equal(x.dueLabel('2026-10-31', TODAY), 'vence hoje');
  assert.equal(x.dueLabel('2026-11-01', TODAY), 'vence amanhã');
  assert.equal(x.dueLabel('2026-11-05', TODAY), 'vence em 5 dias');
  assert.equal(x.dueLabel('2026-10-30', TODAY), 'venceu ontem');
  assert.equal(x.dueLabel('2026-10-20', TODAY), 'venceu há 11 dias');
});

test('aging: what is late, by how late', () => {
  const list = [
    entry({ amount: 10, due_date: '2026-10-30' }),
    entry({ amount: 20, due_date: '2026-10-24' }),
    entry({ amount: 30, due_date: '2026-10-10' }),
    entry({ amount: 40, due_date: '2026-08-01' }),
    entry({ amount: 50, due_date: '2026-10-31' }),
    entry({ amount: 60, due_date: '2026-10-01', paid_amount: 60 }),
    entry({ type: 'receivable', amount: 70, due_date: '2026-10-01' }),
  ];
  const buckets = x.agingOfOverdue(list, TODAY);
  assert.deepEqual(buckets.map((bucket) => [bucket.key, bucket.total, bucket.count]), [['1-7', 30, 2], ['8-30', 30, 1], ['31-60', 0, 0], ['60+', 40, 1]]);
});

test('urgency groups open items, soonest first', () => {
  const list = [
    entry({ description: 'B', due_date: '2026-11-04' }), entry({ description: 'A', due_date: '2026-10-29' }), entry({ description: 'C', due_date: TODAY }),
    entry({ description: 'D', due_date: '2026-11-20' }), entry({ description: 'E', due_date: '2027-03-01' }), entry({ description: 'F', due_date: '2026-10-01', paid_amount: 100 }),
  ];
  const groups = x.groupByUrgency(list, TODAY);
  assert.deepEqual(groups.overdue.map((item) => item.description), ['A']);
  assert.deepEqual(groups.today.map((item) => item.description), ['C']);
  assert.deepEqual(groups.week.map((item) => item.description), ['B']);
  assert.deepEqual(groups.later.map((item) => item.description), ['D']);
});

test('forecast: late items first, then each week, with the running balance', () => {
  const list = [
    entry({ amount: 300, due_date: '2026-10-20' }), // late payable
    entry({ type: 'receivable', amount: 100, due_date: '2026-10-25' }), // late receivable
    entry({ amount: 200, due_date: '2026-11-02' }), // week 0 (31/10 to 06/11)
    entry({ type: 'receivable', amount: 1000, due_date: '2026-11-10' }), // week 1
    entry({ amount: 50, due_date: '2026-11-12', paid_amount: 20 }), // week 1, only 30 left
    entry({ amount: 999, due_date: '2026-11-03', paid_amount: 999 }), // paid: ignored
  ];
  const forecast = x.cashForecast(list, TODAY, 3);
  assert.deepEqual(forecast.overdue, { payable: 300, receivable: 100 });
  assert.deepEqual(forecast.weeks.map((week) => [week.payable, week.receivable, week.net, week.balance]), [[200, 0, -200, -400], [30, 1000, 970, 570], [0, 0, 0, 570]]);
  assert.equal(forecast.totalNet, 570);
  assert.equal(forecast.weeks[1].start, '2026-11-07');
});

test('open within counts what is late too', () => {
  const list = [entry({ amount: 10, due_date: '2026-10-01' }), entry({ amount: 20, due_date: '2026-11-03' }), entry({ amount: 40, due_date: '2026-12-25' })];
  assert.deepEqual(x.openWithin(list, 'payable', TODAY, 7), { total: 30, count: 2 });
});

test('paid in a month comes from the payments, not from the due date', () => {
  const list = [
    entry({ amount: 100, due_date: '2026-09-10', payments: [{ id: 'a', amount: 60, paid_at: '2026-10-02', method: null, note: null }, { id: 'b', amount: 40, paid_at: '2026-09-28', method: null, note: null }] }),
    entry({ type: 'receivable', amount: 500, payments: [{ id: 'c', amount: 500, paid_at: '2026-10-05', method: null, note: null }] }),
  ];
  assert.equal(x.paidInMonth(list, 'payable', '2026-10'), 60);
  assert.equal(x.paidInMonth(list, 'payable', '2026-09'), 40);
  assert.equal(x.paidInMonth(list, 'receivable', '2026-10'), 500);
});

test('spending by category and the budget against it', () => {
  const list = [
    entry({ category: 'Aluguel', amount: 3000, nature: 'fixed' }), entry({ category: 'Combustível', amount: 900 }), entry({ category: 'Combustível', amount: 250 }),
    entry({ category: 'Energia', amount: 100, competence_month: '2026-09' }), entry({ type: 'receivable', category: 'Aluguel', amount: 9 }),
  ];
  const spending = x.spendingByCategory(list, '2026-10');
  assert.deepEqual(spending.map((row) => [row.category, row.total, row.fixed, row.variable]), [['Aluguel', 3000, 3000, 0], ['Combustível', 1150, 0, 1150]]);

  const rows = x.budgetProgress([{ category: 'Combustível', amount: 1000 }, { category: 'Aluguel', amount: 4000 }, { category: 'Marketing', amount: 500 }, { category: 'Energia', amount: 0 }], spending);
  const byCategory = Object.fromEntries(rows.map((row) => [row.category, row]));
  assert.equal(byCategory['Combustível'].status, 'over');
  assert.equal(byCategory['Combustível'].remaining, -150);
  assert.equal(byCategory['Aluguel'].status, 'ok');
  assert.equal(byCategory['Marketing'].spent, 0);
  assert.equal(byCategory['Energia'].status, 'none');
  assert.equal(x.budgetProgress([{ category: 'A', amount: 100 }], [{ category: 'A', total: 80, fixed: 0, variable: 80, count: 1 }])[0].status, 'warning');
  assert.equal(rows[0].category, 'Combustível', 'the one over budget comes first');
});

test('calendar: a six-week grid starting on Sunday with the day totals', () => {
  const list = [entry({ amount: 100, due_date: '2026-10-05' }), entry({ amount: 50, due_date: '2026-10-05' }), entry({ type: 'receivable', amount: 70, due_date: '2026-10-05' }), entry({ due_date: '2026-11-01' })];
  const days = x.calendarMonth(list, '2026-10', TODAY);
  assert.equal(days.length, 42);
  assert.equal(days[0].date, '2026-09-27', 'October 2026 starts on a Thursday');
  assert.equal(days.find((day) => day.date === '2026-10-05').payable, 150);
  assert.equal(days.find((day) => day.date === '2026-10-05').receivable, 70);
  assert.equal(days.find((day) => day.date === TODAY).isToday, true);
  assert.equal(days.find((day) => day.date === '2026-11-01').inMonth, false);
});

test('installments split the total to the cent, repetitions repeat it', () => {
  assert.deepEqual(x.splitInstallmentAmounts(100, 3), [33.34, 33.33, 33.33]);
  assert.equal(x.splitInstallmentAmounts(1000.01, 7).reduce((total, value) => total + value, 0).toFixed(2), '1000.01');
  const base = { type: 'payable', description: 'Notebook', amount: 1000, due_date: '2026-01-31', category: 'Equipamentos' };
  const installments = x.parseEntryInput({ ...base, repeat: 'installments', repeat_count: 4 }).entry;
  const rows = x.buildEntryRows(installments);
  assert.deepEqual(rows.map((row) => row.amount), [250, 250, 250, 250]);
  assert.deepEqual(rows.map((row) => row.due_date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(rows.map((row) => row.competence_month), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.equal(rows[2].installment_number, 3);
  assert.equal(rows[2].installment_total, 4);
  const monthly = x.buildEntryRows(x.parseEntryInput({ ...base, repeat: 'recurring', repeat_count: 3 }).entry);
  assert.deepEqual(monthly.map((row) => row.amount), [1000, 1000, 1000]);
  assert.ok(monthly.every((row) => row.is_recurring && row.nature === 'fixed'), 'what repeats every month is a fixed cost');
});

test('input is checked with a message for the person', () => {
  const ok = { type: 'payable', description: ' Aluguel ', amount: '1.500,50', due_date: '2026-11-10' };
  assert.ok('error' in x.parseEntryInput({ ...ok, type: 'x' }));
  assert.ok('error' in x.parseEntryInput({ ...ok, description: '  ' }));
  assert.ok('error' in x.parseEntryInput({ ...ok, amount: 0 }));
  assert.ok('error' in x.parseEntryInput({ ...ok, amount: -5 }));
  assert.ok('error' in x.parseEntryInput({ ...ok, due_date: '2026-02-30' }));
  assert.ok('error' in x.parseEntryInput({ ...ok, competence_month: '2026-13' }));
  assert.ok('error' in x.parseEntryInput({ ...ok, paid_at: 'ontem' }));
  const parsed = x.parseEntryInput({ ...ok, amount: 1500.5, category: '', payment_method: 'pix', paid_at: '2026-11-01' }).entry;
  assert.equal(parsed.description, 'Aluguel');
  assert.equal(parsed.category, 'Geral');
  assert.equal(parsed.competence_month, '2026-11');
  assert.equal(parsed.payment_method, 'pix');
  assert.equal(parsed.paid_at, '2026-11-01');
  assert.equal(x.parseEntryInput({ ...ok, amount: 1, payment_method: 'cheque' }).entry.payment_method, null);
  assert.equal(x.parseEntryInput({ ...ok, amount: 1, repeat: 'installments', repeat_count: 500 }).entry.repeat_count, 120);
});

test('the list filters by state, type, category, month and a search that ignores accents', () => {
  const list = [
    entry({ description: 'Manutenção da frota', category: 'Frota', due_date: '2026-10-10' }),
    entry({ description: 'Aluguel', due_date: '2026-11-05', supplier: 'Imobiliária São José' }),
    entry({ description: 'Seguro', due_date: '2026-10-01', paid_amount: 100 }),
    entry({ type: 'receivable', description: 'Contrato', due_date: '2026-11-20' }),
  ];
  const base = { query: '', type: 'all', state: 'all', category: 'all', month: null };
  assert.equal(x.filterEntries(list, { ...base, query: 'manutencao' }, TODAY).length, 1);
  assert.equal(x.filterEntries(list, { ...base, query: 'sao jose' }, TODAY).length, 1);
  assert.equal(x.filterEntries(list, { ...base, state: 'overdue' }, TODAY).length, 1);
  assert.equal(x.filterEntries(list, { ...base, state: 'paid' }, TODAY).length, 1);
  assert.equal(x.filterEntries(list, { ...base, state: 'open' }, TODAY).length, 3);
  assert.equal(x.filterEntries(list, { ...base, type: 'receivable' }, TODAY).length, 1);
  assert.equal(x.filterEntries(list, { ...base, month: '2026-11' }, TODAY).length, 2);
  assert.equal(x.filterEntries(list, { ...base, category: 'Frota' }, TODAY).length, 1);
  assert.equal(x.filterEntries(list, base, TODAY).at(-1).description, 'Seguro', 'paid ones go last');
});

test('the spreadsheet: headers, dates and amounts are read the way people write them', () => {
  const imp = require('../lib/expenses-import.ts');
  assert.equal(imp.normalizeDate('10/11/2026'), '2026-11-10');
  assert.equal(imp.normalizeDate('2026-11-10T00:00:00.000Z'), '2026-11-10');
  assert.equal(imp.normalizeDate(new Date(2026, 10, 10)), '2026-11-10');
  assert.equal(imp.normalizeAmount('R$ 1.500,50'), 1500.5);
  assert.equal(imp.normalizeAmount('1.500'), 1500);
  assert.equal(imp.normalizeAmount('1500,5'), 1500.5);
  assert.equal(imp.normalizeAmount(12), 12);
  assert.ok(Number.isNaN(imp.normalizeAmount('abc')));

  const rows = imp.parseImportRows([
    { Tipo: 'A pagar', 'Descrição': 'Aluguel', Categoria: 'Aluguel', Valor: '1.500,00', Vencimento: '10/11/2026', Status: 'Baixada', 'Forma de pagamento': 'Pix' },
    { TIPO: 'a receber', DESCRICAO: 'Contrato', VALOR: 900, VENCIMENTO: '2026-11-20', 'Valor pago': '300', 'Data da baixa': '01/11/2026' },
    { Tipo: 'x', 'Descrição': 'Errada', Valor: 10, Vencimento: '2026-11-10' },
    { Tipo: 'A pagar', 'Descrição': '', Valor: 10, Vencimento: '2026-11-10' },
    { Tipo: 'A pagar', 'Descrição': 'Sem valor', Valor: 'abc', Vencimento: '2026-11-10' },
    { Tipo: 'A pagar', 'Descrição': 'Data ruim', Valor: 10, Vencimento: '31/02/2026' },
    { Tipo: '', 'Descrição': '', Valor: '', Vencimento: '' },
    { Tipo: 'A pagar', 'Descrição': 'Modelo', Valor: 1, Vencimento: '2026-11-10', 'Observações': 'Exemplo — pode apagar esta linha' },
  ]);
  assert.equal(rows.length, 6, 'the empty row and the template example are skipped');
  assert.equal(rows[0].problem, null);
  assert.deepEqual([rows[0].values.type, rows[0].values.amount, rows[0].values.due_date, rows[0].values.competence_month, rows[0].values.payment_method], ['payable', 1500, '2026-11-10', '2026-11', 'pix']);
  assert.equal(rows[1].problem, null);
  assert.equal(rows[1].values.paid_amount, 300);
  assert.equal(rows[1].values.paid_at, '2026-11-01');
  assert.deepEqual(rows.slice(2).map((row) => Boolean(row.problem)), [true, true, true, true]);
  assert.equal(rows[0].line, 2);
});
