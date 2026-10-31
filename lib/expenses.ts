// Controle de despesas: the arithmetic and the rules, with no database and no React, so the screen, the API and the
// tests all use the same functions. Amounts are R$ with cents; dates are "YYYY-MM-DD" (Brasília, never UTC).

export type EntryType = 'payable' | 'receivable';
export type EntryNature = 'fixed' | 'variable';
export type PaymentMethod = 'pix' | 'boleto' | 'transfer' | 'card' | 'debit' | 'cash' | 'other';

export const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'pix', label: 'Pix' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'card', label: 'Cartão de crédito' },
  { value: 'debit', label: 'Débito automático' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'other', label: 'Outro' },
];

export type ExpensePayment = { id: string; amount: number; paid_at: string; method: string | null; note: string | null };

export type ExpenseEntry = {
  id: string;
  type: EntryType;
  description: string;
  category: string;
  supplier: string | null;
  amount: number;
  paid_amount: number;
  due_date: string;
  competence_month: string;
  status: 'pending' | 'paid';
  paid_at: string | null;
  payment_method: string | null;
  payment_code: string | null;
  nature: EntryNature;
  series_id: string | null;
  installment_number: number;
  installment_total: number;
  is_recurring: boolean;
  notes: string | null;
  payments: ExpensePayment[];
};

export const cents = (value: unknown): number => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
};

export function methodLabel(method: string | null | undefined) {
  return PAYMENT_METHODS.find((item) => item.value === method)?.label ?? '';
}

// ------------------------------------------------------------------------------------------------ dates

export const isDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const isMonthKey = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The same day some months later; the 31st lands on the last day of a shorter month instead of spilling over. */
export function addMonths(dateKey: string, offset: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export const shiftMonth = (month: string, offset: number) => addMonths(`${month}-01`, offset).slice(0, 7);

export function daysBetween(from: string, to: string) {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function lastDayOfMonth(month: string) {
  return addDays(`${shiftMonth(month, 1)}-01`, -1);
}

// ------------------------------------------------------------------------------------------------ state

export type EntryState = 'paid' | 'overdue' | 'due_today' | 'partial' | 'upcoming';

export const remainingOf = (entry: Pick<ExpenseEntry, 'amount' | 'paid_amount'>) => Math.max(0, cents(entry.amount - entry.paid_amount));

/** Where a bill stands today. Overdue wins over partial: a half-paid bill past its date still needs attention. */
export function entryState(entry: Pick<ExpenseEntry, 'amount' | 'paid_amount' | 'due_date'>, today: string): EntryState {
  if (remainingOf(entry) <= 0) return 'paid';
  if (entry.due_date < today) return 'overdue';
  if (entry.due_date === today) return 'due_today';
  return entry.paid_amount > 0 ? 'partial' : 'upcoming';
}

/** "venceu há 3 dias", "vence hoje", "vence amanhã", "vence em 5 dias". */
export function dueLabel(due: string, today: string) {
  const days = daysBetween(today, due);
  if (days === 0) return 'vence hoje';
  if (days === 1) return 'vence amanhã';
  if (days > 1) return `vence em ${days} dias`;
  return days === -1 ? 'venceu ontem' : `venceu há ${-days} dias`;
}

// ------------------------------------------------------------------------------------------------ aggregates

const openEntries = (entries: ExpenseEntry[], type: EntryType) => entries.filter((entry) => entry.type === type && remainingOf(entry) > 0);
const sumRemaining = (entries: ExpenseEntry[]) => cents(entries.reduce((total, entry) => total + remainingOf(entry), 0));

export type AgingBucket = { key: string; label: string; from: number; to: number; total: number; count: number };

/** What is late, by how late: the first thing worth looking at. */
export function agingOfOverdue(entries: ExpenseEntry[], today: string, type: EntryType = 'payable'): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: '1-7', label: '1 a 7 dias', from: 1, to: 7, total: 0, count: 0 },
    { key: '8-30', label: '8 a 30 dias', from: 8, to: 30, total: 0, count: 0 },
    { key: '31-60', label: '31 a 60 dias', from: 31, to: 60, total: 0, count: 0 },
    { key: '60+', label: 'Mais de 60 dias', from: 61, to: Number.POSITIVE_INFINITY, total: 0, count: 0 },
  ];
  for (const entry of openEntries(entries, type)) {
    const late = daysBetween(entry.due_date, today);
    if (late < 1) continue;
    const bucket = buckets.find((item) => late >= item.from && late <= item.to);
    if (bucket) {
      bucket.total = cents(bucket.total + remainingOf(entry));
      bucket.count += 1;
    }
  }
  return buckets;
}

