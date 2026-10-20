'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Link2,
  Loader2,
  Minus,
  Package,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  Unplug,
  Wallet,
} from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { PhoneInput } from '@/components/phone-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatCurrency, normalizeText } from '@/lib/formatters';
import type { MercadoPagoAccountStatus } from '@/lib/mercadopago/accounts';
import type { AccountSummaryRow } from '@/lib/parts/account';
import type { Sale } from '@/lib/parts/sales';
import type { TransferSummary } from '@/lib/parts/stock';
import { formatMonthLabel, PAYMENT_METHOD_LABELS, parseAmount, type PaymentMethod, type TechnicianPart } from '@/lib/parts/types';
import { PaymentPanel, type Delivery } from './payment-panel';
import { Alert, BarcodeScanner, currentMonthKey, Field, formatDateTime, inputClassName, PartImage, partsApi, Spinner, useParts, inputClass } from './shared';

interface PendingDebt {
  id: string;
  number: number;
  description: string;
  totalAmount: number;
  installments: number;
  firstDueMonth: string;
}

interface MeResponse {
  month: string;
  parts: TechnicianPart[];
  paymentMethods: PaymentMethod[];
  settlementDay: number;
  mercadoPago: MercadoPagoAccountStatus;
  account: AccountSummaryRow | null;
  pendingTransfers: Array<Omit<TransferSummary, 'totalCost'>>;
  pendingDebts: PendingDebt[];
}

interface CartLine {
  part: TechnicianPart;
  quantity: number;
  price: string;
}

const STATUS_TONES = { awaiting_payment: 'warning', paid: 'success', canceled: 'neutral' } as const;

