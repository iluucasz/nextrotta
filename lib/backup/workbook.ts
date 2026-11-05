import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';
import { organizationPublicUrl } from '../tenant-host';
import { BACKUP_KIND_LABELS, type BackupFile, type BackupKind } from './tables';

// The backup as a spreadsheet: one "Resumo" tab (index with links) and one tab per subject, written as a stream so a company
// with years of records does not need the whole workbook in memory. Everything is meant to be read by a person: names
// instead of internal ids, real dates, money and hours with their formats, the status in words, archived records marked.

const TZ = 'America/Sao_Paulo';
/** Excel allows 1.048.576 rows per tab; a table bigger than this continues on "(2)". */
export const MAX_ROWS_PER_SHEET = 1_000_000;

type Row = Record<string, unknown>;
type Kind = 'text' | 'date' | 'datetime' | 'time' | 'month' | 'money' | 'int' | 'num' | 'hours' | 'percent' | 'bool' | 'json';
type Lookup = (id: unknown) => string;

type Context = {
  technician: Lookup;
  part: Lookup;
  user: Lookup;
  entry: Lookup;
  sale: Lookup;
  inventory: Lookup;
  transfer: Lookup;
  debt: Lookup;
  conversation: Lookup;
};

type Col = {
  header: string;
  kind?: Kind;
  /** The key in the row, or a function when the cell is worked out (a name looked up, two fields joined). */
  key?: string;
  get?: (row: Row, context: Context) => unknown;
  /** Words for a stored value ("closed" -> "Fechada"); anything else is shown as stored. */
  words?: Record<string, string>;
  width?: number;
};

type Group = 'operation' | 'finance' | 'parts' | 'company' | 'integrations' | 'plan' | 'system';

type Spec = {
  table: string;
  sheet: string;
  group: Group;
  about: string;
  columns?: Col[];
  /** Newest first by this key (a date or timestamp column). */
  newestBy?: string;
  /** A two-column "setting / value" tab instead of a table (a table with one row). */
  settings?: boolean;
  /** Not a table: a notice that the files live in the system, with links to where to see them. */
  files?: boolean;
};

const GROUPS: Record<Group, { label: string; color: string }> = {
  operation: { label: 'Operação', color: 'FF6D4AFF' },
  finance: { label: 'Financeiro', color: 'FF1F9D74' },
  parts: { label: 'Venda de Peças', color: 'FFF59E0B' },
  company: { label: 'Empresa', color: 'FF0EA5E9' },
  integrations: { label: 'Integrações', color: 'FF64748B' },
  plan: { label: 'Plano e IA', color: 'FFEC4899' },
  system: { label: 'Sistema', color: 'FF94A3B8' },
};

const ROLES = { admin: 'Administrador', technician: 'Técnico', platform_owner: 'Dono da plataforma' };
const ACTIVE = { active: 'Ativo', inactive: 'Inativo', suspended: 'Suspenso' };
const PAY_METHODS = { pix: 'Pix', card_link: 'Link de cartão', card_present: 'Cartão na maquininha', cash: 'Dinheiro' };

const tech = (header = 'Técnico'): Col => ({ header, get: (row, context) => context.technician(row.technician_id), width: 30 });
const created: Col = { header: 'Cadastrado em', key: 'created_at', kind: 'datetime' };
const updated: Col = { header: 'Atualizado em', key: 'updated_at', kind: 'datetime' };

// ---------------------------------------------------------------------------------------------------------------- the tabs