export type Urgency = {
  overdue: ExpenseEntry[];
  today: ExpenseEntry[];
  week: ExpenseEntry[];
  later: ExpenseEntry[];
};

/** Open items by urgency, soonest first: late, due today, the next 7 days, and after that (up to `horizon` days). */
export function groupByUrgency(entries: ExpenseEntry[], today: string, horizon = 30): Urgency {
  const open = entries.filter((entry) => remainingOf(entry) > 0).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description, 'pt-BR'));
  const result: Urgency = { overdue: [], today: [], week: [], later: [] };
  for (const entry of open) {
    const days = daysBetween(today, entry.due_date);
    if (days < 0) result.overdue.push(entry);
    else if (days === 0) result.today.push(entry);
    else if (days <= 7) result.week.push(entry);
    else if (days <= horizon) result.later.push(entry);
  }
  return result;
}

export type WeekForecast = {
  index: number;
  start: string;
  end: string;
  payable: number;
  receivable: number;
  net: number;
  /** The running result from today: late items first, then each week. */
  balance: number;
};

export type CashForecast = { overdue: { payable: number; receivable: number }; weeks: WeekForecast[]; totalNet: number };

/**
 * What the next weeks hold: to pay and to receive by week, and the running balance from today. What is already late
 * is counted up front (it is owed now), so the balance never hides a bill that was missed.
 */
export function cashForecast(entries: ExpenseEntry[], today: string, weeks = 8): CashForecast {
  const overduePayable = sumRemaining(openEntries(entries, 'payable').filter((entry) => entry.due_date < today));
  const overdueReceivable = sumRemaining(openEntries(entries, 'receivable').filter((entry) => entry.due_date < today));
  let balance = cents(overdueReceivable - overduePayable);

  const result: WeekForecast[] = Array.from({ length: weeks }, (_, index) => {
    const start = addDays(today, index * 7);
    const end = addDays(start, 6);
    const within = (entry: ExpenseEntry) => entry.due_date >= start && entry.due_date <= end;
    const payable = sumRemaining(openEntries(entries, 'payable').filter(within));
    const receivable = sumRemaining(openEntries(entries, 'receivable').filter(within));
    balance = cents(balance + receivable - payable);
    return { index, start, end, payable, receivable, net: cents(receivable - payable), balance };
  });

  return { overdue: { payable: overduePayable, receivable: overdueReceivable }, weeks: result, totalNet: balance };
}

/** Open amount (to pay or to receive) due from `today` through the next `days` days, counting what is late as well. */
export function openWithin(entries: ExpenseEntry[], type: EntryType, today: string, days: number) {
  const last = addDays(today, days);
  const matching = openEntries(entries, type).filter((entry) => entry.due_date <= last);
  return { total: sumRemaining(matching), count: matching.length };
}

/** Cash that actually left (or came in) in a month, from the payments themselves. */
export function paidInMonth(entries: ExpenseEntry[], type: EntryType, month: string) {
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== type) continue;
    for (const payment of entry.payments) if (payment.paid_at.slice(0, 7) === month) total += payment.amount;
  }
  return cents(total);
}

export type CategoryTotal = { category: string; total: number; fixed: number; variable: number; count: number };

/** What was booked to a month (by competence), by category: the base of the budget and of "where the money goes". */
export function spendingByCategory(entries: ExpenseEntry[], month: string): CategoryTotal[] {
  const groups = new Map<string, CategoryTotal>();
  for (const entry of entries) {
    if (entry.type !== 'payable' || entry.competence_month !== month) continue;
    const row = groups.get(entry.category) ?? { category: entry.category, total: 0, fixed: 0, variable: 0, count: 0 };
    row.total = cents(row.total + entry.amount);
    row[entry.nature === 'fixed' ? 'fixed' : 'variable'] = cents(row[entry.nature === 'fixed' ? 'fixed' : 'variable'] + entry.amount);
    row.count += 1;
    groups.set(entry.category, row);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, 'pt-BR'));
}

