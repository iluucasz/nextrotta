/**
 * Controle de Peças: shared types, labels and money helpers. Dependency-free, so the screens
 * (client components), the API and the Mercado Pago code share one definition.
 *
 * The model: the organization hands parts to technicians under consignment. A technician sells
 * to the end customer at any price, keeps the money (in their own Mercado Pago account) and owes
 * the organization the technician price of each part sold. Never part of payroll.
 */

export const PAYMENT_METHODS = ['pix', 'card_link', 'card_present', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix (QR Code)',
  card_link: 'Link de pagamento (cartão)',
  card_present: 'Cartão na maquininha ou no celular',
  cash: 'Dinheiro / registro manual',
};

/** Methods that go through the technician's Mercado Pago account. */
export const MERCADOPAGO_METHODS: PaymentMethod[] = ['pix', 'card_link', 'card_present'];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export type SaleStatus = 'awaiting_payment' | 'paid' | 'canceled';

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  awaiting_payment: 'Aguardando pagamento',
  paid: 'Paga',
  canceled: 'Cancelada',
};

export type MovementKind =
  | 'purchase'
  | 'adjustment'
  | 'transfer'
  | 'sale'
  | 'sale_canceled'
  | 'inventory_shortage'
  | 'inventory_surplus';

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  purchase: 'Entrada (compra)',
  adjustment: 'Ajuste',
  transfer: 'Remessa / devolução',
  sale: 'Venda',
  sale_canceled: 'Venda cancelada',
  inventory_shortage: 'Falta no inventário',
  inventory_surplus: 'Sobra no inventário',
};

export type AccountEntryKind = 'sale' | 'sale_canceled' | 'debt_installment' | 'debt_canceled' | 'payment' | 'adjustment';

export const ACCOUNT_ENTRY_LABELS: Record<AccountEntryKind, string> = {
  sale: 'Venda',
  sale_canceled: 'Venda cancelada',
  debt_installment: 'Parcela de débito',
  debt_canceled: 'Débito cancelado',
  payment: 'Pagamento',
  adjustment: 'Ajuste',
};

export const SETTLEMENT_METHODS = ['pix', 'cash', 'transfer', 'deduction', 'other'] as const;
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

export const SETTLEMENT_METHOD_LABELS: Record<SettlementMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  deduction: 'Desconto acordado em contrato',
  other: 'Outro',
};

export function isSettlementMethod(value: unknown): value is SettlementMethod {
  return typeof value === 'string' && (SETTLEMENT_METHODS as readonly string[]).includes(value);
}

export interface Part {
  id: string;
  name: string;
  barcode: string | null;
  sku: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  description: string | null;
  /** Served by /api/parts/[id]/image; null without a picture. */
  imageUrl: string | null;
  costPrice: number;
  technicianPrice: number;
  suggestedPrice: number;
  minStock: number | null;
  active: boolean;
  /** Units in the central stock. */
  centralStock: number;
  /** Units with technicians (all of them). */
  technicianStock: number;
}

/** What a technician sees of a part: never the organization's cost. */
export interface TechnicianPart {
  id: string;
  name: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  description: string | null;
  imageUrl: string | null;
  technicianPrice: number;
  suggestedPrice: number;
  /** Units in this technician's stock. */
  stock: number;
}

export interface PartsSettings {
  /** Shown to the customer in the payment message and the receipt; empty omits it. */
  companyName: string;
  paymentMethods: PaymentMethod[];
  receiptFooter: string;
  settlementDay: number;
}

export const DEFAULT_PARTS_SETTINGS: PartsSettings = {
  companyName: '',
  paymentMethods: [...PAYMENT_METHODS],
  receiptFooter: '',
  settlementDay: 10,
};

/** Rounds to cents; prices travel as numbers and are stored as NUMERIC(12, 2). */
export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Accepts 12,50 / 12.50 / "R$ 1.234,56" / "1.500" (thousands, as typed in Brazil); null when not a valid non-negative amount. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? roundMoney(value) : null;
  if (typeof value !== 'string') return null;
  let text = value.replace(/[R$\s]/g, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  // Dots in groups of three digits and no comma ("1.500", "25.000") are thousands separators, not decimals:
  // reading "1.500" as R$ 1,50 would charge a customer a thousandth of the price.
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? roundMoney(number) : null;
}

/** YYYY-MM → "outubro de 2026". */
export function formatMonthLabel(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
}

/** Adds months to a YYYY-MM key. */
export function addMonths(month: string, count: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Barcodes are compared by their digits/letters only (readers add spaces or line breaks). */
export function normalizeBarcode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/\s+/g, '').trim();
  return text ? text : null;
}
