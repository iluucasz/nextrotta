'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Link2,
  Loader2,
  Minus,
  Package,
  Plus,
  QrCode,
  Receipt,
  ScanBarcode,
  Search,
  ShoppingCart,
  Smartphone,
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
  const [tab, setTab] = useState('sell');

  // Back from Mercado Pago's authorization (?mp=conectado|erro|cancelado).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('mp');
    if (!status) return;
    if (status === 'conectado') setMpNotice({ tone: 'success', text: 'Conta do Mercado Pago conectada. Para vender por Pix, confira se ela tem uma chave Pix (app do Mercado Pago > Pix > Minhas chaves).' });
    else if (status === 'cancelado') setMpNotice({ tone: 'warning', text: 'A conexão com o Mercado Pago foi cancelada.' });
    else setMpNotice({ tone: 'danger', text: params.get('motivo') || 'Não foi possível conectar o Mercado Pago.' });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) return null;

  const stockUnits = data.parts.reduce((sum, part) => sum + part.stock, 0);
  const stockValue = data.parts.reduce((sum, part) => sum + part.stock * part.technicianPrice, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {mpNotice ? <Alert tone={mpNotice.tone}>{mpNotice.text}</Alert> : null}
      <PendingConfirmations transfers={data.pendingTransfers} debts={data.pendingDebts} onDone={reload} />
      <SummaryTiles stockUnits={stockUnits} stockValue={stockValue} balanceDue={data.account?.balanceDue ?? 0} month={data.month} onOpenAccount={() => setTab('account')} />
      <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-4">
        <TabsList className="grid h-12 w-full grid-cols-3 p-1">
          <TabsTrigger value="sell" className="text-sm">
            <ShoppingCart className="h-4 w-4" />
            Vender
          </TabsTrigger>
          <TabsTrigger value="sales" className="text-sm">
            <Receipt className="h-4 w-4" />
            Vendas
          </TabsTrigger>
          <TabsTrigger value="account" className="text-sm">
            <Wallet className="h-4 w-4" />
            Conta
            {!data.mercadoPago.connected && data.mercadoPago.available ? <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="Mercado Pago não conectado" /> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sell">
          <SellPanel
            parts={data.parts}
            paymentMethods={data.paymentMethods}
            mercadoPagoConnected={data.mercadoPago.connected}
            onSold={reload}
            onOpenAccount={() => setTab('account')}
          />
        </TabsContent>
        <TabsContent value="sales">
          <MySales paymentMethods={data.paymentMethods} onSaleCanceled={reload} />
        </TabsContent>
        <TabsContent value="account" className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <AccountCard account={data.account} settlementDay={data.settlementDay} />
          <MercadoPagoCard status={data.mercadoPago} onChanged={reload} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryTiles({
  stockUnits,
  stockValue,
  balanceDue,
  month,
  onOpenAccount,
}: {
  stockUnits: number;
  stockValue: number;
  balanceDue: number;
  month: string;
  onOpenAccount: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-xl border bg-card p-3.5">
        <p className="text-xs text-muted-foreground">No carro</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">
          {stockUnits} <span className="text-sm font-normal text-muted-foreground">{stockUnits === 1 ? 'peça' : 'peças'}</span>
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">{formatCurrency(stockValue)}</p>
      </div>
      <button type="button" onClick={onOpenAccount} className="rounded-xl border bg-card p-3.5 text-left transition hover:border-primary/40">
        <p className="text-xs text-muted-foreground">{balanceDue < 0 ? 'Crédito' : 'A pagar'}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">{formatCurrency(Math.abs(balanceDue))}</p>
        <p className="truncate text-xs text-muted-foreground">até {formatMonthLabel(month)}</p>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Mercado Pago connection

function MercadoPagoCard({ status, onChanged }: { status: MercadoPagoAccountStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

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

  return (
    <DataPanel title="Mercado Pago">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {!status.available ? (
          <Alert tone="warning">O Mercado Pago ainda não foi configurado no sistema. Fale com o administrador.</Alert>
        ) : status.connected ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="truncate">
                  Conectado{status.nickname ? ` · ${status.nickname}` : ''}
                  {status.liveMode === false ? ' (teste)' : ''}
                </span>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={disconnect} disabled={busy !== null}>
                <Unplug className="h-4 w-4" />
                Desconectar
              </Button>
            </div>
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Para receber por Pix, sua conta precisa ter uma <strong>chave Pix</strong>. No app do Mercado Pago: Pix &gt; Minhas chaves.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Conecte sua conta para cobrar por Pix e cartão.</p>
            <Button onClick={connect} disabled={busy !== null}>
              {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Conectar Mercado Pago
            </Button>
          </>
        )}
      </div>
    </DataPanel>
  );
}

// ---------------------------------------------------------------- account

function AccountCard({ account, settlementDay }: { account: AccountSummaryRow | null; settlementDay: number }) {
  return (
    <DataPanel title="Minha conta">
      {account ? (
        <div className="grid gap-4 text-sm">
          <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/5 px-4 py-3">
            <div>
              <p className="font-medium">{account.balanceDue < 0 ? 'Crédito a seu favor' : 'Saldo a pagar'}</p>
              <p className="text-xs text-muted-foreground">Acerto até o dia {settlementDay}</p>
            </div>
            <span className="whitespace-nowrap text-2xl font-semibold tabular-nums">{formatCurrency(Math.abs(account.balanceDue))}</span>
          </div>
          <div className="grid gap-2">
            <Row label="Meses anteriores" value={account.previousBalance} />
            <Row label="Vendas do mês" value={account.salesInMonth} />
            {account.installmentsInMonth ? <Row label="Parcelas do mês" value={account.installmentsInMonth} /> : null}
            {account.adjustmentsInMonth ? <Row label="Ajustes" value={account.adjustmentsInMonth} /> : null}
            <Row label="Pago no mês" value={-account.paidInMonth} />
            {account.futureInstallments ? <Row label="Parcelas futuras" value={account.futureInstallments} /> : null}
          </div>
          <p className="text-xs text-muted-foreground">Vendas valem pelo preço de técnico, não pelo que você cobrou.</p>
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
          <span className="min-w-0">
            <strong>
              {transfer.direction === 'out' ? 'Remessa' : 'Devolução'} nº {transfer.number}
            </strong>
            <br />
            {transfer.units} peça(s) · {formatCurrency(transfer.totalTechnicianPrice)}
          </span>
          <Button size="sm" onClick={() => setOpen({ kind: 'transfer', id: transfer.id })}>
            Conferir
          </Button>
        </Alert>
      ))}
      {debts.map((debt) => (
        <Alert key={debt.id} tone="warning" className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0">
            <strong>Débito nº {debt.number}</strong>
            <br />
            {formatCurrency(debt.totalAmount)} em {debt.installments}x
          </span>
          <Button size="sm" onClick={() => setOpen({ kind: 'debt', id: debt.id })}>
            Conferir
          </Button>
        </Alert>
      ))}
      <Dialog open={open !== null} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-h-[90vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
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
  onOpenAccount,
}: {
  parts: TechnicianPart[];
  paymentMethods: PaymentMethod[];
  mercadoPagoConnected: boolean;
  onSold: () => void;
  onOpenAccount: () => void;
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
    setScanError('');
    setCart((current) => {
      const line = current.find((item) => item.part.id === part.id);
      if (line) {
        return current.map((item) => (item.part.id === part.id ? { ...item, quantity: Math.min(part.stock, item.quantity + 1) } : item));
      }
      // The price starts empty: the suggested one is only a hint the technician can accept or replace.
      return [...current, { part, quantity: 1, price: '' }];
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
  const suggestedTotal = cart.reduce((sum, line) => sum + line.part.suggestedPrice * line.quantity, 0);
  const priced = cart.every((line) => (parseAmount(line.price) ?? 0) > 0);

  // The dialogs below stay mounted even when the last unit was just sold (the payment is still open).
  const empty = !parts.some((part) => part.stock > 0);

  // Taking the last part out of the sale (the trash button) leaves nothing to charge: close the form instead of leaving it empty.
  useEffect(() => {
    if (checkout && !cart.length) setCheckout(false);
  }, [checkout, cart.length]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-28">
      {empty ? (
        <EmptyState icon={Package} title="Nenhuma peça no seu estoque" description="Quando a empresa enviar peças para você, elas aparecem aqui para vender." />
      ) : (
        <>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input className={inputClass('pl-9')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça" aria-label="Buscar peça" />
        </div>
        <Button
          variant="outline"
          aria-label="Ler código de barras"
          onClick={() => {
            setScanError('');
            setScanning(true);
          }}
        >
          <ScanBarcode className="h-4 w-4" />
          <span className="hidden sm:inline">Ler código</span>
        </Button>
      </div>
      {!scanning && scanError ? <Alert tone="warning">{scanError}</Alert> : null}
      {!mercadoPagoConnected ? (
        <Alert tone="warning" className="flex items-center justify-between gap-3">
          <span>Conecte o Mercado Pago para vender.</span>
          <Button size="sm" className="shrink-0" onClick={onOpenAccount}>
            Conectar
          </Button>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((part) => {
          const inCart = cart.find((line) => line.part.id === part.id)?.quantity ?? 0;
          return (
            <button
              key={part.id}
              type="button"
              onClick={() => add(part)}
              disabled={inCart >= part.stock}
              className={`group relative grid gap-2 rounded-xl border bg-card p-2 text-left shadow-sm transition hover:border-primary/50 disabled:cursor-not-allowed ${
                inCart ? 'border-primary ring-1 ring-primary' : ''
              }`}
            >
              {inCart ? (
                <span className="absolute right-3 top-3 z-10 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground shadow">
                  {inCart}
                </span>
              ) : null}
              <PartImage src={part.imageUrl} alt={part.name} className="aspect-square h-auto w-full" />
              <div className="grid gap-0.5 px-1 pb-1">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{part.name}</span>
                <span className="text-sm font-semibold tabular-nums">{formatCurrency(part.suggestedPrice)}</span>
                <span className="text-xs text-muted-foreground">
                  {part.stock} {part.unit} no carro
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
              <p className="text-xs text-muted-foreground">
                {cart.reduce((sum, line) => sum + line.quantity, 0)} peça(s) · {priced ? 'total' : 'sugerido'}
              </p>
              <p className="text-lg font-semibold">{formatCurrency(priced ? total : suggestedTotal)}</p>
            </div>
            <Button size="lg" disabled={!mercadoPagoConnected} onClick={() => setCheckout(true)}>
              <ShoppingCart className="h-4 w-4" />
              Cobrar
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={scanning} onOpenChange={setScanning}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] p-4 sm:max-w-md sm:p-6">
          <DialogHeader className="sr-only">
            <DialogTitle>Ler código de barras</DialogTitle>
          </DialogHeader>
          {/* The error shows here too: the one on the page is hidden behind this window while the scanner is open. */}
          {scanning && scanError ? <Alert tone="warning">{scanError}</Alert> : null}
          {/* continuous: a code that is not in the car must not stop the camera; a good one closes the window (see onScan). */}
          {scanning ? <BarcodeScanner continuous showClose={false} onDetect={onScan} onClose={() => setScanning(false)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={checkout} onOpenChange={setCheckout}>
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>Cobrar o cliente</DialogTitle>
            <DialogDescription>Defina quanto vai cobrar do cliente. O valor sugerido é só uma referência.</DialogDescription>
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
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-md sm:p-6">
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

const PAYMENT_ICONS: Record<PaymentMethod, React.ComponentType<{ className?: string }>> = {
  pix: QrCode,
  card_link: CreditCard,
  card_present: Smartphone,
  cash: Banknote,
};

const PAYMENT_TILE_LABELS: Record<PaymentMethod, { title: string; hint: string }> = {
  pix: { title: 'Pix', hint: 'QR Code na hora' },
  card_link: { title: 'Link de cartão', hint: 'O cliente paga pelo link' },
  card_present: { title: 'Cartão presencial', hint: 'Cobra pelo app do Mercado Pago' },
  cash: { title: 'Dinheiro', hint: 'Registro manual' },
};

function formatPriceInput(value: number) {
  return value.toFixed(2).replace('.', ',');
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
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

  const missingPrice = cart.some((line) => (parseAmount(line.price) ?? 0) <= 0);
  const total = cart.reduce((sum, line) => sum + (parseAmount(line.price) ?? 0) * line.quantity, 0);
  const owed = cart.reduce((sum, line) => sum + line.part.technicianPrice * line.quantity, 0);
  const margin = total - owed;

  function updateLine(partId: string, change: Partial<CartLine>) {
    setCart((current) => current.map((line) => (line.part.id === partId ? { ...line, ...change } : line)).filter((line) => line.quantity > 0));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (missingPrice) {
      setError('Informe o valor que você vai cobrar de cada peça.');
      return;
    }
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
    <form onSubmit={submit} className="grid gap-5">
      <section className="grid gap-3">
        <SectionTitle>Peças e valor</SectionTitle>
        <ul className="grid gap-3">
          {cart.map((line) => {
            const price = parseAmount(line.price) ?? 0;
            const lineMargin = (price - line.part.technicianPrice) * line.quantity;
            const inputId = `price-${line.part.id}`;
            return (
              <li key={line.part.id} className="grid gap-3 rounded-xl border bg-muted/30 p-3">
                <div className="flex items-center gap-3">
                  <PartImage src={line.part.imageUrl} alt={line.part.name} className="h-12 w-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{line.part.name}</p>
                    <p className="text-xs text-muted-foreground">Você deve {formatCurrency(line.part.technicianPrice)} à empresa por unidade</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => updateLine(line.part.id, { quantity: line.quantity - 1 })} aria-label={line.quantity === 1 ? 'Tirar da venda' : 'Menos uma'}>
                      {line.quantity === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </Button>
                    <span className="w-6 text-center text-sm font-medium tabular-nums">{line.quantity}</span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-9 w-9"
                      disabled={line.quantity >= line.part.stock}
                      onClick={() => updateLine(line.part.id, { quantity: line.quantity + 1 })}
                      aria-label="Mais uma"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <label htmlFor={inputId} className="text-xs font-medium text-foreground">
                    Valor que você vai cobrar{line.quantity > 1 ? ' (cada)' : ''}
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                    <input
                      id={inputId}
                      className={inputClass('h-12 bg-card pl-10 text-lg font-semibold tabular-nums')}
                      value={line.price}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={formatPriceInput(line.part.suggestedPrice)}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => updateLine(line.part.id, { price: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                    <button
                      type="button"
                      onClick={() => updateLine(line.part.id, { price: formatPriceInput(line.part.suggestedPrice) })}
                      className="rounded-full border border-dashed border-primary/50 px-3 py-1 text-xs font-medium text-primary transition hover:bg-primary/5"
                    >
                      Sugerido {formatCurrency(line.part.suggestedPrice)} · usar
                    </button>
                    {price > 0 ? (
                      <span className={`text-xs font-medium ${lineMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {lineMargin >= 0 ? `Você fica com ${formatCurrency(lineMargin)}` : `Você paga ${formatCurrency(-lineMargin)} do seu bolso`}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="grid gap-1.5 rounded-xl bg-primary/5 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-muted-foreground">Total a cobrar</span>
            <span className="text-2xl font-semibold tabular-nums">{missingPrice ? '—' : formatCurrency(total)}</span>
          </div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground">
            <span>À empresa (preço de técnico)</span>
            <span className="tabular-nums">{formatCurrency(owed)}</span>
          </div>
          {!missingPrice ? (
            <div className="flex justify-between gap-3 text-xs font-medium">
              <span>{margin >= 0 ? 'Você fica com' : 'Você paga do seu bolso'}</span>
              <span className={`tabular-nums ${margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{formatCurrency(Math.abs(margin))}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3">
        <SectionTitle>Cliente</SectionTitle>
        <Field label="WhatsApp do cliente" hint="O link de pagamento e o recibo vão para este número.">
          <PhoneInput value={customerPhone} onChange={setCustomerPhone} hint={null} className={inputClassName} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome (opcional)">
            <input className={inputClassName} value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </Field>
          <Field label="Nº da OS (opcional)">
            <input className={inputClassName} value={orderCode} onChange={(event) => setOrderCode(event.target.value)} />
          </Field>
        </div>
      </section>

      <fieldset className="grid gap-3">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forma de pagamento</legend>
        <div className="grid grid-cols-2 gap-2">
          {paymentMethods.map((value) => {
            const disabled = !mercadoPagoConnected;
            const selected = method === value;
            const Icon = PAYMENT_ICONS[value];
            const tile = PAYMENT_TILE_LABELS[value];
            return (
              <label
                key={value}
                className={`flex min-h-20 cursor-pointer flex-col gap-1 rounded-xl border p-3 text-sm transition has-focus-visible:ring-2 has-focus-visible:ring-ring ${
                  selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/40'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input type="radio" className="sr-only" name="method" value={value} checked={selected} disabled={disabled} onChange={() => setMethod(value)} />
                <Icon className={`h-5 w-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className="font-medium leading-tight">{tile.title}</span>
                <span className="text-xs leading-tight text-muted-foreground">{tile.hint}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="sticky -bottom-4 -mx-4 -mb-4 grid gap-2 border-t bg-card px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6">
        {error ? <Alert>{error}</Alert> : null}
        <Button type="submit" size="lg" disabled={busy || !cart.length || missingPrice || !available.includes(method)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {missingPrice ? 'Informe o valor para cobrar' : `${method === 'cash' ? 'Registrar venda' : 'Gerar cobrança'} · ${formatCurrency(total)}`}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- my sales

function MySales({ paymentMethods, onSaleCanceled }: { paymentMethods: PaymentMethod[]; onSaleCanceled: () => void }) {
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
        <DialogContent className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-md sm:p-6">
          <DialogHeader className="sr-only">
            <DialogTitle>Venda</DialogTitle>
          </DialogHeader>
          {open ? (
            <PaymentPanel
              initialSale={open}
              paymentMethods={paymentMethods}
              // A canceled sale gives the parts back and leaves the account: the stock and "A pagar" tiles above must follow.
              onChanged={(sale) => {
                reload();
                if (sale.status === 'canceled') onSaleCanceled();
              }}
              onClose={() => setOpen(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </DataPanel>
  );
}