export type BudgetStatus = 'none' | 'ok' | 'warning' | 'over';
export type BudgetRow = { category: string; budget: number; spent: number; remaining: number; share: number; status: BudgetStatus };

/** Each category's limit against what was booked: warning from 80%, over from 100%. */
export function budgetProgress(budgets: Array<{ category: string; amount: number }>, spending: CategoryTotal[]): BudgetRow[] {
  const limits = new Map(budgets.map((item) => [item.category, cents(item.amount)]));
  const spent = new Map(spending.map((item) => [item.category, item.total]));
  const categories = new Set([...limits.keys(), ...spent.keys()]);

  return [...categories]
    .map((category): BudgetRow => {
      const budget = limits.get(category) ?? 0;
      const total = spent.get(category) ?? 0;
      const share = budget > 0 ? total / budget : 0;
      return {
        category,
        budget,
        spent: total,
        remaining: cents(budget - total),
        share,
        status: budget <= 0 ? 'none' : share >= 1 ? 'over' : share >= 0.8 ? 'warning' : 'ok',
      };
    })
    .sort((a, b) => Number(b.budget > 0) - Number(a.budget > 0) || b.share - a.share || b.spent - a.spent || a.category.localeCompare(b.category, 'pt-BR'));
}

export type CalendarDay = { date: string; inMonth: boolean; isToday: boolean; entries: ExpenseEntry[]; payable: number; receivable: number };

/** Six-week grid (Sunday first) of a month with each day's entries, by due date. */
export function calendarMonth(entries: ExpenseEntry[], month: string, today: string): CalendarDay[] {
  const first = `${month}-01`;
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -weekday);
  const byDate = new Map<string, ExpenseEntry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.due_date) ?? [];
    list.push(entry);
    byDate.set(entry.due_date, list);
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const day = (byDate.get(date) ?? []).sort((a, b) => a.type.localeCompare(b.type) || b.amount - a.amount);
    return {
      date,
      inMonth: date.slice(0, 7) === month,
      isToday: date === today,
      entries: day,
      payable: cents(day.filter((entry) => entry.type === 'payable').reduce((total, entry) => total + entry.amount, 0)),
      receivable: cents(day.filter((entry) => entry.type === 'receivable').reduce((total, entry) => total + entry.amount, 0)),
    };
  });
}

// ------------------------------------------------------------------------------------------------ creating

