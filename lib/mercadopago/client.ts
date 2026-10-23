/**
 * Minimal Mercado Pago REST client — plain fetch, no SDK. Every call that moves money uses the
 * technician's own access token (from OAuth); only the OAuth exchange uses the platform's app.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mercadoPagoApp, mercadoPagoRedirectUri } from './config';

const API = 'https://api.mercadopago.com';
const AUTH = 'https://auth.mercadopago.com/authorization';
const TIMEOUT_MS = 15_000;

export class MercadoPagoError extends Error {
  constructor(message: string, public status = 502, public body: unknown = null) {
    super(message);
  }
}

type Json = Record<string, unknown>;

function describe(body: unknown, status: number) {
  if (body && typeof body === 'object') {
    const data = body as Json;
    // Orders API failures ("The following transactions failed") keep the real reason in `details`.
    const errors = Array.isArray(data.errors)
      ? (data.errors as Json[]).flatMap((e) => [e.message ?? e.code, ...(Array.isArray(e.details) ? (e.details as unknown[]).map((item) => (typeof item === 'string' ? item : JSON.stringify(item))) : [])]).filter(Boolean)
      : [];
    const cause = Array.isArray(data.cause) ? (data.cause as Json[]).map((c) => c.description ?? c.code).filter(Boolean) : [];
    const detail = [data.message, data.error_description, ...errors, ...cause].filter(Boolean).join(' · ');
    // A payment refused with nothing but the generic text: show the raw answer so the cause can be found.
    if (status === 402 && !errors.some((item) => String(item).includes(':'))) return `Mercado Pago (${status}): ${detail || 'cobrança recusada'} — ${JSON.stringify(body).slice(0, 400)}`;
    if (detail) return `Mercado Pago (${status}): ${detail}`;
  }
  return `Mercado Pago respondeu ${status}.`;
}

async function request<T = Json>(path: string, init: RequestInit & { token?: string; idempotencyKey?: string } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const { token, idempotencyKey, headers, ...rest } = init;

  try {
    const response = await fetch(`${API}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        ...(headers ?? {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      // x-request-id is what Mercado Pago's support asks for when a payment fails with "processing_error".
      console.error(
        '[mercadopago]',
        rest.method ?? 'GET',
        path,
        response.status,
        `x-request-id=${response.headers.get('x-request-id') ?? 'n/a'}`,
        typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 900),
      );
      throw new MercadoPagoError(describe(body, response.status), response.status === 401 ? 401 : 502, body);
    }
    return body as T;
  } catch (error) {
    if (error instanceof MercadoPagoError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new MercadoPagoError('Tempo limite ao chamar o Mercado Pago.');
    throw new MercadoPagoError(`Erro ao chamar o Mercado Pago: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------- OAuth

export function createPkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizationUrl(state: string, codeChallenge: string) {
  const app = mercadoPagoApp();
  if (!app) throw new MercadoPagoError('Mercado Pago não configurado na plataforma.', 503);
  const params = new URLSearchParams({
    client_id: app.clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: mercadoPagoRedirectUri(),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH}?${params.toString()}`;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  public_key?: string;
  user_id: number | string;
  expires_in?: number;
  live_mode?: boolean;
  scope?: string;
}

export async function exchangeAuthorizationCode(code: string, codeVerifier: string) {
  const app = mercadoPagoApp();
  if (!app) throw new MercadoPagoError('Mercado Pago não configurado na plataforma.', 503);
  return request<OAuthTokens>('/oauth/token', {
    method: 'POST',
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: mercadoPagoRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });
}

export async function refreshAccessToken(refreshToken: string) {
  const app = mercadoPagoApp();
  if (!app) throw new MercadoPagoError('Mercado Pago não configurado na plataforma.', 503);
  return request<OAuthTokens>('/oauth/token', {
    method: 'POST',
    body: JSON.stringify({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
}

export async function getAccountUser(token: string) {
  return request<{ id: number; nickname?: string; email?: string; first_name?: string; last_name?: string }>('/users/me', { token });
}

// ---------------------------------------------------------------- Orders (Pix and Point)

export interface MercadoPagoOrder {
  id: string;
  status?: string;
  status_detail?: string;
  external_reference?: string;
  total_amount?: string;
  transactions?: {
    payments?: Array<{
      id?: string;
      status?: string;
      status_detail?: string;
      amount?: string;
      paid_amount?: string;
      reference_id?: string;
      date_of_expiration?: string;
      payment_method?: { id?: string; type?: string; ticket_url?: string; qr_code?: string; qr_code_base64?: string };
    }>;
  };
}

function amountString(value: number) {
  return value.toFixed(2);
}

export async function createPixOrder(
  token: string,
  input: { reference: string; amount: number; description: string; payerEmail: string; payerFirstName?: string; expirationMinutes: number; attempt: number },
) {
  return request<MercadoPagoOrder>('/v1/orders', {
    method: 'POST',
    token,
    // Per attempt: a retry after an expired or canceled order must create a new one, not get the old one back.
    idempotencyKey: `pix-${input.reference}-${input.attempt}`,
    body: JSON.stringify({
      type: 'online',
      total_amount: amountString(input.amount),
      external_reference: input.reference,
      processing_mode: 'automatic',
      description: input.description.slice(0, 150),
      transactions: {
        payments: [
          {
            amount: amountString(input.amount),
            payment_method: { id: 'pix', type: 'bank_transfer' },
            expiration_time: `PT${Math.max(30, input.expirationMinutes)}M`,
          },
        ],
      },
      payer: { email: input.payerEmail, ...(input.payerFirstName ? { first_name: input.payerFirstName.slice(0, 60) } : {}) },
    }),
  });
}

export async function createPointOrder(
  token: string,
  input: { reference: string; amount: number; description: string; terminalId: string; attempt: number },
) {
  return request<MercadoPagoOrder>('/v1/orders', {
    method: 'POST',
    token,
    idempotencyKey: `point-${input.reference}-${input.attempt}`,
    body: JSON.stringify({
      type: 'point',
      external_reference: input.reference,
      expiration_time: 'PT15M',
      description: input.description.slice(0, 150),
      transactions: { payments: [{ amount: amountString(input.amount) }] },
      config: { point: { terminal_id: input.terminalId, print_on_terminal: 'no_ticket' } },
    }),
  });
}

export async function getOrder(token: string, orderId: string) {
  return request<MercadoPagoOrder>(`/v1/orders/${encodeURIComponent(orderId)}`, { token });
}

export async function cancelOrder(token: string, orderId: string) {
  return request<MercadoPagoOrder>(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    token,
    idempotencyKey: `cancel-${orderId}`,
    headers: { 'x-allow-cancelable-status': 'at_terminal' },
  });
}

/** Paid / failed / still open, from an order of either type. */
export function orderOutcome(order: MercadoPagoOrder): 'paid' | 'failed' | 'pending' {
  const status = (order.status ?? '').toLowerCase();
  const payments = order.transactions?.payments ?? [];
  const paid =
    status === 'processed' ||
    payments.some((payment) => ['processed', 'approved', 'accredited'].includes((payment.status ?? '').toLowerCase()));
  if (paid) return 'paid';
  if (['canceled', 'cancelled', 'expired', 'failed', 'refunded'].includes(status)) return 'failed';
  return 'pending';
}

