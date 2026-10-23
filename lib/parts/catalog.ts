import { randomUUID } from 'crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import {
  DEFAULT_PARTS_SETTINGS,
  isPaymentMethod,
  normalizeBarcode,
  parseAmount,
  type Part,
  type PartsSettings,
  type TechnicianPart,
} from './types';
import { isUuid, money, PartsError, type PartsActor } from './common';

// ---------------------------------------------------------------- settings

export async function getPartsSettings(organizationId: string): Promise<PartsSettings> {
  const row = (await sql`SELECT * FROM parts_settings WHERE organization_id = ${organizationId}`)[0];
  if (!row) return { ...DEFAULT_PARTS_SETTINGS, paymentMethods: [...DEFAULT_PARTS_SETTINGS.paymentMethods] };
  return {
    companyName: String(row.company_name ?? ''),
    paymentMethods: (row.payment_methods as string[]).filter(isPaymentMethod),
    receiptFooter: String(row.receipt_footer ?? ''),
    settlementDay: Number(row.settlement_day),
  };
}

/** Name shown to the customer (payment message, receipt, consignment term): the one set in Ajustes, or the organization's own. */
export async function getCompanyName(organizationId: string, settings?: { companyName: string }) {
  const configured = (settings ?? (await getPartsSettings(organizationId))).companyName.trim();
  if (configured) return configured;
  const row = (await sql`SELECT name FROM organizations WHERE id = ${organizationId}`)[0];
  return String(row?.name ?? '');
}

export async function savePartsSettings(organizationId: string, input: Record<string, unknown>, actor: PartsActor) {
  const current = await getPartsSettings(organizationId);
  const paymentMethods = Array.isArray(input.paymentMethods)
    ? Array.from(new Set(input.paymentMethods.filter(isPaymentMethod)))
    : current.paymentMethods;
  if (!paymentMethods.length) throw new PartsError('Deixe ao menos uma forma de pagamento ligada.');
  const companyName = typeof input.companyName === 'string' ? input.companyName.trim().slice(0, 80) : current.companyName;
  const receiptFooter = typeof input.receiptFooter === 'string' ? input.receiptFooter.trim().slice(0, 500) : current.receiptFooter;
  const settlementDay = input.settlementDay === undefined ? current.settlementDay : Number(input.settlementDay);
  if (!Number.isInteger(settlementDay) || settlementDay < 1 || settlementDay > 28) throw new PartsError('Dia do acerto deve ser entre 1 e 28.');

  await sql`
    INSERT INTO parts_settings (organization_id, company_name, payment_methods, receipt_footer, settlement_day, updated_at, updated_by)
    VALUES (${organizationId}, ${companyName}, ${paymentMethods}, ${receiptFooter}, ${settlementDay}, NOW(), ${actor.id})
    ON CONFLICT (organization_id) DO UPDATE
    SET company_name = EXCLUDED.company_name, payment_methods = EXCLUDED.payment_methods, receipt_footer = EXCLUDED.receipt_footer,
        settlement_day = EXCLUDED.settlement_day, updated_at = NOW(), updated_by = EXCLUDED.updated_by
  `;
  return getPartsSettings(organizationId);
}

// ---------------------------------------------------------------- catalog

function imageUrl(row: Record<string, unknown>) {
  return row.image_id ? `/api/parts/${row.id}/image?v=${String(row.image_id).slice(0, 8)}` : null;
}