export const SPECS: Spec[] = [
  // ---- operation
  {
    table: 'technicians', sheet: 'Técnicos', group: 'operation', about: 'Cadastro dos técnicos, com os valores de pagamento de cada um.',
    columns: [
      { header: 'Nome', key: 'name', width: 34 }, { header: 'QRA', key: 'qra' }, { header: 'Situação', key: 'status', words: ACTIVE },
      { header: 'E-mail', key: 'email', width: 32 }, { header: 'Telefone', key: 'phone' },
      { header: 'Comissão (%)', key: 'commission_percentage', kind: 'percent' }, { header: 'Valor da comissão', key: 'commission_rate', kind: 'money' },
      { header: 'Salário base', key: 'base_salary', kind: 'money' }, { header: 'VA', key: 'va_allowance', kind: 'money' }, { header: 'VR', key: 'vr_allowance', kind: 'money' },
      { header: 'Nome no Porto', key: 'porto_name_hint', width: 30 }, created,
    ],
  },
  {
    table: 'services', sheet: 'Serviços (OS)', group: 'operation', about: 'Todas as ordens de serviço, da mais recente para a mais antiga.', newestBy: 'date_performed',
    columns: [
      { header: 'Data', key: 'date_performed', kind: 'date' }, { header: 'Hora', key: 'time_performed', kind: 'time' }, { header: 'Código da OS', key: 'order_code', width: 18 },
      tech(), { header: 'Tipo de serviço', key: 'service_type', width: 46 }, { header: 'Valor', key: 'value', kind: 'money' },
      { header: 'Competência', key: 'competence_month', kind: 'month' }, { header: 'Quinzena', key: 'fortnight_period' }, { header: 'Descrição', key: 'description', width: 50 }, created,
    ],
  },
  {
    table: 'work_hours', sheet: 'Horas trabalhadas', group: 'operation', about: 'Horas de cada dia por técnico (importadas do Porto ou lançadas à mão).', newestBy: 'date',
    columns: [
      { header: 'Data', key: 'date', kind: 'date' }, tech(), { header: 'Entrada', key: 'start_time', kind: 'time' }, { header: 'Saída', key: 'end_time', kind: 'time' },
      { header: 'Horas trabalhadas', key: 'hours_worked', kind: 'hours' }, { header: 'Semana', key: 'week_number', kind: 'int' }, { header: 'Mês', key: 'month', kind: 'int' }, { header: 'Ano', key: 'year', kind: 'int' },
      { header: 'Origem', key: 'source', words: { porto: 'Importado do Porto', manual: 'Lançado à mão' } }, created,
    ],
  },
  {
    table: 'schedule', sheet: 'Escala', group: 'operation', about: 'A escala de cada dia por técnico.', newestBy: 'date',
    columns: [
      { header: 'Data', key: 'date', kind: 'date' }, tech(), { header: 'Início', key: 'start_time', kind: 'time' }, { header: 'Fim', key: 'end_time', kind: 'time' },
      { header: 'Situação', key: 'status', words: { scheduled: 'Escalado', completed: 'Concluído', cancelled: 'Cancelado' } }, { header: 'Observações', key: 'notes', width: 40 }, created,
    ],
  },
  {
    table: 'payroll', sheet: 'Folhas', group: 'operation', about: 'A folha de cada técnico por mês: o que entra, o que sai e o líquido.', newestBy: 'competence_month',
    columns: [
      { header: 'Competência', key: 'competence_month', kind: 'month' }, tech(), { header: 'Situação', key: 'status', words: { draft: 'Em aberto', closed: 'Fechada' } },
      { header: 'Total em serviços', key: 'total_services_value', kind: 'money' }, { header: 'Comissão', key: 'commission_value', kind: 'money' }, { header: 'Salário base', key: 'base_salary', kind: 'money' },
      { header: 'Desconto VA', key: 'va_deduction', kind: 'money' }, { header: 'Desconto VR', key: 'vr_deduction', kind: 'money' }, { header: 'Descontos', key: 'discounts_total', kind: 'money' },
      { header: 'Adiantamentos', key: 'advances_total', kind: 'money' }, { header: 'Horas extras', key: 'extra_hours_value', kind: 'money' }, { header: 'Prêmio', key: 'extraordinary_award_value', kind: 'money' },
      { header: 'Banco de horas', key: 'hour_bank_balance', kind: 'hours' }, { header: 'Líquido a pagar', key: 'net_total', kind: 'money' }, updated,
    ],
  },
  {
    table: 'discounts', sheet: 'Descontos e adiantamentos', group: 'operation', about: 'Descontos e adiantamentos lançados para os técnicos.', newestBy: 'created_at',
    columns: [{ header: 'Competência', key: 'competence_month', kind: 'month' }, tech(), { header: 'Tipo', key: 'type', words: { discount: 'Desconto', advance: 'Adiantamento' } }, { header: 'Valor', key: 'amount', kind: 'money' }, { header: 'Motivo', key: 'reason', width: 44 }, created],
  },
  // ---- finance
  {
    table: 'financial_entries', sheet: 'Contas', group: 'finance', about: 'Contas a pagar e a receber (despesas).', newestBy: 'due_date',
    columns: [
      { header: 'Vencimento', key: 'due_date', kind: 'date' }, { header: 'Tipo', key: 'type', words: { payable: 'A pagar', receivable: 'A receber' } }, { header: 'Descrição', key: 'description', width: 44 },
      { header: 'Categoria', key: 'category', width: 22 }, { header: 'Fornecedor / cliente', key: 'supplier', width: 28 }, { header: 'Valor', key: 'amount', kind: 'money' },
      { header: 'Valor pago', key: 'paid_amount', kind: 'money' }, { header: 'Pago em', key: 'paid_at', kind: 'date' }, { header: 'Situação', key: 'status', words: { pending: 'Pendente', paid: 'Paga', partial: 'Paga em parte', canceled: 'Cancelada' } },
      { header: 'Forma de pagamento', key: 'payment_method' }, { header: 'Código de pagamento', key: 'payment_code', width: 30 }, { header: 'Natureza', key: 'nature' }, { header: 'Competência', key: 'competence_month', kind: 'month' },
      { header: 'Parcela', get: (row) => (row.installment_total ? `${row.installment_number ?? 1}/${row.installment_total}` : '') }, { header: 'Recorrente', key: 'is_recurring', kind: 'bool' }, { header: 'Observações', key: 'notes', width: 40 },
    ],
  },
  {
    table: 'financial_payments', sheet: 'Pagamentos de contas', group: 'finance', about: 'Cada pagamento feito em uma conta.', newestBy: 'paid_at',
    columns: [{ header: 'Pago em', key: 'paid_at', kind: 'date' }, { header: 'Conta', get: (row, context) => context.entry(row.entry_id), width: 44 }, { header: 'Valor', key: 'amount', kind: 'money' }, { header: 'Forma', key: 'method' }, { header: 'Observação', key: 'note', width: 40 }, created],
  },
  {
    table: 'finance_budgets', sheet: 'Orçamentos', group: 'finance', about: 'O orçamento mensal de cada categoria de despesa.',
    columns: [{ header: 'Categoria', key: 'category', width: 30 }, { header: 'Orçamento mensal', key: 'amount', kind: 'money' }, updated],
  },
  // ---- parts
  {
    table: 'parts', sheet: 'Peças', group: 'parts', about: 'O catálogo de peças com custo e preços.',
    columns: [
      { header: 'Nome', key: 'name', width: 40 }, { header: 'Código de barras', key: 'barcode', width: 18 }, { header: 'SKU', key: 'sku' }, { header: 'Categoria', key: 'category' }, { header: 'Marca', key: 'brand' }, { header: 'Unidade', key: 'unit' },
      { header: 'Custo', key: 'cost_price', kind: 'money' }, { header: 'Preço do técnico', key: 'technician_price', kind: 'money' }, { header: 'Preço sugerido', key: 'suggested_price', kind: 'money' }, { header: 'Estoque mínimo', key: 'min_stock', kind: 'int' },
      { header: 'Ativa', key: 'active', kind: 'bool' }, { header: 'Descrição', key: 'description', width: 40 }, created,
    ],
  },
  {
    table: 'part_movements', sheet: 'Movimentações de peças', group: 'parts', about: 'Todo movimento de estoque (o saldo é a soma): compras, remessas, vendas, ajustes.', newestBy: 'created_at',
    columns: [
      { header: 'Quando', key: 'created_at', kind: 'datetime' }, { header: 'Peça', get: (row, context) => context.part(row.part_id), width: 36 },
      { header: 'Onde', get: (row, context) => (row.technician_id ? context.technician(row.technician_id) : 'Estoque central'), width: 28 }, { header: 'Quantidade', key: 'quantity', kind: 'int' },
      { header: 'Tipo', key: 'kind', words: { purchase: 'Compra', adjustment: 'Ajuste', transfer: 'Remessa ou devolução', sale: 'Venda', sale_canceled: 'Venda cancelada', inventory_shortage: 'Falta no inventário', inventory_surplus: 'Sobra no inventário' } },
      { header: 'Custo unitário', key: 'unit_cost', kind: 'money' }, { header: 'Preço do técnico', key: 'unit_technician_price', kind: 'money' }, { header: 'Observação', key: 'note', width: 40 },
    ],
  },
  {
    table: 'part_sales', sheet: 'Vendas de peças', group: 'parts', about: 'As vendas de peças feitas pelos técnicos.', newestBy: 'created_at',
    columns: [
      { header: 'Nº', key: 'number', kind: 'int' }, { header: 'Data', key: 'created_at', kind: 'datetime' }, tech(), { header: 'Cliente', key: 'customer_name', width: 28 }, { header: 'Telefone do cliente', key: 'customer_phone' }, { header: 'OS', key: 'order_code', width: 16 },
      { header: 'Situação', key: 'status', words: { awaiting_payment: 'Aguardando pagamento', paid: 'Paga', canceled: 'Cancelada' } }, { header: 'Forma de pagamento', key: 'payment_method', words: PAY_METHODS },
      { header: 'Total da venda', key: 'total_amount', kind: 'money' }, { header: 'Devido pelo técnico', key: 'total_technician_price', kind: 'money' }, { header: 'Custo', key: 'total_cost', kind: 'money' },
      { header: 'Pago em', key: 'paid_at', kind: 'datetime' }, { header: 'Cancelada em', key: 'canceled_at', kind: 'datetime' }, { header: 'Motivo do cancelamento', key: 'cancel_reason', width: 36 }, { header: 'Observação', key: 'note', width: 36 },
    ],
  },
  {
    table: 'part_sale_items', sheet: 'Itens das vendas', group: 'parts', about: 'As peças de cada venda.',
    columns: [{ header: 'Venda', get: (row, context) => context.sale(row.sale_id) }, { header: 'Peça', key: 'part_name', width: 40 }, { header: 'Quantidade', key: 'quantity', kind: 'int' }, { header: 'Preço de venda', key: 'unit_price', kind: 'money' }, { header: 'Preço do técnico', key: 'unit_technician_price', kind: 'money' }, { header: 'Custo', key: 'unit_cost', kind: 'money' }],
  },
  {
    table: 'part_transfers', sheet: 'Remessas de peças', group: 'parts', about: 'Remessas de peças aos técnicos e devoluções.', newestBy: 'created_at',
    columns: [{ header: 'Nº', key: 'number', kind: 'int' }, { header: 'Data', key: 'created_at', kind: 'datetime' }, tech(), { header: 'Sentido', key: 'direction' }, { header: 'Valor (preço do técnico)', key: 'total_technician_price', kind: 'money' }, { header: 'Custo', key: 'total_cost', kind: 'money' }, { header: 'Confirmada pelo técnico em', key: 'acknowledged_at', kind: 'datetime' }, { header: 'Observação', key: 'note', width: 36 }],
  },
  {
    table: 'part_inventories', sheet: 'Inventários', group: 'parts', about: 'As contagens de estoque dos técnicos.', newestBy: 'started_at',
    columns: [{ header: 'Nº', key: 'number', kind: 'int' }, tech(), { header: 'Situação', key: 'status' }, { header: 'Iniciado em', key: 'started_at', kind: 'datetime' }, { header: 'Fechado em', key: 'closed_at', kind: 'datetime' }, { header: 'Valor das faltas', key: 'shortage_value', kind: 'money' }, { header: 'Unidades a mais', key: 'surplus_units', kind: 'int' }, { header: 'Observação', key: 'note', width: 36 }],
  },
  {
    table: 'part_inventory_items', sheet: 'Itens de inventário', group: 'parts', about: 'O que foi contado em cada inventário.',
    columns: [{ header: 'Inventário', get: (row, context) => context.inventory(row.inventory_id) }, { header: 'Peça', get: (row, context) => context.part(row.part_id), width: 40 }, { header: 'Esperado', key: 'expected', kind: 'int' }, { header: 'Contado', key: 'counted', kind: 'int' }, { header: 'Preço do técnico', key: 'unit_technician_price', kind: 'money' }, { header: 'Resolução', key: 'resolution' }],
  },
  {
    table: 'part_debts', sheet: 'Débitos de peças', group: 'parts', about: 'Débitos parcelados dos técnicos (faltas de inventário).', newestBy: 'created_at',
    columns: [{ header: 'Nº', key: 'number', kind: 'int' }, tech(), { header: 'Descrição', key: 'description', width: 44 }, { header: 'Valor total', key: 'total_amount', kind: 'money' }, { header: 'Parcelas', key: 'installments', kind: 'int' }, { header: 'Primeiro vencimento', key: 'first_due_month', kind: 'month' }, { header: 'Situação', key: 'status' }, created],
  },
  {
    table: 'part_account_entries', sheet: 'Acerto de peças', group: 'parts', about: 'A conta corrente de peças de cada técnico: o que deve e o que pagou.', newestBy: 'created_at',
    columns: [{ header: 'Mês', key: 'due_month', kind: 'month' }, tech(), { header: 'Tipo', key: 'kind' }, { header: 'Valor', key: 'amount', kind: 'money' }, { header: 'Descrição', key: 'description', width: 44 }, { header: 'Forma de pagamento', key: 'payment_method', words: PAY_METHODS }, created],
  },
  // ---- company
  { table: 'organization_settings', sheet: 'Configurações', group: 'company', about: 'As configurações da empresa (comissão, jornada, valores padrão, horários do Porto).', settings: true },
  { table: 'library_documents', sheet: 'Documentos e imagens', group: 'company', about: 'Os documentos da biblioteca e as fotos das peças ficam no sistema (são privados e não abrem fora dele).', files: true },
  { table: 'parts_settings', sheet: 'Configurações de peças', group: 'company', about: 'As configurações de Venda de Peças.', settings: true },
  {
    table: 'users', sheet: 'Usuários', group: 'company', about: 'Quem entra no sistema (as senhas não entram no backup).',
    columns: [{ header: 'Nome', key: 'name', width: 32 }, { header: 'E-mail', key: 'email', width: 34 }, { header: 'Papel', key: 'role', words: ROLES }, { header: 'Situação', key: 'status', words: ACTIVE }, { header: 'Último acesso', key: 'last_login_at', kind: 'datetime' }, created],
  },
  // ---- integrations
  {
    table: 'whatsapp_messages', sheet: 'Mensagens de WhatsApp', group: 'integrations', about: 'As mensagens que o sistema enviou pelo WhatsApp da empresa.', newestBy: 'created_at',
    columns: [{ header: 'Quando', key: 'created_at', kind: 'datetime' }, { header: 'Para', key: 'technician_name', width: 28 }, { header: 'Telefone', key: 'phone' }, { header: 'Tipo', key: 'type' }, { header: 'Situação', key: 'status' }, { header: 'Mensagem', key: 'message', width: 70 }, { header: 'Erro', key: 'error', width: 36 }],
  },
  // ---- plan
  {
    table: 'billing_charges', sheet: 'Cobranças', group: 'plan', about: 'As cobranças da assinatura e das compras de créditos.', newestBy: 'due_date',
    columns: [{ header: 'Vencimento', key: 'due_date', kind: 'date' }, { header: 'Descrição', key: 'description', width: 46 }, { header: 'Valor', key: 'value', kind: 'money' }, { header: 'Situação', key: 'status', words: { PENDING: 'Pendente', RECEIVED: 'Paga', CONFIRMED: 'Paga', OVERDUE: 'Vencida', REFUNDED: 'Estornada' } }, { header: 'Forma', key: 'billing_type' }, { header: 'Paga em', key: 'paid_at', kind: 'datetime' }, { header: 'Link da cobrança', key: 'invoice_url', width: 50 }],
  },
  {
    table: 'ai_credit_ledger', sheet: 'Créditos de IA', group: 'plan', about: 'O extrato dos créditos do assistente de IA.', newestBy: 'created_at',
    columns: [{ header: 'Quando', key: 'created_at', kind: 'datetime' }, { header: 'Tipo', key: 'kind' }, { header: 'Créditos', key: 'quantity', kind: 'num' }, { header: 'Descrição', key: 'description', width: 50 }],
  },
  {
    table: 'ai_messages', sheet: 'Mensagens da IA', group: 'plan', about: 'As conversas com o assistente de IA.', newestBy: 'created_at',
    columns: [{ header: 'Quando', key: 'created_at', kind: 'datetime' }, { header: 'Conversa', get: (row, context) => context.conversation(row.conversation_id), width: 36 }, { header: 'Quem', key: 'role', words: { user: 'Você', assistant: 'Assistente' } }, { header: 'Texto', key: 'content', width: 90 }, { header: 'Créditos', key: 'credits', kind: 'num' }],
  },
  // ---- system
  {
    table: 'bug_reports', sheet: 'Chamados', group: 'system', about: 'Os chamados de suporte, bugs e sugestões abertos pela empresa.', newestBy: 'created_at',
    columns: [{ header: 'Nº', key: 'ticket_number', kind: 'int' }, { header: 'Abertura', key: 'created_at', kind: 'datetime' }, { header: 'Tipo', key: 'report_type', words: { support: 'Suporte', bug: 'Bug', suggestion: 'Sugestão' } }, { header: 'Assunto', key: 'title', width: 44 }, { header: 'Descrição', key: 'description', width: 70 }, { header: 'Situação', key: 'status' }, { header: 'Resolvido em', key: 'resolved_at', kind: 'datetime' }],
  },
];