export function TechnicianParts() {
  const { data, error, loading, reload } = useParts<MeResponse>('/api/parts/me');
  const [mpNotice, setMpNotice] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  // Back from Mercado Pago's authorization (?mp=conectado|erro|cancelado).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('mp');
    if (!status) return;
    if (status === 'conectado') setMpNotice({ tone: 'success', text: 'Conta do Mercado Pago conectada. Você já pode receber por Pix, link e cartão.' });
    else if (status === 'cancelado') setMpNotice({ tone: 'warning', text: 'A conexão com o Mercado Pago foi cancelada.' });
    else setMpNotice({ tone: 'danger', text: params.get('motivo') || 'Não foi possível conectar o Mercado Pago.' });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return null;

  return (
    <div className="grid gap-4">
      {mpNotice ? <Alert tone={mpNotice.tone}>{mpNotice.text}</Alert> : null}
      <PendingConfirmations transfers={data.pendingTransfers} debts={data.pendingDebts} onDone={reload} />
      <div className="grid gap-4 lg:grid-cols-2">
        <MercadoPagoCard status={data.mercadoPago} onChanged={reload} />
        <AccountCard account={data.account} month={data.month} settlementDay={data.settlementDay} />
      </div>
      <Tabs defaultValue="sell" className="gap-4">
        <TabsList>
          <TabsTrigger value="sell">
            <ShoppingCart className="h-4 w-4" />
            Vender
          </TabsTrigger>
          <TabsTrigger value="sales">
            <Wallet className="h-4 w-4" />
            Minhas vendas
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sell">
          <SellPanel parts={data.parts} paymentMethods={data.paymentMethods} mercadoPagoConnected={data.mercadoPago.connected} onSold={reload} />
        </TabsContent>
        <TabsContent value="sales">
          <MySales paymentMethods={data.paymentMethods} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------- Mercado Pago connection

function MercadoPagoCard({ status, onChanged }: { status: MercadoPagoAccountStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [terminals, setTerminals] = useState<Array<{ id: string; operatingMode: string | null }> | null>(null);
  const [selected, setSelected] = useState(status.terminalId ?? '');

  async function connect() {
    setBusy('connect');
    setError('');
    try {
      const { url } = await partsApi<{ url: string }>('/api/mercadopago/account', { method: 'POST' });
      window.location.href = url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm('Desconectar sua conta do Mercado Pago? Você deixa de receber por Pix, link e cartão até conectar de novo.')) return;
    setBusy('disconnect');
    try {
      await partsApi('/api/mercadopago/account', { method: 'DELETE' });
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function loadTerminals() {
    setBusy('terminals');
    setError('');
    try {
      const result = await partsApi<{ terminals: Array<{ id: string; operatingMode: string | null }>; selected: string | null }>('/api/mercadopago/terminals');
      setTerminals(result.terminals);
      setSelected(result.selected ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function saveTerminal() {
    setBusy('save-terminal');
    setError('');
    try {
      await partsApi('/api/mercadopago/terminals', { method: 'PUT', json: { terminalId: selected || null } });
      setTerminals(null);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DataPanel
      title="Mercado Pago"
      description="As vendas caem na sua própria conta do Mercado Pago. No acerto, você paga à empresa o preço de técnico das peças vendidas."
    >
      <div className="grid gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {!status.available ? (
          <Alert tone="warning">O recebimento pelo Mercado Pago ainda não foi liberado na plataforma. Use dinheiro/registro manual por enquanto.</Alert>
        ) : status.connected ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>
                Conectado{status.nickname ? ` como ${status.nickname}` : ''}
                {status.liveMode === false ? ' (conta de teste)' : ''}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Cartão presencial: {status.terminalId ? `cobranças vão para a maquininha ${status.terminalId}.` : 'cobre pelo app do Mercado Pago (Point Tap) e confira aqui.'}
            </p>
            {terminals ? (
              <div className="grid gap-2">
                <select className={inputClassName} value={selected} onChange={(event) => setSelected(event.target.value)} aria-label="Maquininha">
                  <option value="">Sem maquininha (cobrar pelo app — Point Tap)</option>
                  {terminals.map((terminal) => (
                    <option key={terminal.id} value={terminal.id}>
                      {terminal.id}
                      {terminal.operatingMode && terminal.operatingMode !== 'PDV' ? ' (vai para o modo integrado)' : ''}
                    </option>
                  ))}
                </select>
                {!terminals.length ? <p className="text-xs text-muted-foreground">Nenhuma maquininha Point encontrada na sua conta.</p> : null}
                <Button size="sm" onClick={saveTerminal} disabled={busy !== null}>
                  Salvar
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={loadTerminals} disabled={busy !== null}>
                {busy === 'terminals' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Maquininha Point
              </Button>
              <Button variant="ghost" size="sm" onClick={disconnect} disabled={busy !== null}>
                <Unplug className="h-4 w-4" />
                Desconectar
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Conecte sua conta para cobrar por Pix, link de cartão e maquininha. Sem conta, só dá para registrar vendas em dinheiro.</p>
            <Button onClick={connect} disabled={busy !== null}>
              {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Conectar minha conta do Mercado Pago
            </Button>
          </>
        )}
      </div>
    </DataPanel>
  );
}

// ---------------------------------------------------------------- account

function AccountCard({ account, month, settlementDay }: { account: AccountSummaryRow | null; month: string; settlementDay: number }) {
  return (
    <DataPanel title="Minha conta de peças" description={`Acerto do mês até o dia ${settlementDay} do mês seguinte.`}>
      {account ? (
        <div className="grid gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">
              {account.balanceDue < 0 ? 'Crédito a seu favor' : `Saldo a pagar até ${formatMonthLabel(month)}`}
            </span>
            <span className="whitespace-nowrap text-xl font-semibold">{formatCurrency(Math.abs(account.balanceDue))}</span>
          </div>
          <Row label="Vindo dos meses anteriores" value={account.previousBalance} />
          <Row label="Peças vendidas no mês (preço de técnico)" value={account.salesInMonth} />
          {account.installmentsInMonth ? <Row label="Parcelas de débito no mês" value={account.installmentsInMonth} /> : null}
          {account.adjustmentsInMonth ? <Row label="Ajustes" value={account.adjustmentsInMonth} /> : null}
          <Row label="Pago no mês" value={-account.paidInMonth} />
          <p className="pt-1 text-xs text-muted-foreground">
            No seu estoque: {account.stockUnits} peça(s), {formatCurrency(account.stockValue)} a preço de técnico.
            {account.futureInstallments ? ` Parcelas futuras: ${formatCurrency(account.futureInstallments)}.` : ''}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem movimento.</p>
      )}
    </DataPanel>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 text-muted-foreground">
      <span>{label}</span>
      <span className="whitespace-nowrap tabular-nums text-foreground">{formatCurrency(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- pending confirmations

function PendingConfirmations({ transfers, debts, onDone }: { transfers: MeResponse['pendingTransfers']; debts: PendingDebt[]; onDone: () => void }) {
  const [open, setOpen] = useState<{ kind: 'transfer' | 'debt'; id: string } | null>(null);
  if (!transfers.length && !debts.length) return null;
  return (
    <div className="grid gap-2">
      {transfers.map((transfer) => (
        <Alert key={transfer.id} tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {transfer.direction === 'out' ? 'Remessa' : 'Devolução'} nº {transfer.number}: {transfer.units} peça(s),{' '}
            {formatCurrency(transfer.totalTechnicianPrice)} a preço de técnico. Confira e confirme.
          </span>
          <Button size="sm" onClick={() => setOpen({ kind: 'transfer', id: transfer.id })}>
            Conferir
          </Button>
        </Alert>
      ))}
      {debts.map((debt) => (
        <Alert key={debt.id} tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Débito nº {debt.number}: {formatCurrency(debt.totalAmount)} em {debt.installments}x. Confira e confirme.
          </span>
          <Button size="sm" onClick={() => setOpen({ kind: 'debt', id: debt.id })}>
            Conferir
          </Button>
        </Alert>
      ))}
      <Dialog open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {open?.kind === 'transfer' ? <TransferReview id={open.id} onDone={() => { setOpen(null); onDone(); }} /> : null}
          {open?.kind === 'debt' ? <DebtReview id={open.id} onDone={() => { setOpen(null); onDone(); }} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransferReview({ id, onDone }: { id: string; onDone: () => void }) {
  type TransferDetail = Omit<TransferSummary, 'totalCost'> & {
    items: Array<{ partId: string; name: string; quantity: number; unitTechnicianPrice: number }>;
  };
  const { data, error } = useParts<{ transfer: TransferDetail }>(`/api/parts/transfers/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const transfer = data?.transfer;

  async function confirm() {
    setBusy(true);
    try {
      await partsApi(`/api/parts/transfers/${id}`, { method: 'POST' });
      onDone();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{transfer ? `${transfer.direction === 'out' ? 'Remessa' : 'Devolução'} nº ${transfer.number}` : 'Remessa'}</DialogTitle>
        <DialogDescription>
          {transfer?.direction === 'out'
            ? 'Peças entregues a você em consignação. Você responde por elas até vender ou devolver.'
            : 'Peças que você devolveu ao estoque da empresa.'}
        </DialogDescription>
      </DialogHeader>
      {error || actionError ? <Alert>{error || actionError}</Alert> : null}
      {!transfer ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 text-sm">
          <ul className="divide-y rounded-lg border">
            {transfer.items.map((item) => (
              <li key={item.partId} className="flex justify-between gap-3 px-3 py-2">
                <span>
                  {item.quantity}× {item.name}
                </span>
                <span className="tabular-nums text-muted-foreground">{formatCurrency(item.quantity * item.unitTechnicianPrice)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between font-semibold">
            <span>Total a preço de técnico</span>
            <span>{formatCurrency(transfer.totalTechnicianPrice)}</span>
          </p>
          {transfer.note ? <p className="text-muted-foreground">Obs.: {transfer.note}</p> : null}
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {transfer.direction === 'out' ? 'Confirmo que recebi estas peças' : 'Confirmo a devolução'}
          </Button>
        </div>
      )}
    </>
  );
}

function DebtReview({ id, onDone }: { id: string; onDone: () => void }) {
  type DebtDetail = PendingDebt & { schedule: Array<{ installment: number; amount: number; dueMonth: string }> };
  const { data, error } = useParts<{ debt: DebtDetail }>(`/api/parts/debts/${id}`);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const debt = data?.debt;

  async function confirm() {
    setBusy(true);
    try {
      await partsApi(`/api/parts/debts/${id}`, { method: 'POST', json: { action: 'acknowledge' } });
      onDone();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Débito nº {debt?.number ?? ''}</DialogTitle>
        <DialogDescription>Valor de peças sob sua responsabilidade, a pagar em parcelas mensais.</DialogDescription>
      </DialogHeader>
      {error || actionError ? <Alert>{error || actionError}</Alert> : null}
      {!debt ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 text-sm">
          <p>{debt.description}</p>
          <ul className="divide-y rounded-lg border">
            {debt.schedule.map((item) => (
              <li key={item.installment} className="flex justify-between px-3 py-2">
                <span>
                  Parcela {item.installment} — {formatMonthLabel(item.dueMonth)}
                </span>
                <span className="tabular-nums">{formatCurrency(item.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{formatCurrency(debt.totalAmount)}</span>
          </p>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Estou de acordo
          </Button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- selling

function SellPanel({
  parts,
  paymentMethods,
  mercadoPagoConnected,
  onSold,
}: {
  parts: TechnicianPart[];
  paymentMethods: PaymentMethod[];
  mercadoPagoConnected: boolean;
  onSold: () => void;
}) {
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [charging, setCharging] = useState<{ sale: Sale; delivery: Delivery | null } | null>(null);

  const visible = useMemo(() => {
    const term = normalizeText(search);
    return parts.filter((part) => part.stock > 0 && (!term || normalizeText(`${part.name} ${part.barcode ?? ''} ${part.brand ?? ''} ${part.category ?? ''}`).includes(term)));
  }, [parts, search]);

  function add(part: TechnicianPart) {
    setCart((current) => {
      const line = current.find((item) => item.part.id === part.id);
      if (line) {
        return current.map((item) => (item.part.id === part.id ? { ...item, quantity: Math.min(part.stock, item.quantity + 1) } : item));
      }
      return [...current, { part, quantity: 1, price: part.suggestedPrice.toFixed(2).replace('.', ',') }];
    });
  }

  function onScan(code: string) {
    const part = parts.find((item) => item.barcode === code.replace(/\s+/g, ''));
    if (!part) {
      setScanError(`Nenhuma peça do seu estoque tem o código ${code}.`);
      return;
    }
    if (part.stock <= 0) {
      setScanError(`${part.name}: sem unidades no seu estoque.`);
      return;
    }
    setScanError('');
    add(part);
    setScanning(false);
  }

  const total = cart.reduce((sum, line) => sum + (parseAmount(line.price) ?? 0) * line.quantity, 0);
  const owed = cart.reduce((sum, line) => sum + line.part.technicianPrice * line.quantity, 0);

  // The dialogs below stay mounted even when the last unit was just sold (the payment is still open).
  const empty = !parts.some((part) => part.stock > 0);

  return (
    <div className="grid gap-4 pb-28">
      {empty ? (
        <EmptyState icon={Package} title="Nenhuma peça no seu estoque" description="Quando a empresa enviar peças para você, elas aparecem aqui para vender." />
      ) : (
        <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={inputClass('pl-9')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça" aria-label="Buscar peça" />
        </div>
        <Button variant="outline" onClick={() => setScanning(true)}>
          <ScanBarcode className="h-4 w-4" />
          <span className="hidden sm:inline">Ler código</span>
        </Button>
      </div>
      {scanError ? <Alert tone="warning">{scanError}</Alert> : null}
      {!mercadoPagoConnected ? <Alert tone="warning">Conecte sua conta do Mercado Pago para vender. Sem ela, nenhuma venda pode ser registrada.</Alert> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((part) => {
          const inCart = cart.find((line) => line.part.id === part.id)?.quantity ?? 0;
          return (
            <button
              key={part.id}
              type="button"
              onClick={() => add(part)}
              disabled={inCart >= part.stock}
              className="group grid gap-2 rounded-xl border bg-card p-2 text-left shadow-sm transition hover:border-primary/50 disabled:opacity-60"
            >
              <PartImage src={part.imageUrl} alt={part.name} className="aspect-square h-auto w-full" />
              <div className="grid gap-0.5 px-1 pb-1">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{part.name}</span>
                <span className="text-sm font-semibold">{formatCurrency(part.suggestedPrice)}</span>
                <span className="text-xs text-muted-foreground">
                  No carro: {part.stock - inCart} {part.unit}
                  {inCart ? ` · ${inCart} na venda` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {!visible.length ? <p className="text-center text-sm text-muted-foreground">Nenhuma peça encontrada.</p> : null}
        </>
      )}

      {cart.length ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 shadow-[0_-6px_20px_rgba(0,0,0,0.08)] backdrop-blur md:left-auto md:right-4 md:bottom-4 md:w-96 md:rounded-xl md:border">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{cart.reduce((sum, line) => sum + line.quantity, 0)} peça(s)</p>
              <p className="text-lg font-semibold">{formatCurrency(total)}</p>
            </div>
            <Button size="lg" disabled={!mercadoPagoConnected} onClick={() => setCheckout(true)}>
              <ShoppingCart className="h-4 w-4" />
              Cobrar
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={scanning} onOpenChange={setScanning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Ler código de barras</DialogTitle>
          </DialogHeader>
          {scanning ? <BarcodeScanner showClose={false} onDetect={onScan} onClose={() => setScanning(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={checkout} onOpenChange={setCheckout}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cobrar o cliente</DialogTitle>
            <DialogDescription>Você define o preço de venda. À empresa você deve {formatCurrency(owed)} (preço de técnico).</DialogDescription>
          </DialogHeader>
          {checkout ? (
            <CheckoutForm
              cart={cart}
              setCart={setCart}
              paymentMethods={paymentMethods}
              mercadoPagoConnected={mercadoPagoConnected}
              onCreated={(sale, delivery) => {
                setCheckout(false);
                setCart([]);
                setCharging({ sale, delivery });
                onSold();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={charging !== null} onOpenChange={(value) => !value && setCharging(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Pagamento</DialogTitle>
          </DialogHeader>
          {charging ? (
            <PaymentPanel
              initialSale={charging.sale}
              initialDelivery={charging.delivery}
              paymentMethods={paymentMethods}
              onChanged={(sale) => sale.status === 'canceled' && onSold()}
              onClose={() => setCharging(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CheckoutForm({
  cart,
  setCart,
  paymentMethods,
  mercadoPagoConnected,
  onCreated,
}: {
  cart: CartLine[];
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>;
  paymentMethods: PaymentMethod[];
  mercadoPagoConnected: boolean;
  onCreated: (sale: Sale, delivery: Delivery | null) => void;
}) {
  const available = mercadoPagoConnected ? paymentMethods : [];
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [method, setMethod] = useState<PaymentMethod>(available[0] ?? 'cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const total = cart.reduce((sum, line) => sum + (parseAmount(line.price) ?? 0) * line.quantity, 0);
  const belowTechnicianPrice = cart.filter((line) => (parseAmount(line.price) ?? 0) < line.part.technicianPrice);

  function updateLine(partId: string, change: Partial<CartLine>) {
    setCart((current) => current.map((line) => (line.part.id === partId ? { ...line, ...change } : line)).filter((line) => line.quantity > 0));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await partsApi<{ sale: Sale; delivery: Delivery | null }>('/api/parts/sales', {
        method: 'POST',
        json: {
          customerName,
          customerPhone,
          orderCode,
          paymentMethod: method,
          items: cart.map((line) => ({ partId: line.part.id, quantity: line.quantity, unitPrice: line.price })),
        },
      });
      onCreated(result.sale, result.delivery);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <ul className="grid gap-3">
        {cart.map((line) => (
          <li key={line.part.id} className="flex items-center gap-3">
            <PartImage src={line.part.imageUrl} alt={line.part.name} className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{line.part.name}</p>
              <p className="text-xs text-muted-foreground">Técnico: {formatCurrency(line.part.technicianPrice)} · sugerido {formatCurrency(line.part.suggestedPrice)}</p>
              <div className="mt-1 flex items-center gap-2">
                <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => updateLine(line.part.id, { quantity: line.quantity - 1 })} aria-label="Menos uma">
                  {line.quantity === 1 ? <Trash2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                </Button>
                <span className="w-6 text-center text-sm tabular-nums">{line.quantity}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  disabled={line.quantity >= line.part.stock}
                  onClick={() => updateLine(line.part.id, { quantity: line.quantity + 1 })}
                  aria-label="Mais uma"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">R$</span>
                <input
                  className={inputClass('min-h-8 w-24 text-right')}
                  value={line.price}
                  inputMode="decimal"
                  onChange={(event) => updateLine(line.part.id, { price: event.target.value })}
                  aria-label={`Preço de ${line.part.name}`}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
      {belowTechnicianPrice.length ? (
        <Alert tone="warning">Abaixo do preço de técnico: {belowTechnicianPrice.map((line) => line.part.name).join(', ')}. Você paga a diferença.</Alert>
      ) : null}
      <p className="flex justify-between text-base font-semibold">
        <span>Total</span>
        <span>{formatCurrency(total)}</span>
      </p>

      <Field label="WhatsApp do cliente" hint="O link de pagamento e o recibo vão para este número.">
        <PhoneInput value={customerPhone} onChange={setCustomerPhone} hint={null} className={inputClassName} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do cliente (opcional)">
          <input className={inputClassName} value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
        </Field>
        <Field label="Nº da OS (opcional)">
          <input className={inputClassName} value={orderCode} onChange={(event) => setOrderCode(event.target.value)} />
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Forma de pagamento</legend>
        {paymentMethods.map((value) => {
          const disabled = !mercadoPagoConnected;
          return (
            <label key={value} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${method === value ? 'border-primary bg-primary/5' : ''} ${disabled ? 'opacity-50' : ''}`}>
              <input type="radio" name="method" value={value} checked={method === value} disabled={disabled} onChange={() => setMethod(value)} />
              <span>{PAYMENT_METHOD_LABELS[value]}</span>
              {disabled ? <span className="ml-auto text-xs text-muted-foreground">conecte o Mercado Pago</span> : null}
            </label>
          );
        })}
      </fieldset>

      {error ? <Alert>{error}</Alert> : null}
      <Button type="submit" size="lg" disabled={busy || !cart.length || !available.includes(method)}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {method === 'cash' ? 'Registrar venda' : 'Gerar cobrança'} · {formatCurrency(total)}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- my sales

function MySales({ paymentMethods }: { paymentMethods: PaymentMethod[] }) {
  const [month, setMonth] = useState(currentMonthKey());
  const { data, error, loading, reload } = useParts<{ sales: Sale[] }>(`/api/parts/sales?month=${month}`);
  const [open, setOpen] = useState<Sale | null>(null);

  return (
    <DataPanel
      title="Minhas vendas"
      action={<input type="month" className={inputClass('w-auto')} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} aria-label="Mês" />}
    >
      {error ? <Alert>{error}</Alert> : null}
      {loading && !data ? (
        <Spinner />
      ) : !data?.sales.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma venda em {formatMonthLabel(month)}.</p>
      ) : (
        <ul className="divide-y">
          {data.sales.map((sale) => (
            <li key={sale.id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left" onClick={() => setOpen(sale)}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    Nº {sale.number} · {sale.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(sale.createdAt)} · {sale.customerName || 'Cliente'} · {sale.paymentMethodLabel}
                  </p>
                </div>
                <div className="grid justify-items-end gap-1">
                  <span className="text-sm font-semibold tabular-nums">{formatCurrency(sale.totalAmount)}</span>
                  <StatusBadge tone={STATUS_TONES[sale.status]}>{sale.statusLabel}</StatusBadge>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Venda</DialogTitle>
          </DialogHeader>
          {open ? (
            <PaymentPanel initialSale={open} paymentMethods={paymentMethods} onChanged={() => reload()} onClose={() => setOpen(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </DataPanel>
  );
}
