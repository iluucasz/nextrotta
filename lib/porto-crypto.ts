import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Validated lazily (on first encrypt/decrypt call), not at module import time. Several route.ts
// files import this module, and Next.js evaluates route module scope during `next build`'s page
// data collection — throwing here at import time would fail the whole build in any environment
// (a preview deploy, CI, another engineer's machine) that hasn't yet been given
// PORTO_CREDENTIALS_KEY, rather than only failing the Porto-specific request that needs it.
function getKeyBuffer(): Buffer {
  const key = process.env.PORTO_CREDENTIALS_KEY;
  if (!key) {
    throw new Error('PORTO_CREDENTIALS_KEY is not set');
  }

  const keyBuffer = Buffer.from(key, 'base64');
  if (keyBuffer.length !== 32) {
    throw new Error('PORTO_CREDENTIALS_KEY must decode to exactly 32 bytes (base64) — generate one with: openssl rand -base64 32');
  }

  return keyBuffer;
}

export function encryptPortoPassword(plaintext: string): string {
  const keyBuffer = getKeyBuffer();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyBuffer, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptPortoPassword(encoded: string): string {
  const keyBuffer = getKeyBuffer();
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