export function splitInstallmentAmounts(total: number, count: number) {
  const totalCents = Math.round(total * 100);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

export type EntryInput = {
  type: EntryType;
  description: string;
  category: string;
  supplier: string | null;
  amount: number;
  due_date: string;
  competence_month: string;
  payment_method: string | null;
  payment_code: string | null;
  nature: EntryNature;
  notes: string | null;
  /** single | installments (the total split in N) | recurring (the same amount every month) */
  repeat: 'single' | 'installments' | 'recurring';
  repeat_count: number;
  /** Mark a single bill as already paid, on this date. */
  paid_at: string | null;
};

const clean = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Reads and checks what the form sends. Returns the first problem as a message for the person. */
export function parseEntryInput(payload: Record<string, unknown>): { entry: EntryInput } | { error: string } {
  const type = payload.type;
  if (type !== 'payable' && type !== 'receivable') return { error: 'Escolha se a conta é a pagar ou a receber.' };

  const description = clean(payload.description, 160);
  if (!description) return { error: 'Informe a descrição da conta.' };

  const amount = cents(payload.amount);
  if (!(amount > 0)) return { error: 'Informe um valor maior que zero.' };
  if (amount >= 1e10) return { error: 'O valor é grande demais.' };

  const dueDate = String(payload.due_date ?? '').trim();
  if (!isDateKey(dueDate)) return { error: 'Informe uma data de vencimento válida.' };

  const competence = String(payload.competence_month ?? '').trim() || dueDate.slice(0, 7);
  if (!isMonthKey(competence)) return { error: 'A competência precisa ser um mês válido (AAAA-MM).' };

  const paidAt = String(payload.paid_at ?? '').trim();
  if (paidAt && !isDateKey(paidAt)) return { error: 'Informe uma data de pagamento válida.' };

  const repeat = payload.repeat === 'installments' || payload.repeat === 'recurring' ? payload.repeat : 'single';
  const rawCount = Number(payload.repeat_count);
  const count = repeat === 'single' ? 1 : Number.isInteger(rawCount) ? Math.min(120, Math.max(2, rawCount)) : 2;
  if (repeat !== 'single' && !Number.isInteger(rawCount)) return { error: 'Informe em quantas vezes a conta se repete.' };

  const method = clean(payload.payment_method, 20);
  return {
    entry: {
      type,
      description,
      category: clean(payload.category, 60) || 'Geral',
      supplier: clean(payload.supplier, 120) || null,
      amount,
      due_date: dueDate,
      competence_month: competence,
      payment_method: PAYMENT_METHODS.some((item) => item.value === method) ? method : null,
      payment_code: clean(payload.payment_code, 200) || null,
      nature: payload.nature === 'fixed' || (payload.nature !== 'variable' && repeat === 'recurring') ? 'fixed' : 'variable',
      notes: clean(payload.notes, 1000) || null,
      repeat,
      repeat_count: count,
      paid_at: repeat === 'single' && paidAt ? paidAt : null,
    },
  };
}

export type NewEntryRow = Omit<ExpenseEntry, 'id' | 'payments' | 'paid_amount' | 'status' | 'paid_at'> & { due_date: string };

/** The rows one form creates: one bill, N installments (the total split), or N monthly repetitions. */
export function buildEntryRows(input: EntryInput): NewEntryRow[] {
  const count = input.repeat === 'single' ? 1 : input.repeat_count;
  const amounts = input.repeat === 'installments' ? splitInstallmentAmounts(input.amount, count) : Array.from({ length: count }, () => input.amount);

  return Array.from({ length: count }, (_, index) => {
    const due = addMonths(input.due_date, index);
    return {
      type: input.type,
      description: input.description,
      category: input.category,
      supplier: input.supplier,
      amount: amounts[index],
      due_date: due,
      // The first one keeps the competence the person chose; the next ones follow their own due date.
      competence_month: index === 0 ? input.competence_month : due.slice(0, 7),
      payment_method: input.payment_method,
      payment_code: index === 0 ? input.payment_code : null,
      nature: input.nature,
      series_id: null,
      installment_number: index + 1,
      installment_total: count,
      is_recurring: input.repeat === 'recurring',
      notes: input.notes,
    };
  });
}

// ------------------------------------------------------------------------------------------------ list filters

export type AccountFilters = {
  query: string;
  type: EntryType | 'all';
  state: 'all' | 'open' | 'overdue' | 'paid';
  category: string;
  /** null = every month */
  month: string | null;
};

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterEntries(entries: ExpenseEntry[], filters: AccountFilters, today: string) {
  const query = fold(filters.query.trim());
  return entries
    .filter((entry) => {
      if (filters.type !== 'all' && entry.type !== filters.type) return false;
      if (filters.category !== 'all' && entry.category !== filters.category) return false;
      if (filters.month && entry.due_date.slice(0, 7) !== filters.month) return false;
      const state = entryState(entry, today);
      if (filters.state === 'paid' && state !== 'paid') return false;
      if (filters.state === 'open' && state === 'paid') return false;
      if (filters.state === 'overdue' && state !== 'overdue') return false;
      if (query && !fold(`${entry.description} ${entry.supplier ?? ''} ${entry.category} ${entry.notes ?? ''}`).includes(query)) return false;
      return true;
    })
    .sort((a, b) => {
      // Open first (soonest due), then the paid ones (latest first).
      const aPaid = remainingOf(a) <= 0;
      const bPaid = remainingOf(b) <= 0;
      if (aPaid !== bPaid) return aPaid ? 1 : -1;
      return aPaid ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date) || a.description.localeCompare(b.description, 'pt-BR');
    });
}
