/**
 * Minimal Asaas API client (server only — the key never reaches the browser). The environment
 * comes from ASAAS_ENVIRONMENT: "production" or anything else for the sandbox.
 */

const BASE_URLS = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  production: 'https://api.asaas.com/v3',
};

const ASAAS_TIMEOUT_MS = 25_000;

export class AsaasError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function config() {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) throw new AsaasError('Cobrança não configurada: falta ASAAS_API_KEY.', 503);
  const environment = process.env.ASAAS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  return { apiKey, baseUrl: BASE_URLS[environment] };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { apiKey, baseUrl } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'NextRotta',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      // A gateway that never answers must not hold the page (or the checkout) until the platform kills the function.
      signal: AbortSignal.timeout(ASAAS_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AsaasError('O Asaas demorou para responder. Tente de novo em instantes.', 504);
    }
    throw error;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const description = Array.isArray(data?.errors) && data.errors[0]?.description;
    throw new AsaasError(description || `Asaas respondeu ${response.status}.`, response.status);
  }
  return data as T;
}

export type AsaasBillingType = 'UNDEFINED' | 'BOLETO' | 'PIX' | 'CREDIT_CARD';

export interface AsaasCustomer {
  id: string;
  name: string;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  subscription?: string | null;
  value: number;
  dueDate: string;
  status: string;
  billingType: string;
  invoiceUrl?: string | null;
  description?: string | null;
  externalReference?: string | null;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
}

export interface AsaasSubscription {
  id: string;
  customer: string;
  value: number;
  nextDueDate: string;
  cycle: 'MONTHLY' | 'YEARLY';
  status: string;
}

export function createCustomer(input: {
  name: string;
  cpfCnpj: string;
  email?: string | null;
  mobilePhone?: string | null;
  externalReference: string;
}) {
  return request<AsaasCustomer>('POST', '/customers', { ...input, notificationDisabled: false });
}

export function createPayment(input: {
  customer: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
  billingType?: AsaasBillingType;
}) {
  return request<AsaasPayment>('POST', '/payments', { billingType: 'UNDEFINED', ...input });
}

/** Asaas' way of canceling a charge that is not paid yet. */
export function deletePayment(paymentId: string) {
  return request<{ deleted: boolean }>('DELETE', `/payments/${paymentId}`);
}

export function createSubscription(input: {
  customer: string;
  value: number;
  nextDueDate: string;
  cycle: 'MONTHLY' | 'YEARLY';
  description: string;
  externalReference: string;
  billingType?: AsaasBillingType;
}) {
  return request<AsaasSubscription>('POST', '/subscriptions', { billingType: 'UNDEFINED', ...input });
}

/** Updates the charges already generated and not yet paid too, unless `updatePendingPayments: false`. */
export function updateSubscription(
  subscriptionId: string,
  input: { value?: number; cycle?: 'MONTHLY' | 'YEARLY'; description?: string; updatePendingPayments?: boolean },
) {
  return request<AsaasSubscription>('PUT', `/subscriptions/${subscriptionId}`, { updatePendingPayments: true, ...input });
}

/** Changes one charge that wasn't paid yet. */
export function updatePayment(paymentId: string, input: { value?: number; description?: string }) {
  return request<AsaasPayment>('PUT', `/payments/${paymentId}`, input);
}

/** Asaas' way of canceling a subscription; its paid history stays there. */
export function cancelSubscription(subscriptionId: string) {
  return request<{ deleted: boolean }>('DELETE', `/subscriptions/${subscriptionId}`);
}

export async function listCustomerPayments(customerId: string) {
  const data = await request<{ data: AsaasPayment[] }>('GET', `/payments?customer=${encodeURIComponent(customerId)}&limit=100`);
  return data.data;
}

export function getPayment(paymentId: string) {
  return request<AsaasPayment>('GET', `/payments/${paymentId}`);
}

/** Checks the API key against the gateway; returns the account balance. */
export function getBalance() {
  return request<{ balance: number }>('GET', '/finance/balance');
}

export function asaasEnvironment() {
  return process.env.ASAAS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}