/**
 * Tables that stay in the backup (they are restored from it) but are not worth a tab: the technical or internal records,
 * and the registers of files, which the "Documentos e imagens" tab covers.
 */
const NOT_IN_SPREADSHEET = new Set(['audit_events', 'notifications', 'mercadopago_accounts', 'porto_config', 'porto_sync_log', 'technician_visibility_settings', 'part_images']);

/** Tables with a tab of their own that no curated spec names: one generic tab each, so nothing is left out. */
const GENERIC: Record<string, { sheet: string; group: Group; about: string }> = {
  whatsapp_config: { sheet: 'Config. do WhatsApp', group: 'integrations', about: 'A configuração do WhatsApp da empresa.' },
  subscriptions: { sheet: 'Assinatura', group: 'plan', about: 'A assinatura da empresa: plano, valores, ciclo e limites.' },
  ai_conversations: { sheet: 'Conversas da IA', group: 'plan', about: 'As conversas com o assistente de IA.' },
  organization_features: { sheet: 'Recursos liberados', group: 'plan', about: 'Recursos extras liberados para a empresa.' },
  coupon_redemptions: { sheet: 'Cupons usados', group: 'plan', about: 'Cupons de desconto aplicados.' },
};

// ----------------------------------------------------------------------------------------------------------- the values

