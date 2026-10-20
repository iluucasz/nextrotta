import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getRootDomain } from '../tenant-host';

/**
 * Mercado Pago: the platform has ONE application (MERCADOPAGO_CLIENT_ID / _SECRET) and each
 * technician authorizes it on their own Mercado Pago account (OAuth). Sales are then created in the
 * technician's account with their token: the money is theirs, never the organization's nor the
 * platform's.
 */
export function mercadoPagoApp() {
  const clientId = (process.env.MERCADOPAGO_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.MERCADOPAGO_CLIENT_SECRET ?? '').trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function rootOrigin() {
  const root = getRootDomain();
  return `${root.includes('localhost') ? 'http' : 'https'}://${root}`;
}

/** Must match, character by character, the redirect URL registered in the Mercado Pago application. */
export function mercadoPagoRedirectUri() {
  return (process.env.MERCADOPAGO_REDIRECT_URI ?? '').trim() || `${rootOrigin()}/api/mercadopago/oauth/callback`;
}

/**
 * Where Mercado Pago sends payment notifications. Null on a local domain: Mercado Pago can't reach
 * it (and rejects it), so status then comes only from the screens checking the payment.
 */
export function mercadoPagoNotificationUrl() {
  const configured = (process.env.MERCADOPAGO_WEBHOOK_URL ?? '').trim();
  if (configured) return configured;
  const origin = rootOrigin();
  return origin.startsWith('https://') ? `${origin}/api/webhooks/mercadopago` : null;
}

/** Secret of the application's webhook ("assinatura secreta"), to validate x-signature. */
export function mercadoPagoWebhookSecret() {
  return (process.env.MERCADOPAGO_WEBHOOK_SECRET ?? '').trim() || null;
}

/**
 * Pix orders require a payer e-mail and the technician rarely has the customer's. Used when the sale
 * has none; it can't be the technician's own (Mercado Pago refuses a payer equal to the receiver).
 */
export function fallbackPayerEmail() {
  const configured = (process.env.MERCADOPAGO_FALLBACK_PAYER_EMAIL ?? '').trim();
  if (configured) return configured;
  const root = getRootDomain().replace(/:\d+$/, '');
  return `pagador@${root.includes('localhost') ? 'nextrotta.com.br' : root}`;
}

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Validated lazily, like lib/porto-crypto.ts: a missing key fails only the Mercado Pago requests.
function tokenKey(): Buffer {
  const key = process.env.MERCADOPAGO_TOKEN_KEY;
  if (!key) throw new Error('MERCADOPAGO_TOKEN_KEY is not set');
  const buffer = Buffer.from(key, 'base64');
  if (buffer.length !== 32) {
    throw new Error('MERCADOPAGO_TOKEN_KEY must decode to exactly 32 bytes (base64) — generate one with: openssl rand -base64 32');
  }
  return buffer;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), raw.subarray(0, IV_LENGTH));
  decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
  return Buffer.concat([decipher.update(raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)), decipher.final()]).toString('utf8');
}

/** What is missing for technicians to connect their accounts; empty when ready. */
export function mercadoPagoMissingConfig() {
  const missing: string[] = [];
  if (!process.env.MERCADOPAGO_CLIENT_ID) missing.push('MERCADOPAGO_CLIENT_ID');
  if (!process.env.MERCADOPAGO_CLIENT_SECRET) missing.push('MERCADOPAGO_CLIENT_SECRET');
  if (!process.env.MERCADOPAGO_TOKEN_KEY) missing.push('MERCADOPAGO_TOKEN_KEY');
  return missing;
}