function toPart(row: Record<string, unknown>): Part {
  return {
    id: String(row.id),
    name: String(row.name),
    barcode: (row.barcode as string | null) ?? null,
    sku: (row.sku as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    unit: String(row.unit ?? 'un'),
    description: (row.description as string | null) ?? null,
    imageUrl: imageUrl(row),
    costPrice: money(row.cost_price),
    technicianPrice: money(row.technician_price),
    suggestedPrice: money(row.suggested_price),
    minStock: row.min_stock === null || row.min_stock === undefined ? null : Number(row.min_stock),
    active: Boolean(row.active),
    centralStock: Number(row.central_stock ?? 0),
    technicianStock: Number(row.technician_stock ?? 0),
  };
}

export async function listParts(organizationId: string): Promise<Part[]> {
  const rows = await sql`
    SELECT p.*,
      COALESCE((SELECT SUM(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NULL), 0)::int AS central_stock,
      COALESCE((SELECT SUM(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NOT NULL), 0)::int AS technician_stock
    FROM parts p
    WHERE p.organization_id = ${organizationId} AND p.deleted_at IS NULL
    ORDER BY p.active DESC, lower(p.name)
  `;
  return rows.map(toPart);
}

export async function getPart(organizationId: string, partId: unknown) {
  if (!isUuid(partId)) throw new PartsError('Peça inválida.');
  const row = (
    await sql`
      SELECT p.*,
        COALESCE((SELECT SUM(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NULL), 0)::int AS central_stock,
        COALESCE((SELECT SUM(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NOT NULL), 0)::int AS technician_stock
      FROM parts p
      WHERE p.id = ${partId} AND p.organization_id = ${organizationId} AND p.deleted_at IS NULL
    `
  )[0];
  if (!row) throw new PartsError('Peça não encontrada.', 404);
  return toPart(row);
}

/** Units of each part per technician (only non-zero), for the admin's stock grid. */
export async function stockByTechnician(organizationId: string) {
  const rows = await sql`
    SELECT m.part_id, m.technician_id, SUM(m.quantity)::int AS quantity
    FROM part_movements m
    WHERE m.organization_id = ${organizationId} AND m.technician_id IS NOT NULL
    GROUP BY m.part_id, m.technician_id
    HAVING SUM(m.quantity) <> 0
  `;
  return rows.map((row) => ({ partId: String(row.part_id), technicianId: String(row.technician_id), quantity: Number(row.quantity) }));
}

/** What a technician sees: parts in their stock, with prices but never the cost. */
export async function listTechnicianParts(organizationId: string, technicianId: string): Promise<TechnicianPart[]> {
  const rows = await sql`
    SELECT p.*, s.quantity AS stock
    FROM parts p
    JOIN (
      SELECT part_id, SUM(quantity)::int AS quantity FROM part_movements
      WHERE organization_id = ${organizationId} AND technician_id = ${technicianId}
      GROUP BY part_id
    ) s ON s.part_id = p.id
    WHERE p.organization_id = ${organizationId} AND p.deleted_at IS NULL AND s.quantity <> 0
    ORDER BY lower(p.name)
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    barcode: (row.barcode as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    unit: String(row.unit ?? 'un'),
    description: (row.description as string | null) ?? null,
    imageUrl: imageUrl(row),
    technicianPrice: money(row.technician_price),
    suggestedPrice: money(row.suggested_price),
    stock: Number(row.stock),
  }));
}

function optionalText(value: unknown, max = 200) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

interface PartInput {
  name: string;
  barcode: string | null;
  sku: string | null;
  category: string | null;
  brand: string | null;
  unit: string;
  description: string | null;
  costPrice: number;
  technicianPrice: number;
  suggestedPrice: number;
  minStock: number | null;
  active: boolean;
}

function parsePartInput(input: Record<string, unknown>, current?: Part): PartInput {
  const pick = <K extends keyof Part>(key: K) => (input[key] === undefined && current ? current[key] : input[key]);
  const name = String(pick('name') ?? '').trim();
  if (!name) throw new PartsError('Informe o nome da peça.');

  const price = (key: 'costPrice' | 'technicianPrice' | 'suggestedPrice', label: string) => {
    const value = parseAmount(pick(key) ?? 0);
    if (value === null) throw new PartsError(`${label} inválido.`);
    return value;
  };
  const costPrice = price('costPrice', 'Preço de custo');
  const technicianPrice = price('technicianPrice', 'Preço para o técnico');
  const suggestedPrice = price('suggestedPrice', 'Preço sugerido');

  const minStockRaw = pick('minStock');
  const minStock = minStockRaw === null || minStockRaw === '' || minStockRaw === undefined ? null : Number(minStockRaw);
  if (minStock !== null && (!Number.isInteger(minStock) || minStock < 0)) throw new PartsError('Estoque mínimo inválido.');

  return {
    name: name.slice(0, 200),
    barcode: normalizeBarcode(pick('barcode')),
    sku: optionalText(pick('sku'), 60),
    category: optionalText(pick('category'), 80),
    brand: optionalText(pick('brand'), 80),
    unit: optionalText(pick('unit'), 10) ?? 'un',
    description: optionalText(pick('description'), 1000),
    costPrice,
    technicianPrice,
    suggestedPrice,
    minStock,
    active: pick('active') === undefined ? true : Boolean(pick('active')),
  };
}

async function assertBarcodeFree(organizationId: string, barcode: string | null, exceptId?: string) {
  if (!barcode) return;
  const row = (
    await sql`
      SELECT name FROM parts
      WHERE organization_id = ${organizationId} AND barcode = ${barcode} AND deleted_at IS NULL
        AND (${exceptId ?? null}::uuid IS NULL OR id <> ${exceptId ?? null}::uuid)
    `
  )[0];
  if (row) throw new PartsError(`O código de barras ${barcode} já é da peça "${row.name}".`, 409);
}

export async function createPart(organizationId: string, input: Record<string, unknown>, actor: PartsActor) {
  const data = parsePartInput(input);
  await assertBarcodeFree(organizationId, data.barcode);
  const id = randomUUID();
  await sql`
    INSERT INTO parts (
      id, organization_id, name, barcode, sku, category, brand, unit, description,
      cost_price, technician_price, suggested_price, min_stock, active, created_by
    )
    VALUES (
      ${id}, ${organizationId}, ${data.name}, ${data.barcode}, ${data.sku}, ${data.category}, ${data.brand}, ${data.unit}, ${data.description},
      ${data.costPrice}, ${data.technicianPrice}, ${data.suggestedPrice}, ${data.minStock}, ${data.active}, ${actor.id}
    )
  `;
  await recordAudit({ organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId, action: 'part.created', targetType: 'part', targetId: id, details: { name: data.name } });
  return getPart(organizationId, id);
}

export async function updatePart(organizationId: string, partId: unknown, input: Record<string, unknown>, actor: PartsActor) {
  const current = await getPart(organizationId, partId);
  const data = parsePartInput(input, current);
  await assertBarcodeFree(organizationId, data.barcode, current.id);
  await sql`
    UPDATE parts SET
      name = ${data.name}, barcode = ${data.barcode}, sku = ${data.sku}, category = ${data.category}, brand = ${data.brand},
      unit = ${data.unit}, description = ${data.description}, cost_price = ${data.costPrice},
      technician_price = ${data.technicianPrice}, suggested_price = ${data.suggestedPrice},
      min_stock = ${data.minStock}, active = ${data.active}, updated_at = NOW()
    WHERE id = ${current.id} AND organization_id = ${organizationId}
  `;
  const priceChanged =
    current.costPrice !== data.costPrice || current.technicianPrice !== data.technicianPrice || current.suggestedPrice !== data.suggestedPrice;
  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    impersonationId: actor.impersonationId,
    action: 'part.updated',
    targetType: 'part',
    targetId: current.id,
    details: priceChanged
      ? { name: data.name, before: { cost: current.costPrice, technician: current.technicianPrice, suggested: current.suggestedPrice }, after: { cost: data.costPrice, technician: data.technicianPrice, suggested: data.suggestedPrice } }
      : { name: data.name },
  });
  return getPart(organizationId, current.id);
}

/** Archived (soft delete). Only with no units anywhere: stock must be returned or adjusted first. */
export async function archivePart(organizationId: string, partId: unknown, actor: PartsActor) {
  const part = await getPart(organizationId, partId);
  if (part.centralStock !== 0 || part.technicianStock !== 0) {
    throw new PartsError('Esta peça ainda tem unidades em estoque. Desative-a em vez de arquivar, ou zere o estoque antes.');
  }
  await sql`UPDATE parts SET deleted_at = NOW(), deleted_by = ${actor.id} WHERE id = ${part.id} AND organization_id = ${organizationId}`;
  await recordAudit({ organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId, action: 'part.archived', targetType: 'part', targetId: part.id, details: { name: part.name } });
}

export async function findPartByBarcode(organizationId: string, barcode: unknown) {
  const code = normalizeBarcode(barcode);
  if (!code) return null;
  const row = (await sql`SELECT id FROM parts WHERE organization_id = ${organizationId} AND barcode = ${code} AND deleted_at IS NULL`)[0];
  return row ? getPart(organizationId, String(row.id)) : null;
}

// ---------------------------------------------------------------- images

export async function savePartImage(
  organizationId: string,
  partId: unknown,
  file: { url: string; contentType: string; size: number },
  actor: PartsActor,
) {
  const part = await getPart(organizationId, partId);
  const id = randomUUID();
  await sql.transaction([
    sql`UPDATE part_images SET replaced_at = NOW() WHERE part_id = ${part.id} AND replaced_at IS NULL`,
    sql`
      INSERT INTO part_images (id, organization_id, part_id, url, content_type, file_size, created_by)
      VALUES (${id}, ${organizationId}, ${part.id}, ${file.url}, ${file.contentType}, ${file.size}, ${actor.id})
    `,
    sql`UPDATE parts SET image_id = ${id}, updated_at = NOW() WHERE id = ${part.id}`,
  ]);
  return getPart(organizationId, part.id);
}

export async function getPartImageFile(organizationId: string, partId: unknown) {
  if (!isUuid(partId)) return null;
  const row = (
    await sql`
      SELECT i.url, i.content_type FROM parts p JOIN part_images i ON i.id = p.image_id
      WHERE p.id = ${partId} AND p.organization_id = ${organizationId}
    `
  )[0];
  return row ? { url: String(row.url), contentType: String(row.content_type) } : null;
}

// ---------------------------------------------------------------- spreadsheet import

export interface ImportRow {
  name?: unknown;
  barcode?: unknown;
  sku?: unknown;
  category?: unknown;
  brand?: unknown;
  unit?: unknown;
  costPrice?: unknown;
  technicianPrice?: unknown;
  suggestedPrice?: unknown;
  minStock?: unknown;
  quantity?: unknown;
}

/**
 * Creates or updates parts from a spreadsheet (matched by barcode, then by exact name) and, when a
 * row has a quantity, enters it into the central stock as a purchase. Validates every row first:
 * nothing is written when any row is wrong.
 */
export async function importParts(organizationId: string, rows: ImportRow[], actor: PartsActor) {
  if (!rows.length) throw new PartsError('A planilha não tem linhas.');
  if (rows.length > 2000) throw new PartsError('Importe no máximo 2.000 linhas por vez.');

  const existing = await listParts(organizationId);
  const byBarcode = new Map(existing.filter((part) => part.barcode).map((part) => [part.barcode as string, part]));
  const byName = new Map(existing.map((part) => [part.name.toLowerCase(), part]));
  const seenBarcodes = new Set<string>();
  const errors: string[] = [];

  const plan = rows.map((row, index) => {
    const line = index + 2;
    try {
      const barcode = normalizeBarcode(row.barcode);
      if (barcode) {
        if (seenBarcodes.has(barcode)) throw new PartsError(`código de barras ${barcode} repetido na planilha`);
        seenBarcodes.add(barcode);
      }
      const match = (barcode && byBarcode.get(barcode)) || byName.get(String(row.name ?? '').trim().toLowerCase());
      const data = parsePartInput(
        {
          name: row.name,
          barcode: barcode ?? match?.barcode ?? null,
          sku: row.sku,
          category: row.category,
          brand: row.brand,
          unit: row.unit,
          costPrice: row.costPrice === undefined || row.costPrice === '' ? match?.costPrice ?? 0 : row.costPrice,
          technicianPrice: row.technicianPrice === undefined || row.technicianPrice === '' ? match?.technicianPrice ?? 0 : row.technicianPrice,
          suggestedPrice: row.suggestedPrice === undefined || row.suggestedPrice === '' ? match?.suggestedPrice ?? 0 : row.suggestedPrice,
          minStock: row.minStock === '' ? undefined : row.minStock,
          active: true,
        },
        match,
      );
      const quantity = row.quantity === undefined || row.quantity === null || row.quantity === '' ? 0 : Number(row.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) throw new PartsError('quantidade inválida');
      return { id: match?.id ?? randomUUID(), isNew: !match, data, quantity };
    } catch (error) {
      errors.push(`Linha ${line}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  if (errors.length) throw new PartsError(errors.slice(0, 15).join('\n') + (errors.length > 15 ? `\n…e mais ${errors.length - 15}.` : ''));

  let created = 0;
  let updated = 0;
  let units = 0;
  const queries = [];
  for (const item of plan) {
    if (!item) continue;
    const { id, data, quantity } = item;
    if (item.isNew) {
      created += 1;
      queries.push(sql`
        INSERT INTO parts (id, organization_id, name, barcode, sku, category, brand, unit, cost_price, technician_price, suggested_price, min_stock, created_by)
        VALUES (${id}, ${organizationId}, ${data.name}, ${data.barcode}, ${data.sku}, ${data.category}, ${data.brand}, ${data.unit},
                ${data.costPrice}, ${data.technicianPrice}, ${data.suggestedPrice}, ${data.minStock}, ${actor.id})
      `);
    } else {
      updated += 1;
      queries.push(sql`
        UPDATE parts SET name = ${data.name}, barcode = ${data.barcode}, sku = ${data.sku}, category = ${data.category}, brand = ${data.brand},
          unit = ${data.unit}, cost_price = ${data.costPrice}, technician_price = ${data.technicianPrice},
          suggested_price = ${data.suggestedPrice}, min_stock = ${data.minStock}, updated_at = NOW()
        WHERE id = ${id} AND organization_id = ${organizationId}
      `);
    }
    if (quantity > 0) {
      units += quantity;
      queries.push(sql`
        INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, note, created_by)
        VALUES (${organizationId}, ${id}, NULL, ${quantity}, 'purchase', ${data.costPrice}, ${data.technicianPrice}, 'Importação de planilha', ${actor.id})
      `);
    }
  }
  await sql.transaction(queries);

  await recordAudit({
    organizationId,
    actorId: actor.id,
    actorRole: actor.role,
    impersonationId: actor.impersonationId,
    action: 'part.imported',
    details: { created, updated, units },
  });
  return { created, updated, units };
}