const HUMAN: Record<string, string> = {
  id: 'ID', created_at: 'Cadastrado em', updated_at: 'Atualizado em', deleted_at: 'Arquivado em', status: 'Situação', name: 'Nome', title: 'Título', description: 'Descrição', kind: 'Tipo', type: 'Tipo', note: 'Observação', notes: 'Observações',
  amount: 'Valor', value: 'Valor', price: 'Preço', cost: 'Custo', quantity: 'Quantidade', email: 'E-mail', phone: 'Telefone', message: 'Mensagem', error: 'Erro', enabled: 'Ativado', plan_id: 'Plano', cycle: 'Ciclo',
  base_price: 'Preço base', setup_fee: 'Implantação', grace_days: 'Dias de carência', next_due_date: 'Próximo vencimento', billing_day: 'Dia de vencimento', canceled_at: 'Cancelada em', discount_percent: 'Desconto (%)', discount_amount: 'Desconto (R$)',
  included_technicians: 'Técnicos incluídos', extra_technician_price: 'Preço do técnico extra', instance_name: 'Instância', connected_number: 'Número conectado', connected_name: 'Nome conectado', connection_state: 'Conexão', test_phone: 'Número de teste',
  automation_enabled: 'Automação ligada', dry_run_only: 'Só teste (não grava)', cpf: 'CPF', last_error: 'Último erro', scope: 'Escopo', settings: 'Configurações', severity: 'Importância', body: 'Texto', href: 'Endereço', granted_at: 'Liberado em', revoked_at: 'Revogado em',
  app_url: 'Endereço do app', job_runs: 'Últimas execuções', notifications: 'Notificações ligadas', live_mode: 'Modo real', expires_at: 'Expira em', modules: 'Módulos contratados', audience: 'Público', nickname: 'Apelido', mp_user_id: 'ID no Mercado Pago',
  public_key: 'Chave pública', terminal_id: 'Maquininha', connected_at: 'Conectado em', refreshed_at: 'Renovado em', disconnected_at: 'Desconectado em', limit_overrides: 'Limites próprios', setup_fee_status: 'Implantação',
  instance_created_at: 'Instância criada em', connection_checked_at: 'Conexão verificada em', instance_number: 'Número da instância', previous_discount_percent: 'Desconto anterior (%)', previous_discount_amount: 'Desconto anterior (R$)',
  feature_key: 'Recurso', url: 'Endereço', content_type: 'Tipo do arquivo', file_size: 'Tamanho (bytes)', applied_at: 'Aplicado em', ended_at: 'Terminou em', ends_on: 'Termina em', end_reason: 'Motivo do fim',
};

