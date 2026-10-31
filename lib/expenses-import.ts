// Reading the spreadsheet of bills: the headers a person may use (with or without accents, in capitals or not), dates as
// 2026-11-10 or 10/11/2026 (or a real date cell), amounts as 1500, 1.500,50 or "R$ 1.500,50". Pure, so it is tested.

export type ImportRow = {
  line: number;
  values: Record<string, unknown>;
  /** What is wrong with this row, in words for the person (null = it will be imported). */
  problem: string | null;
};

const fold = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const HEADERS: Record<string, string> = {
  tipo: 'type',
  descricao: 'description',
  conta: 'description',
  fornecedor: 'supplier',
  cliente: 'supplier',
  'fornecedor cliente': 'supplier',
  categoria: 'category',
  valor: 'amount',
  vencimento: 'due_date',
  'data de vencimento': 'due_date',
  competencia: 'competence_month',
  status: 'status',
  situacao: 'status',
  'valor pago': 'paid_amount',
  'data da baixa': 'paid_at',
  'data do pagamento': 'paid_at',
  'forma de pagamento': 'payment_method',
  'codigo de barras': 'payment_code',
  observacoes: 'notes',
  observacao: 'notes',
};

const METHODS: Record<string, string> = {
  pix: 'pix',
  boleto: 'boleto',
  transferencia: 'transfer',
  ted: 'transfer',
  doc: 'transfer',
  cartao: 'card',
  'cartao de credito': 'card',
  debito: 'debit',
  'debito automatico': 'debit',
  dinheiro: 'cash',
  outro: 'other',
};

/** "10/11/2026", "2026-11-10", "2026-11-10T00:00:00" or a Date to "2026-11-10"; anything else stays as typed. */
export function normalizeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // A date cell arrives at local midnight: read it in local time, not in UTC.
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  return text;
}

/** "1500", "1.500,50", "R$ 1.500,50" or a number to a number; NaN when it is not an amount. */
export function normalizeAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  let text = String(value ?? '').replace(/R\$|\s/g, '');
  if (!text) return Number.NaN;
  text = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text;
  return Number(text);
}

function normalizeMonth(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  const iso = text.match(/^(\d{4})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`;
  const br = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[2]}-${br[1].padStart(2, '0')}`;
  return text;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Turns the rows read from a sheet (header → cell) into the values the import route takes, flagging what is wrong. */
export function parseImportRows(rows: Array<Record<string, unknown>>): ImportRow[] {
  return rows
    .map((raw, index): ImportRow | null => {
      const values: Record<string, unknown> = {};
      for (const [header, cell] of Object.entries(raw)) {
        const key = HEADERS[fold(header)];
        if (key) values[key] = cell;
      }
      // An empty row (or the example row left in the template) is not a bill.
      const filled = Object.values(values).some((cell) => String(cell ?? '').trim() !== '');
      if (!filled || fold(values.notes).startsWith('exemplo')) return null;

      const type = fold(values.type);
      values.type = ['a pagar', 'pagar', 'despesa', 'saida', 'payable'].includes(type) ? 'payable' : ['a receber', 'receber', 'receita', 'entrada', 'receivable'].includes(type) ? 'receivable' : String(values.type ?? '');
      values.due_date = normalizeDate(values.due_date);
      values.competence_month = normalizeMonth(values.competence_month, String(values.due_date).slice(0, 7));
      values.amount = normalizeAmount(values.amount);
      if (values.paid_amount !== undefined && String(values.paid_amount).trim() !== '') values.paid_amount = normalizeAmount(values.paid_amount);
      else delete values.paid_amount;
      if (values.paid_at !== undefined) values.paid_at = normalizeDate(values.paid_at);
      values.payment_method = METHODS[fold(values.payment_method)] ?? '';

      let problem: string | null = null;
      if (values.type !== 'payable' && values.type !== 'receivable') problem = 'Tipo inválido (use "A pagar" ou "A receber").';
      else if (!String(values.description ?? '').trim()) problem = 'Falta a descrição.';
      else if (!(Number(values.amount) > 0)) problem = 'O valor precisa ser maior que zero.';
      else if (!isDate(String(values.due_date))) problem = 'Vencimento inválido (use 10/11/2026 ou 2026-11-10).';
      else if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(values.competence_month))) problem = 'Competência inválida (use 11/2026 ou 2026-11).';
      else if (values.paid_at && !isDate(String(values.paid_at))) problem = 'Data do pagamento inválida.';

      return { line: index + 2, values, problem };
    })
    .filter((row): row is ImportRow => row !== null);
}
