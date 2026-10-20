/** Thrown for anything the owner did wrong; routes turn it into a 4xx with this message. */
export class PlatformError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export type Actor = { id: string };