/** The settings read in words (organization_settings and parts_settings). */
const SETTING_LABELS: Record<string, string> = {
  commission_percentage: 'Comissão (%)', commission_mode: 'Como a comissão é calculada', commission_rate: 'Valor da comissão (por OS, hora ou dia)', commission_minimum: 'Comissão mínima do mês', commission_maximum: 'Comissão máxima do mês',
  base_salary: 'Salário base padrão', va_allowance: 'VA padrão', vr_allowance: 'VR padrão', monthly_hours: 'Jornada mensal (horas)', overtime_multiplier: 'Adicional de hora extra (vezes)', daily_break_minutes: 'Intervalo diário (minutos)',
  service_award_tiers: 'Faixas de prêmio por produção', default_shift_start: 'Início do turno padrão', default_shift_end: 'Fim do turno padrão', monthly_hours_warning_floor: 'Avisar horas do mês abaixo de',
  fortnight_split_day: 'Dia que divide a quinzena', charge_cancelled_service_planned: 'Cobrar serviço cancelado que estava planejado', porto_hours_import_time: 'Horário da importação de horas (Porto)', porto_schedule_import_time: 'Horário da importação da escala (Porto)',
  porto_reprocess_days: 'Dias anteriores reprocessados (Porto)', porto_max_shift_hours: 'Máximo de horas por turno (Porto)', porto_next_month_lookahead_days: 'Dias para buscar a escala do mês seguinte (Porto)', porto_full_day_off_percent: 'Folga inteira a partir de (% do turno)',
  porto_use_laudo_conclusion: 'Usar a assinatura do laudo como fim do dia (Porto)', porto_warning_enabled: 'Marcar advertência (Porto)', porto_warning_text: 'Texto da advertência (Porto)', porto_record_cancelled_days: 'Registrar dias só com serviço cancelado (Porto)',
  porto_alert_phone: 'WhatsApp para alertas do robô', finance_due_soon_days: 'Avisar contas que vencem em (dias)', finance_categories: 'Categorias de despesa', porto_laudo_grace_hours: 'Prazo do laudo (horas)',
  payment_methods: 'Formas de pagamento aceitas', receipt_footer: 'Rodapé do recibo', settlement_day: 'Dia do acerto', company_name: 'Nome da empresa nos termos', updated_at: 'Atualizado em',
};
const SETTING_WORDS: Record<string, Record<string, string>> = { commission_mode: { excess: 'Só o que passa do salário, VA e VR', percentage: 'Percentual sobre as OS', per_service: 'Valor por OS', per_hour: 'Valor por hora', per_day: 'Valor por dia', none: 'Sem comissão' } };

const USER_COLUMNS: Record<string, string> = {
  user_id: 'Pessoa', created_by: 'Cadastrado por', updated_by: 'Atualizado por', uploaded_by: 'Enviado por', started_by: 'Iniciado por', closed_by: 'Fechado por', acknowledged_by: 'Confirmado por', canceled_by: 'Cancelado por',
  actor_id: 'Quem', granted_by: 'Liberado por', revoked_by: 'Revogado por', applied_by: 'Aplicado por', restored_by: 'Restaurado por',
};

/** Internal ids of other systems or of the platform: they say nothing to the company. */
const SKIP_KEYS = new Set(['plan_id', 'coupon_id', 'charge_id', 'credit_package_id', 'message_id', 'conversation_id', 'asaas_customer_id', 'asaas_subscription_id', 'asaas_setup_payment_id', 'mp_order_id', 'mp_preference_id', 'impersonation_id', 'dedupe_key', 'screenshot', 'user_agent']);
/** Read first in a table without a curated tab, and last. */
const FIRST_KEYS = ['name', 'title', 'nickname', 'email', 'kind', 'type', 'scope', 'status'];
const LAST_KEYS = ['created_at', 'updated_at', 'granted_at', 'applied_at', 'connected_at'];

const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const zone = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** A timestamp as the wall clock of Brasília (Excel has no time zones, so it is stored as that local time). */
function brasiliaWallClock(iso: string): Date | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(zone.formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)));
}

const NUMBER_FORMATS: Partial<Record<Kind, string>> = {
  date: 'dd/mm/yyyy', datetime: 'dd/mm/yyyy hh:mm', time: 'hh:mm', month: 'mm/yyyy', money: '"R$" #,##0.00', int: '#,##0', num: '#,##0.00', hours: '0.00', percent: '0.##"%"',
};
const KIND_WIDTH: Partial<Record<Kind, number>> = { date: 13, datetime: 18, time: 9, month: 12, money: 16, int: 12, num: 12, hours: 11, percent: 13, bool: 10 };

type Cell = string | number | boolean | Date | null;

/** The value of one cell, ready for the spreadsheet. */
function cellValue(raw: unknown, kind: Kind, words?: Record<string, string>): Cell {
  if (raw === null || raw === undefined || raw === '') return null;
  switch (kind) {
    case 'date': {
      const text = String(raw);
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10))));
      return brasiliaWallClock(text) ? new Date(Date.UTC(...(wallDay(brasiliaWallClock(text)!)))) : text;
    }
    case 'datetime':
      return brasiliaWallClock(String(raw)) ?? String(raw);
    case 'time': {
      const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(raw));
      return match ? (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0)) / 86400 : String(raw);
    }
    case 'month': {
      const match = /^(\d{4})-(\d{2})/.exec(String(raw));
      return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : String(raw);
    }
    case 'money':
    case 'int':
    case 'num':
    case 'hours':
    case 'percent': {
      const number = Number(raw);
      return Number.isFinite(number) ? number : String(raw);
    }
    case 'bool':
      return raw === true || raw === 'true' ? 'Sim' : 'Não';
    case 'json':
      return clip(typeof raw === 'string' ? raw : JSON.stringify(raw));
    default: {
      const text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
      return clip(words?.[text] ?? text);
    }
  }
}