// ---------------------------------------------------------------- Point terminals

export interface MercadoPagoTerminal {
  id: string;
  pos_id?: number;
  store_id?: string;
  external_pos_id?: string;
  operating_mode?: string;
}

export async function listTerminals(token: string) {
  const body = await request<{ data?: { terminals?: MercadoPagoTerminal[] } }>('/terminals/v1/list?limit=50', { token });
  return body.data?.terminals ?? [];
}

export async function setTerminalPdvMode(token: string, terminalId: string) {
  return request('/terminals/v1/setup', {
    method: 'PATCH',
    token,
    body: JSON.stringify({ terminals: [{ id: terminalId, operating_mode: 'PDV' }] }),
  });
}

// ---------------------------------------------------------------- Checkout Pro (payment link)

export async function createPaymentLink(
  token: string,
  input: {
    reference: string;
    items: Array<{ id: string; title: string; quantity: number; unitPrice: number }>;
    notificationUrl: string | null;
    expiresAt: Date;
    attempt: number;
  },
) {
  return request<{ id: string; init_point: string; sandbox_init_point?: string }>('/checkout/preferences', {
    method: 'POST',
    token,
    idempotencyKey: `link-${input.reference}-${input.attempt}`,
    body: JSON.stringify({
      items: input.items.map((item) => ({
        id: item.id,
        title: item.title.slice(0, 250),
        quantity: item.quantity,
        unit_price: Number(item.unitPrice.toFixed(2)),
        currency_id: 'BRL',
      })),
      external_reference: input.reference,
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      expires: true,
      expiration_date_to: input.expiresAt.toISOString().replace('Z', '-00:00'),
      // A boleto takes days to clear: not a way to pay at the customer's door.
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }] },
    }),
  });
}

// ---------------------------------------------------------------- Payments

export interface MercadoPagoPayment {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  external_reference?: string | null;
  date_created?: string;
  date_approved?: string | null;
  description?: string | null;
  payment_type_id?: string;
  point_of_interaction?: { type?: string } | null;
}

export async function getPayment(token: string, paymentId: string) {
  return request<MercadoPagoPayment>(`/v1/payments/${encodeURIComponent(paymentId)}`, { token });
}

export async function searchPaymentsByReference(token: string, reference: string) {
  const params = new URLSearchParams({ external_reference: reference, sort: 'date_created', criteria: 'desc', limit: '20' });
  const body = await request<{ results?: MercadoPagoPayment[] }>(`/v1/payments/search?${params.toString()}`, { token });
  return body.results ?? [];
}

/** Approved payments of the last `hours` (e.g. charged in the Mercado Pago app with Point Tap). */
export async function searchRecentApprovedPayments(token: string, hours: number) {
  const params = new URLSearchParams({
    sort: 'date_created',
    criteria: 'desc',
    range: 'date_created',
    begin_date: `NOW-${hours}HOURS`,
    end_date: 'NOW',
    status: 'approved',
    limit: '50',
  });
  const body = await request<{ results?: MercadoPagoPayment[] }>(`/v1/payments/search?${params.toString()}`, { token });
  return body.results ?? [];
}

// ---------------------------------------------------------------- Webhook signature

/**
 * Validates the x-signature header ("ts=...,v1=...") Mercado Pago signs each notification with:
 * HMAC-SHA256 of "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" with the application's secret.
 */
export function verifyWebhookSignature(input: { signature: string | null; requestId: string | null; dataId: string | null; secret: string }) {
  if (!input.signature) return false;
  const parts = Object.fromEntries(
    input.signature.split(',').map((part) => {
      const [key, ...value] = part.split('=');
      return [key.trim(), value.join('=').trim()];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  let manifest = '';
  if (input.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac('sha256', input.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}
