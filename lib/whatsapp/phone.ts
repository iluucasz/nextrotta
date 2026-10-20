/**
 * Brazilian phone parsing shared by the input mask (client), the API validation and the Evolution
 * client. Dependency-free so all three use exactly the same rules.
 */

export const PHONE_EXAMPLE = '(11) 97971-3590';

/** Valid Brazilian DDDs (area codes). Anything else is a typo, not a real number. */
const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Reduces whatever was typed to the national number (DDD + number, no country code): strips
 * spaces, dots, dashes, parentheses, a `+55`/`55` country code and a leading trunk `0`.
 *
 * DDD 55 exists (Santa Maria/RS), so a leading 55 only counts as the country code when it was
 * written with `+`, or when there are more digits than a national number can have.
 */
export function toNationalDigits(value: string | null | undefined) {
  const raw = String(value ?? '').trim();
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('55') && (raw.startsWith('+') || digits.length > 11)) {
    digits = digits.slice(2);
  }

  return digits.replace(/^0+/, '');
}

export type PhoneValidation =
  | { status: 'empty' }
  | { status: 'incomplete'; message: string }
  | { status: 'invalid'; message: string }
  | { status: 'valid'; national: string; e164: string; formatted: string; mobile: boolean };

export function validatePhone(value: string | null | undefined): PhoneValidation {
  const digits = toNationalDigits(value);
  if (!digits) return { status: 'empty' };

  if (digits.length < 10) {
    return { status: 'incomplete', message: `Número incompleto. Use DDD + número, ex.: ${PHONE_EXAMPLE}` };
  }

  if (digits.length > 11) {
    return { status: 'invalid', message: `Dígitos a mais. Use DDD + número, ex.: ${PHONE_EXAMPLE}` };
  }

  const ddd = Number(digits.slice(0, 2));
  if (!VALID_DDDS.has(ddd)) {
    return { status: 'invalid', message: `DDD ${digits.slice(0, 2)} não existe.` };
  }

  let number = digits.slice(2);

  // Old 8-digit mobile format (starting 6-9) — WhatsApp needs the 9th digit.
  if (number.length === 8 && /^[6-9]/.test(number)) {
    number = `9${number}`;
  }

  if (number.length === 9 && !number.startsWith('9')) {
    return { status: 'invalid', message: 'Celular com 9 dígitos deve começar com 9.' };
  }

  if (number.length === 8 && !/^[2-5]/.test(number)) {
    return { status: 'invalid', message: 'Número fixo inválido.' };
  }

  const national = `${digits.slice(0, 2)}${number}`;

  return {
    status: 'valid',
    national,
    e164: `55${national}`,
    formatted: formatNationalDigits(national),
    mobile: number.length === 9,
  };
}

/** Digits only, with country code 55, as Evolution expects — or null when not a valid number. */
export function normalizePhone(value: string | null | undefined): string | null {
  const result = validatePhone(value);
  return result.status === 'valid' ? result.e164 : null;
}

function formatNationalDigits(digits: string) {
  if (digits.length <= 2) return digits ? `(${digits}` : '';

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;

  // 9-digit mobile splits 5-4; while still typing (or for 8-digit landlines) it splits 4-rest.
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Input mask: formats progressively while the user types, whatever format they type in. */
export function formatPhoneInput(value: string) {
  // Capped here, in the mask only: validation reports extra digits instead of silently dropping them.
  return formatNationalDigits(toNationalDigits(value).slice(0, 11));
}