const wallDay = (date: Date): [number, number, number] => [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
const clip = (text: string) => text.replace(ILLEGAL, '').slice(0, 32000);

/** Guess how to show a column of a table that has no curated tab. */
function guessKind(key: string, sample: unknown): Kind {
  if (typeof sample === 'boolean') return 'bool';
  if (typeof sample === 'number') return /percent/.test(key) ? 'percent' : /price|amount|value|cost|total|fee|balance|salary|allowance|rate$|minimum|maximum/.test(key) ? 'money' : Number.isInteger(sample) ? 'int' : 'num';
  if (typeof sample === 'object' && sample !== null) return 'json';
  if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(sample)) return 'datetime';
    if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return 'date';
    if (/^\d{4}-\d{2}$/.test(sample)) return 'month';
  }
  return 'text';
}

const humanize = (key: string) => HUMAN[key] ?? key.replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

/** Columns for a table without a curated tab: what is in the data, named for a person, ids replaced by names. */
function genericColumns(rows: Row[]): Col[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, 200)) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
  const sample = (key: string) => rows.slice(0, 200).map((row) => row[key]).find((value) => value !== null && value !== undefined && value !== '');

  // The database hands the keys back shortest first; people expect the name first and the dates last.
  const rank = (key: string) => (FIRST_KEYS.includes(key) ? FIRST_KEYS.indexOf(key) - 100 : LAST_KEYS.includes(key) ? 100 + LAST_KEYS.indexOf(key) : 0);
  keys.sort((a, b) => rank(a) - rank(b));

  const columns: Col[] = [];
  for (const key of keys) {
    if (key === 'organization_id' || key === 'deleted_at' || key === 'deleted_by' || key === 'id' || key.endsWith('_enc') || SKIP_KEYS.has(key)) continue;
    if (USER_COLUMNS[key]) columns.push({ header: USER_COLUMNS[key], get: (row, context) => context.user(row[key]), width: 26 });
    else if (key === 'technician_id') columns.push({ header: 'Técnico', get: (row, context) => context.technician(row.technician_id), width: 30 });
    else if (key === 'part_id') columns.push({ header: 'Peça', get: (row, context) => context.part(row.part_id), width: 36 });
    else if (key === 'sale_id') columns.push({ header: 'Venda', get: (row, context) => context.sale(row.sale_id) });
    else if (key === 'debt_id') columns.push({ header: 'Débito', get: (row, context) => context.debt(row.debt_id) });
    else if (key === 'transfer_id') columns.push({ header: 'Remessa', get: (row, context) => context.transfer(row.transfer_id) });
    else if (key === 'inventory_id') columns.push({ header: 'Inventário', get: (row, context) => context.inventory(row.inventory_id) });
    else columns.push({ header: humanize(key), key, kind: guessKind(key, sample(key)) });
  }
  if (keys.includes('id')) columns.push({ header: 'ID', key: 'id', width: 38 });
  return columns;
}

// ------------------------------------------------------------------------------------------------------- the workbook

function lookups(file: BackupFile): Context {
  const index = (table: string, label: (row: Row) => string): Lookup => {
    const map = new Map<string, string>();
    for (const row of file.tables[table] ?? []) map.set(String(row.id), label(row));
    return (id) => (id === null || id === undefined ? '' : map.get(String(id)) ?? '(registro removido)');
  };
  return {
    technician: index('technicians', (row) => String(row.name ?? row.email ?? '')),
    part: index('parts', (row) => String(row.name ?? '')),
    user: index('users', (row) => String(row.name || row.email || '')),
    entry: index('financial_entries', (row) => String(row.description ?? '')),
    sale: index('part_sales', (row) => `Venda #${row.number}`),
    inventory: index('part_inventories', (row) => `Inventário #${row.number}`),
    transfer: index('part_transfers', (row) => `Remessa #${row.number}`),
    debt: index('part_debts', (row) => `Débito #${row.number}`),
    conversation: index('ai_conversations', (row) => String(row.title ?? 'Conversa')),
  };
}

type Plan = { spec: Spec; columns: Col[]; rows: Row[]; part: number; parts: number; name: string };

