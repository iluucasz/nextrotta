import { sql } from '../db';
import { brasiliaNow } from '../whatsapp/dates';

/** Thrown for anything the user did wrong; routes turn it into a 4xx with this message. */
export class PartsError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type PartsActor = { id: string; role: string; impersonationId?: string | null };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function currentMonth() {
  return brasiliaNow().monthKey;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function money(value: unknown) {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

export function toIso(value: unknown) {
  return value ? new Date(String(value)).toISOString() : null;
}

/** The technician must exist in this organization (active, unless `allowInactive`). Returns the name. */
export async function requireTechnician(organizationId: string, technicianId: unknown, allowInactive = false) {
  if (!isUuid(technicianId)) throw new PartsError('Técnico inválido.');
  const row = (
    await sql`
      SELECT id, name, phone, status FROM technicians
      WHERE id = ${technicianId} AND organization_id = ${organizationId} AND deleted_at IS NULL
    `
  )[0];
  if (!row) throw new PartsError('Técnico não encontrado.', 404);
  if (!allowInactive && row.status !== 'active') throw new PartsError('Técnico inativo.');
  return { id: String(row.id), name: String(row.name), phone: (row.phone as string | null) ?? null };
}

/** Postgres unique violation: a concurrent insert took the same sequential number — try again. */
export async function withNumberRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code !== '23505' || attempt >= 3) throw error;
    }
  }
}

/**
 * First statement of a transaction that moves units out of a stock: serializes writers of that
 * stock, so the check below sees what the previous writer committed.
 */
export function lockStock(organizationId: string, technicianId: string | null) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${`parts-stock:${organizationId}:${technicianId ?? 'central'}`}::text))`;
}

/**
 * Aborts the whole transaction (error P0409, see `runStockTransaction`) when the stock holds fewer
 * than `quantity` units of the part. Always follows `lockStock` in the same transaction. The check
 * lives in a function (migration 0024) because Postgres folds constant expressions such as
 * `1 / 0` at plan time, which makes a plain CASE-based guard fail even when the stock is enough.
 */
export function requireUnits(organizationId: string, technicianId: string | null, partId: string, quantity: number) {
  return sql`SELECT parts_require_units(${organizationId}::uuid, ${technicianId}::uuid, ${partId}::uuid, ${quantity}::int)`;
}

/** Runs a transaction built with `lockStock`/`requireUnits`, turning a failed guard into a 409. */
export async function runStockTransaction(queries: ReturnType<typeof sql>[]) {
  try {
    await sql.transaction(queries);
  } catch (error) {
    if ((error as { code?: string })?.code === 'P0409') {
      throw new PartsError('O estoque mudou enquanto a operação era registrada. Confira as quantidades e tente de novo.', 409);
    }
    throw error;
  }
}

/** Positive integer quantity, or a PartsError. */
export function parseQuantity(value: unknown, label = 'Quantidade') {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new PartsError(`${label} deve ser um número inteiro maior que zero.`);
  if (number > 100_000) throw new PartsError(`${label} muito alta.`);
  return number;
}
