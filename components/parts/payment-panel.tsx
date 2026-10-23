'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, MessageCircle, RefreshCw, Smartphone, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/formatters';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/parts/types';
import type { Sale } from '@/lib/parts/sales';
import { Alert, Field, inputClassName, partsApi } from './shared';

export interface Delivery {
  whatsapp: { status: 'sent' | 'failed' | 'unavailable' | 'duplicate'; error: string | null; shareUrl: string | null } | null;
  shareUrl: string | null;
}

const POLL_MS = 4000;

// The raw Evolution API answer (JSON) is for the admin's WhatsApp history, not for the technician.
function friendlyDeliveryError(error: string | null) {
  if (!error) return '';
  if (/^Evolution API/i.test(error) || error.includes('{')) return 'Não foi possível enviar pelo WhatsApp da empresa.';
  return error;
}

function DeliveryNote({ delivery, what }: { delivery: Delivery | null; what: string }) {
  if (!delivery) return null;
  const status = delivery.whatsapp?.status;
  return (
    <div className="grid gap-2">
      {status === 'sent' ? (
        <Alert tone="success">{what} enviado para o WhatsApp do cliente.</Alert>
      ) : (
        <Alert tone="warning">
          {delivery.whatsapp?.error ? `${friendlyDeliveryError(delivery.whatsapp.error)} ` : ''}Envie pelo seu WhatsApp:
        </Alert>
      )}
      {status !== 'sent' && delivery.shareUrl ? (
        <Button asChild variant="outline">
          <a href={delivery.shareUrl} target="_blank" rel="noreferrer">
            <MessageCircle className="h-4 w-4" />
            Enviar pelo meu WhatsApp
          </a>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Charging one sale: shows what the method needs (Pix QR, link, Point instructions, cash), checks
 * Mercado Pago every few seconds and turns into the receipt once paid.
 */
export function PaymentPanel({
  initialSale,
  initialDelivery = null,
  paymentMethods,
  onChanged,
  onClose,
}: {
  initialSale: Sale;
  initialDelivery?: Delivery | null;
  paymentMethods: PaymentMethod[];
  onChanged?: (sale: Sale) => void;
  onClose: () => void;
}) {
  const [sale, setSale] = useState(initialSale);
  const [linkDelivery, setLinkDelivery] = useState<Delivery | null>(initialDelivery);
  const [receiptDelivery, setReceiptDelivery] = useState<Delivery | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [newMethod, setNewMethod] = useState<PaymentMethod>(initialSale.paymentMethod);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  function update(next: Sale) {
    setSale(next);
    onChangedRef.current?.(next);
  }

  const waitingMercadoPago =
    sale.status === 'awaiting_payment' &&
    !sale.paymentError &&
    (sale.paymentMethod === 'pix' || sale.paymentMethod === 'card_link' || (sale.paymentMethod === 'card_present' && sale.sentToTerminal));

  // A Pix QR Code lasts an hour and a payment link a day: say so when it is over, with a way to get a new one.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const expired =
    sale.status === 'awaiting_payment' &&
    !sale.paymentError &&
    (sale.paymentMethod === 'pix' || sale.paymentMethod === 'card_link') &&
    Boolean(sale.paymentExpiresAt) &&
    new Date(sale.paymentExpiresAt!).getTime() < now;

  // Polls while the customer pays (the webhook does the same on the server when it is reachable).
  useEffect(() => {
    if (!waitingMercadoPago) return;
    let active = true;
    const timer = setInterval(async () => {
      try {
        const result = await partsApi<{ sale: Sale; found: boolean }>(`/api/parts/sales/${sale.id}`, { method: 'POST', json: { action: 'check' } });
        if (active && result.sale.status !== 'awaiting_payment') update(result.sale);
      } catch {
        // Next tick tries again.
      }
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingMercadoPago, sale.id]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError('');
    setNotice('');
    try {
      const result = await partsApi<{ sale?: Sale; found?: boolean; delivery?: Delivery }>(`/api/parts/sales/${sale.id}`, {
        method: 'POST',
        json: { action, ...extra },
      });
      if (result.sale) update(result.sale);
      if (action === 'check' && result.found === false) {
        setNotice(
          sale.paymentMethod === 'card_present' && !sale.sentToTerminal
            ? 'Ainda não encontramos um pagamento aprovado deste valor na sua conta do Mercado Pago. Confira no app e tente de novo.'
            : 'O pagamento ainda não foi confirmado.',
        );
      }
      if (action === 'send-link' || action === 'retry') setLinkDelivery(result.delivery ?? null);
      if (action === 'send-receipt') setReceiptDelivery(result.delivery ?? null);
      if (action === 'cancel') setShowCancel(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Não foi possível copiar. Segure o texto para copiar.');
    }
  }

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-muted-foreground">Venda nº {sale.number}{sale.customerName ? ` · ${sale.customerName}` : ''}</p>
        <p className="text-2xl font-semibold tracking-tight">{formatCurrency(sale.totalAmount)}</p>
        <p className="text-xs text-muted-foreground">{sale.paymentMethodLabel}</p>
      </div>
    </div>
  );

  if (sale.status === 'paid') {
    return (
      <div className="grid gap-4">
        {header}
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <CheckCircle2 className="h-8 w-8 shrink-0" />
          <div>
            <p className="font-semibold">Pagamento confirmado</p>
            <p className="text-sm">
              {sale.paymentConfirmedBy === 'mercadopago' ? 'Confirmado pelo Mercado Pago.' : 'Marcado como recebido por você.'}{' '}
              {sale.receiptSentAt ? 'Recibo enviado ao cliente pelo WhatsApp.' : ''}
            </p>
          </div>
        </div>
        <DeliveryNote delivery={receiptDelivery} what="Recibo" />
        {!sale.receiptSentAt && !receiptDelivery ? (
          <Button variant="outline" onClick={() => act('send-receipt')} disabled={busy !== null}>
            {busy === 'send-receipt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            Enviar recibo
          </Button>
        ) : null}
        <Button onClick={onClose}>Concluir</Button>
      </div>
    );
  }

  if (sale.status === 'canceled') {
    return (
      <div className="grid gap-4">
        {header}
        <Alert tone="warning">Venda cancelada{sale.cancelReason ? `: ${sale.cancelReason}` : ''}. As peças voltaram para o seu estoque.</Alert>
        <Button onClick={onClose}>Fechar</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {header}
      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="info">{notice}</Alert> : null}

      {expired ? (
        <div className="grid gap-2">
          <Alert tone="warning">{sale.paymentMethod === 'pix' ? 'Este QR Code expirou: o cliente não consegue mais pagar por ele.' : 'Este link expirou: o cliente não consegue mais pagar por ele.'}</Alert>
          <Button onClick={() => act('retry', { paymentMethod: sale.paymentMethod })} disabled={busy !== null}>
            {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {sale.paymentMethod === 'pix' ? 'Gerar novo QR Code' : 'Gerar novo link'}
          </Button>
        </div>
      ) : null}

      {sale.paymentError ? (
        <div className="grid gap-3">
          <Alert>Não foi possível criar a cobrança: {sale.paymentError}</Alert>
          <Field label="Forma de pagamento">
            <select className={inputClassName} value={newMethod} onChange={(event) => setNewMethod(event.target.value as PaymentMethod)}>
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABELS[method]}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={() => act('retry', { paymentMethod: newMethod })} disabled={busy !== null}>
            {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {!sale.paymentError && sale.paymentMethod === 'pix' ? (
        <div className="grid gap-3">
          {sale.pixQrBase64 ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`data:image/png;base64,${sale.pixQrBase64}`} alt="QR Code do Pix" className="mx-auto aspect-square w-full max-w-64 rounded-lg border bg-white p-2" />
          ) : null}
          <p className="text-center text-sm text-muted-foreground">O cliente lê o QR Code no app do banco.</p>
          {sale.pixQrCode ? (
            <Button variant="outline" onClick={() => copy(sale.pixQrCode!)}>
              <Copy className="h-4 w-4" />
              {copied ? 'Copiado!' : 'Copiar Pix copia e cola'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!sale.paymentError && sale.paymentMethod === 'card_link' && sale.paymentUrl ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">O cliente paga com cartão pelo link (no celular dele ou neste).</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => copy(sale.paymentUrl!)}>
              <Copy className="h-4 w-4" />
              {copied ? 'Copiado!' : 'Copiar link'}
            </Button>
            <Button asChild variant="outline">
              <a href={sale.paymentUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Abrir aqui
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      {!sale.paymentError && sale.paymentMethod === 'card_present' ? (
        sale.sentToTerminal ? (
          <Alert tone="info">Cobrança enviada para a sua maquininha. Peça para o cliente aproximar ou inserir o cartão.</Alert>
        ) : (
          <div className="grid gap-3">
            <div className="flex gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
              <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <ol className="list-decimal space-y-1 pl-4">
                <li>Abra o app do Mercado Pago e toque em <strong>Cobrar</strong> (Point Tap no celular ou sua maquininha).</li>
                <li>Cobre <strong>{formatCurrency(sale.totalAmount)}</strong>.</li>
                <li>Depois de aprovado, volte aqui e toque em <strong>Conferir pagamento</strong>.</li>
              </ol>
            </div>
            <Button onClick={() => act('check')} disabled={busy !== null}>
              {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Conferir pagamento
            </Button>
          </div>
        )
      ) : null}

      {sale.paymentMethod === 'cash' ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Receba o valor do cliente e confirme aqui. O recibo vai para o WhatsApp dele.</p>
          <Button onClick={() => act('confirm')} disabled={busy !== null}>
            {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Recebi {formatCurrency(sale.totalAmount)}
          </Button>
        </div>
      ) : null}

      {waitingMercadoPago && !expired ? (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Aguardando o pagamento…
        </p>
      ) : null}

      {(sale.paymentMethod === 'pix' || sale.paymentMethod === 'card_link') && !sale.paymentError ? (
        <div className="grid gap-2">
          <DeliveryNote delivery={linkDelivery} what="Link de pagamento" />
          {linkDelivery?.whatsapp?.status === 'sent' || sale.paymentLinkSentAt ? null : (
            <Button variant="ghost" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 text-center" onClick={() => act('send-link')} disabled={busy !== null}>
              <MessageCircle className="h-4 w-4 shrink-0" />
              Enviar o pagamento pelo WhatsApp da empresa
            </Button>
          )}
        </div>
      ) : null}

      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer select-none text-muted-foreground">Outras opções</summary>
        <div className="mt-3 grid gap-2">
          {sale.paymentMethod !== 'cash' ? (
            <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 text-center" onClick={() => act('confirm')} disabled={busy !== null}>
              Recebi de outra forma (dinheiro ou fora do sistema)
            </Button>
          ) : null}
          {!sale.paymentError ? (
            <div className="flex gap-2">
              <select className={inputClassName} value={newMethod} onChange={(event) => setNewMethod(event.target.value as PaymentMethod)} aria-label="Trocar forma de pagamento">
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={() => act('retry', { paymentMethod: newMethod })} disabled={busy !== null}>
                Trocar
              </Button>
            </div>
          ) : null}
          {showCancel ? (
            <div className="grid gap-2">
              <input className={inputClassName} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Motivo do cancelamento" />
              <Button variant="destructive" size="sm" onClick={() => act('cancel', { reason: cancelReason })} disabled={busy !== null || !cancelReason.trim()}>
                <XCircle className="h-4 w-4" />
                Confirmar cancelamento
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="h-auto min-h-8 whitespace-normal py-1.5 text-center text-rose-700" onClick={() => setShowCancel(true)}>
              Cancelar venda (as peças voltam para o seu estoque)
            </Button>
          )}
        </div>
      </details>
    </div>
  );
}