/** Sheet names: at most 31 characters, none of []:*?/\ and each one unique. */
function sheetName(wanted: string, taken: Set<string>) {
  const base = wanted.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31).trim();
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 3)} (${n})`;
  taken.add(name.toLowerCase());
  return name;
}

function newestFirst(rows: Row[], key: string) {
  return [...rows].sort((a, b) => String(b[key] ?? '').localeCompare(String(a[key] ?? '')));
}

/** Documents of the library plus photos of parts: what lives in the system and cannot be opened from a spreadsheet. */
function fileCount(file: BackupFile) {
  return (file.tables.library_documents ?? []).filter((row) => !row.deleted_at).length + (file.tables.part_images ?? []).filter((row) => !row.deleted_at).length;
}

function planSheets(file: BackupFile, maxRows: number): Plan[] {
  const taken = new Set<string>(['resumo']);
  const plans: Plan[] = [];
  const specs: Spec[] = [
    ...SPECS,
    ...Object.entries(GENERIC).map(([table, info]): Spec => ({ table, ...info })),
  ];
  const known = new Set(specs.map((spec) => spec.table));
  // A table that is in the backup but has no entry above still gets its own generic tab.
  for (const table of Object.keys(file.tables)) if (!known.has(table) && !NOT_IN_SPREADSHEET.has(table)) specs.push({ table, sheet: humanize(table), group: 'system', about: 'Dados desta parte do sistema.' });

  const order = Object.keys(GROUPS) as Group[];
  specs.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));

  for (const spec of specs) {
    let rows = file.tables[spec.table] ?? [];
    if (spec.files) {
      // One tab, only when there is something to find in the system; it holds the notice and the links, no rows.
      const name = fileCount(file) ? sheetName(spec.sheet, taken) : '';
      plans.push({ spec, columns: [], rows: [], part: 1, parts: 1, name });
      continue;
    }
    if (!rows.length) {
      plans.push({ spec, columns: [], rows: [], part: 1, parts: 1, name: '' });
      continue;
    }
    if (spec.newestBy) rows = newestFirst(rows, spec.newestBy);
    let columns: Col[];
    if (spec.settings) columns = [];
    else {
      columns = [...(spec.columns ?? genericColumns(rows))];
      if (rows.some((row) => row.deleted_at)) columns.push({ header: 'Arquivado em', key: 'deleted_at', kind: 'datetime' });
    }
    const parts = Math.max(1, Math.ceil(rows.length / maxRows));
    for (let part = 1; part <= parts; part += 1) {
      const slice = parts === 1 ? rows : rows.slice((part - 1) * maxRows, part * maxRows);
      plans.push({ spec, columns, rows: slice, part, parts, name: sheetName(part === 1 ? spec.sheet : `${spec.sheet} (${part})`, taken) });
    }
  }
  return plans;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF282638' } };
const BORDER_COLOR = 'FFE3E1EC';

const columnLetter = (index: number) => {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

/** The width of a column from its header and the first values. */
function widthOf(column: Col, shown: string[]) {
  if (column.width) return column.width;
  const kindWidth = column.kind ? KIND_WIDTH[column.kind] : undefined;
  const longest = Math.max(column.header.length * 1.15, ...shown.map((text) => text.length));
  return kindWidth ? Math.max(kindWidth, Math.ceil(column.header.length * 1.15) + 2) : Math.min(60, Math.max(12, Math.ceil(longest) + 2));
}

function valueOf(column: Col, row: Row, context: Context): Cell {
  const raw = column.get ? column.get(row, context) : row[column.key ?? ''];
  return cellValue(raw, column.kind ?? 'text', column.words);
}

const text = (value: Cell) => (value instanceof Date ? 'xx/xx/xxxx xx:xx' : value === null ? '' : String(value));

export type WorkbookInfo = { kind: BackupKind | 'current'; createdAt: string };

/** The whole backup as an .xlsx file. */
export async function buildBackupWorkbook(file: BackupFile, info: WorkbookInfo, options: { maxRowsPerSheet?: number } = {}): Promise<Buffer> {
  const context = lookups(file);
  const plans = planSheets(file, options.maxRowsPerSheet ?? MAX_ROWS_PER_SHEET);

  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: true });
  workbook.creator = 'NextRotta';
  workbook.company = file.organization.name;
  workbook.title = `Backup de ${file.organization.name}`;
  workbook.created = new Date(info.createdAt);

  writeSummary(workbook, file, info, plans);
  for (const plan of plans) if (plan.name) writeSheet(workbook, plan, context, file);

  await workbook.commit();
  await finished;
  return Buffer.concat(chunks);
}

function writeSummary(workbook: ExcelJS.stream.xlsx.WorkbookWriter, file: BackupFile, info: WorkbookInfo, plans: Plan[]) {
  const sheet = workbook.addWorksheet('Resumo', { properties: { tabColor: { argb: 'FF282638' } }, views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 22 }, { width: 34 }, { width: 70 }, { width: 14 }, { width: 14 }];

  const put = (values: Array<Cell | ExcelJS.CellHyperlinkValue>, style?: (row: ExcelJS.Row) => void) => {
    const row = sheet.addRow(values);
    style?.(row);
    row.commit();
    return row;
  };
  const label = (cell: ExcelJS.Cell) => { cell.font = { bold: true, color: { argb: 'FF6B6880' } }; };

  put(['Backup da empresa'], (row) => { row.height = 30; row.getCell(1).font = { size: 20, bold: true, color: { argb: 'FF282638' } }; });
  put([file.organization.name], (row) => { row.getCell(1).font = { size: 14, bold: true }; });
  put([]);
  const when = brasiliaWallClock(info.createdAt) ?? new Date();
  const kindLabel = info.kind === 'current' ? 'Estado atual (gerado na hora)' : BACKUP_KIND_LABELS[info.kind];
  put(['Dados de', when], (row) => { label(row.getCell(1)); row.getCell(2).numFmt = 'dd/mm/yyyy "às" hh:mm'; row.getCell(2).alignment = { horizontal: 'left' }; });
  put(['Tipo', kindLabel], (row) => label(row.getCell(1)));
  put(['Horário', 'Brasília (todas as datas e horas da planilha)'], (row) => label(row.getCell(1)));
  put([]);

  const header = put(['Grupo', 'Aba', 'O que tem', 'Registros', 'Arquivados'], (row) => {
    row.height = 22;
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle' };
    });
  });
  void header;

  const seen = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.spec.table)) continue;
    seen.add(plan.spec.table);
    const all = plan.spec.files ? new Array(fileCount(file)).fill({}) : (file.tables[plan.spec.table] ?? []);
    const archived = all.filter((row) => row.deleted_at).length;
    const tabs = plans.filter((other) => other.spec.table === plan.spec.table && other.name);
    const link: Cell | ExcelJS.CellHyperlinkValue = tabs.length
      ? { text: tabs.length > 1 ? `${tabs[0].name} … ${tabs[tabs.length - 1].name}` : tabs[0].name, hyperlink: `#'${tabs[0].name}'!A1` }
      : plan.spec.sheet;
    put([GROUPS[plan.spec.group].label, link, plan.spec.about, all.length, archived || null], (row) => {
      row.getCell(4).numFmt = '#,##0';
      row.getCell(5).numFmt = '#,##0';
      row.getCell(2).font = tabs.length ? { color: { argb: 'FF4F46E5' }, underline: true } : { color: { argb: 'FF9A98AB' } };
      if (!all.length) row.eachCell((cell) => { if (Number(cell.col) !== 2) cell.font = { color: { argb: 'FF9A98AB' } }; });
      row.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } }; });
    });
  }

  put([]);
  const notes = [
    'Como ler',
    'Cada aba traz um assunto. A primeira linha fica fixa e tem filtro: clique na setinha de uma coluna para filtrar ou ordenar.',
    'Os registros mais recentes aparecem primeiro nas abas com datas.',
    '“Arquivados”: o sistema nunca apaga dados. Um registro removido na tela continua aqui, com a data em “Arquivado em”.',
    'Senhas, chaves e tokens nunca entram em um backup. Os documentos e as fotos são privados e não abrem fora do sistema: veja a aba “Documentos e imagens”.',
    'Esta planilha é uma cópia para consulta e guarda. Editá-la não muda o sistema. Para voltar a empresa a este ponto, use Configurações → Backups.',
  ];
  notes.forEach((note, index) => {
    const row = sheet.addRow([note]);
    row.getCell(1).font = index === 0 ? { bold: true, size: 13, color: { argb: 'FF282638' } } : { color: { argb: 'FF4B4A5C' } };
    sheet.mergeCells(row.number, 1, row.number, 5);
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    if (index > 0) row.height = 32;
    row.commit();
  });
  sheet.commit();
}

function writeSheet(workbook: ExcelJS.stream.xlsx.WorkbookWriter, plan: Plan, context: Context, file: BackupFile) {
  const { spec, rows } = plan;
  const color = GROUPS[spec.group].color;

  if (spec.settings) return writeSettings(workbook, plan);
  if (spec.files) return writeFilesNotice(workbook, plan, file);

  const columns = plan.columns;
  const probe = rows.slice(0, 300);
  const widths = columns.map((column) => widthOf(column, probe.map((row) => text(valueOf(column, row, context)))));
  const sheet = workbook.addWorksheet(plan.name, {
    properties: { tabColor: { argb: color } },
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
  });
  sheet.columns = columns.map((column, index) => ({ key: `c${index}`, width: widths[index] }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };

  const header = sheet.addRow(columns.map((column) => column.header));
  header.height = 24;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', wrapText: false };
  });
  header.commit();

  const formats = columns.map((column) => (column.kind ? NUMBER_FORMATS[column.kind] : undefined));
  const rightAligned = columns.map((column) => ['money', 'int', 'num', 'hours', 'percent'].includes(column.kind ?? ''));
  for (const row of rows) {
    const added = sheet.addRow(columns.map((column) => valueOf(column, row, context)));
    columns.forEach((_, index) => {
      const cell = added.getCell(index + 1);
      if (formats[index]) cell.numFmt = formats[index]!;
      if (rightAligned[index]) cell.alignment = { horizontal: 'right' };
    });
    added.commit();
  }
  sheet.commit();
  void columnLetter;
}

/** The files are private to the system: this tab says where to see them, with links that open after logging in. */
function writeFilesNotice(workbook: ExcelJS.stream.xlsx.WorkbookWriter, plan: Plan, file: BackupFile) {
  const sheet = workbook.addWorksheet(plan.name, { properties: { tabColor: { argb: GROUPS[plan.spec.group].color } }, views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 34 }, { width: 14 }, { width: 70 }];
  const base = organizationPublicUrl(file.organization.slug);
  const documents = (file.tables.library_documents ?? []).filter((row) => !row.deleted_at).length;
  const images = (file.tables.part_images ?? []).filter((row) => !row.deleted_at).length;

  const add = (values: Array<Cell | ExcelJS.CellHyperlinkValue>, style?: (row: ExcelJS.Row) => void) => {
    const row = sheet.addRow(values);
    style?.(row);
    row.commit();
  };
  add(['Documentos e imagens ficam no sistema'], (row) => { row.height = 28; row.getCell(1).font = { size: 16, bold: true, color: { argb: 'FF282638' } }; });
  add(['Os arquivos são privados: abrir esta planilha em outro lugar não mostra eles. Entre no sistema normalmente e veja no menu lateral.'], (row) => {
    sheet.mergeCells(row.number, 1, row.number, 3);
    row.height = 34;
    row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(1).font = { color: { argb: 'FF4B4A5C' } };
  });
  add([]);
  add(['Onde ver', 'Arquivos', 'Como chegar'], (row) => {
    row.height = 22;
    row.eachCell((cell) => { cell.fill = HEADER_FILL; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.alignment = { vertical: 'middle' }; });
  });
  const place = (name: string, count: number, path: string, how: string) => {
    if (!count) return;
    add([base ? { text: name, hyperlink: `${base}${path}` } : name, count, how], (row) => {
      row.getCell(1).font = base ? { color: { argb: 'FF4F46E5' }, underline: true } : {};
      row.getCell(2).numFmt = '#,##0';
      row.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } }; });
    });
  };
  place('Biblioteca (documentos)', documents, '/admin/library', 'Menu lateral → Biblioteca');
  place('Fotos das peças', images, '/admin/pecas', 'Menu lateral → Venda de Peças → Peças');
  sheet.commit();
}

/** A one-row table (the settings) reads better turned on its side: setting on the left, value on the right. */
function writeSettings(workbook: ExcelJS.stream.xlsx.WorkbookWriter, plan: Plan) {
  const color = GROUPS[plan.spec.group].color;
  const sheet = workbook.addWorksheet(plan.name, { properties: { tabColor: { argb: color } }, views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] });
  sheet.columns = [{ width: 44 }, { width: 70 }];
  const header = sheet.addRow(['Configuração', 'Valor']);
  header.height = 24;
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  });
  header.commit();

  const row = plan.rows[0] ?? {};
  // In the order of the screen (the database returns the keys shortest first), the update date last.
  const known = Object.keys(SETTING_LABELS);
  const entries = Object.entries(row).sort(([a], [b]) => {
    const place = (key: string) => (key === 'updated_at' ? 10_000 : known.includes(key) ? known.indexOf(key) : 5_000);
    return place(a) - place(b);
  });
  for (const [key, value] of entries) {
    if (key === 'organization_id' || key.endsWith('_by') || key === 'deleted_by') continue;
    const kind = guessKind(key, value);
    const shown =
      value === null || value === undefined
        ? ''
        : typeof value === 'object'
          ? clip(JSON.stringify(value))
          : cellValue(value, kind === 'json' ? 'text' : kind, SETTING_WORDS[key]);
    const added = sheet.addRow([SETTING_LABELS[key] ?? humanize(key), shown]);
    if (NUMBER_FORMATS[kind]) added.getCell(2).numFmt = NUMBER_FORMATS[kind]!;
    added.getCell(2).alignment = { horizontal: 'left', wrapText: true, vertical: 'top' };
    added.commit();
  }
  sheet.commit();
}

export function workbookFileName(file: BackupFile, createdAt: string) {
  const stamp = createdAt.slice(0, 16).replace(/[:T]/g, '-');
  return `nextrotta-${file.organization.slug}-backup-${stamp}.xlsx`;
}
