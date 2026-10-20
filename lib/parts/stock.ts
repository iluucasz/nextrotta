import { randomUUID } from 'crypto';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { createDebt } from './account';
import { currentMonth, isMonthKey, isUuid, money, parseQuantity, PartsError, requireTechnician, toIso, withNumberRetry, type PartsActor } from './common';
import { findPartByBarcode } from './catalog';
import { MOVEMENT_KIND_LABELS, type MovementKind } from './types';

/** Units of each part in one stock (technicianId null = central). */
export async function getStock(organizationId: string, technicianId: string | null, partIds?: string[]) {
  const rows = await sql`
    SELECT part_id, SUM(quantity)::int AS quantity
    FROM part_movements
    WHERE organization_id = ${organizationId}
      AND technician_id IS NOT DISTINCT FROM ${technicianId}::uuid
      AND (${partIds ?? null}::uuid[] IS NULL OR part_id = ANY(${partIds ?? null}::uuid[]))
    GROUP BY part_id
  `;
  return new Map(rows.map((row) => [String(row.part_id), Number(row.quantity)]));
}

interface ItemInput {
  partId: string;
  quantity: number;
}

/** Validates a list of {partId, quantity}, merging repeated parts. */
export function parseItems(value: unknown): ItemInput[] {
  if (!Array.isArray(value) || !value.length) throw new PartsError('Adicione ao menos uma peça.');
  const merged = new Map<string, number>();
  for (const item of value as Array<Record<string, unknown>>) {
    if (!isUuid(item?.partId)) throw new PartsError('Peça inválida na lista.');
    merged.set(item.partId, (merged.get(item.partId) ?? 0) + parseQuantity(item.quantity));
  }
  return Array.from(merged, ([partId, quantity]) => ({ partId, quantity }));
}

async function loadParts(organizationId: string, partIds: string[]) {
  const rows = await sql`
    SELECT id, name, cost_price, technician_price, suggested_price FROM parts
    WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND id = ANY(${partIds}::uuid[])
  `;
  const parts = new Map(rows.map((row) => [String(row.id), row]));
  for (const id of partIds) if (!parts.has(id)) throw new PartsError('Uma das peças não foi encontrada.', 404);
  return parts;
}

function assertAvailable(items: ItemInput[], stock: Map<string, number>, parts: Map<string, Record<string, unknown>>, where: string) {
  const missing = items.filter((item) => (stock.get(item.partId) ?? 0) < item.quantity);
  if (missing.length) {
    throw new PartsError(
      `Estoque insuficiente ${where}: ` +
        missing.map((item) => `${parts.get(item.partId)?.name} (tem ${stock.get(item.partId) ?? 0}, pediu ${item.quantity})`).join('; '),
      409,
    );
  }
}

// ---------------------------------------------------------------- central stock

/** Units bought by the organization, into the central stock. Optionally updates the part's cost. */
export async function addPurchase(
  organizationId: string,
  input: { items: unknown; note?: unknown; updateCost?: unknown },
  actor: PartsActor,
) {
  const raw = Array.isArray(input.items) ? (input.items as Array<Record<string, unknown>>) : [];
  const items = parseItems(raw);
  const parts = await loadParts(organizationId, items.map((item) => item.partId));
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
  const unitCosts = new Map(
    raw.map((item) => [String(item.partId), item.unitCost === undefined || item.unitCost === '' ? null : Number(item.unitCost)]),
  );

  const queries = items.flatMap((item) => {
    const part = parts.get(item.partId)!;
    const unitCost = unitCosts.get(item.partId);
    const cost = unitCost !== null && unitCost !== undefined && Number.isFinite(unitCost) && unitCost >= 0 ? money(unitCost) : money(part.cost_price);
    const list = [
      sql`
        INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, note, created_by)
        VALUES (${organizationId}, ${item.partId}, NULL, ${item.quantity}, 'purchase', ${cost}, ${money(part.technician_price)}, ${note}, ${actor.id})
      `,
    ];
    if (input.updateCost && cost !== money(part.cost_price)) {
      list.push(sql`UPDATE parts SET cost_price = ${cost}, updated_at = NOW() WHERE id = ${item.partId} AND organization_id = ${organizationId}`);
    }
    return list;
  });
  await sql.transaction(queries);
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.stock_purchase', details: { items: items.length, units: items.reduce((sum, item) => sum + item.quantity, 0) },
  });
}

/** Manual correction of one stock (central or a technician's), always with a reason. */
export async function adjustStock(
  organizationId: string,
  input: { partId: unknown; technicianId?: unknown; quantity: unknown; note: unknown },
  actor: PartsActor,
) {
  if (!isUuid(input.partId)) throw new PartsError('Peça inválida.');
  const technicianId = input.technicianId ? (await requireTechnician(organizationId, input.technicianId, true)).id : null;
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity === 0) throw new PartsError('Informe quantas unidades entram (+) ou saem (−).');
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 300) : '';
  if (!note) throw new PartsError('Informe o motivo do ajuste.');
  const parts = await loadParts(organizationId, [input.partId]);
  if (quantity < 0) {
    const stock = await getStock(organizationId, technicianId, [input.partId]);
    assertAvailable([{ partId: input.partId, quantity: -quantity }], stock, parts, technicianId ? 'com o técnico' : 'no estoque central');
  }
  const part = parts.get(input.partId)!;
  await sql`
    INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, note, created_by)
    VALUES (${organizationId}, ${input.partId}, ${technicianId}, ${quantity}, 'adjustment', ${money(part.cost_price)}, ${money(part.technician_price)}, ${note}, ${actor.id})
  `;
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.stock_adjusted', targetType: 'part', targetId: input.partId, details: { technicianId, quantity, note },
  });
}

// ---------------------------------------------------------------- transfers (remessas e devoluções)

/**
 * Moves parts between the central stock and a technician: 'out' hands them over under consignment,
 * 'return' brings them back. Two movements per part (one leaves, one enters) plus the transfer
 * record the technician confirms.
 */
export async function createTransfer(
  organizationId: string,
  input: { technicianId: unknown; direction: unknown; items: unknown; note?: unknown },
  actor: PartsActor,
) {
  const technician = await requireTechnician(organizationId, input.technicianId, input.direction === 'return');
  const direction = input.direction === 'return' ? 'return' : input.direction === 'out' ? 'out' : null;
  if (!direction) throw new PartsError('Tipo de movimentação inválido.');
  const items = parseItems(input.items);
  const partIds = items.map((item) => item.partId);
  const parts = await loadParts(organizationId, partIds);
  const source = direction === 'out' ? null : technician.id;
  const target = direction === 'out' ? technician.id : null;
  assertAvailable(items, await getStock(organizationId, source, partIds), parts, direction === 'out' ? 'no estoque central' : 'com o técnico');

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  const totalTechnician = money(items.reduce((sum, item) => sum + item.quantity * Number(parts.get(item.partId)!.technician_price), 0));
  const totalCost = money(items.reduce((sum, item) => sum + item.quantity * Number(parts.get(item.partId)!.cost_price), 0));

  return withNumberRetry(async () => {
    const id = randomUUID();
    await sql.transaction([
      sql`
        INSERT INTO part_transfers (id, organization_id, number, technician_id, direction, total_technician_price, total_cost, note, created_by)
        VALUES (
          ${id}, ${organizationId},
          (SELECT COALESCE(MAX(number), 0) + 1 FROM part_transfers WHERE organization_id = ${organizationId}),
          ${technician.id}, ${direction}, ${totalTechnician}, ${totalCost}, ${note}, ${actor.id}
        )
      `,
      ...items.flatMap((item) => {
        const part = parts.get(item.partId)!;
        return [
          sql`
            INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, transfer_id, created_by)
            VALUES (${organizationId}, ${item.partId}, ${source}, ${-item.quantity}, 'transfer', ${money(part.cost_price)}, ${money(part.technician_price)}, ${id}, ${actor.id})
          `,
          sql`
            INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, transfer_id, created_by)
            VALUES (${organizationId}, ${item.partId}, ${target}, ${item.quantity}, 'transfer', ${money(part.cost_price)}, ${money(part.technician_price)}, ${id}, ${actor.id})
          `,
        ];
      }),
    ]);
    await recordAudit({
      organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
      action: direction === 'out' ? 'part.transfer_out' : 'part.transfer_return', targetType: 'part_transfer', targetId: id,
      details: { technicianId: technician.id, items: items.length, totalTechnician },
    });
    return getTransfer(organizationId, id);
  });
}

export interface TransferSummary {
  id: string;
  number: number;
  technicianId: string;
  technicianName: string;
  direction: 'out' | 'return';
  totalTechnicianPrice: number;
  totalCost: number;
  units: number;
  note: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
}

function toTransfer(row: Record<string, unknown>): TransferSummary {
  return {
    id: String(row.id),
    number: Number(row.number),
    technicianId: String(row.technician_id),
    technicianName: String(row.technician_name ?? ''),
    direction: row.direction as 'out' | 'return',
    totalTechnicianPrice: money(row.total_technician_price),
    totalCost: money(row.total_cost),
    units: Number(row.units ?? 0),
    note: (row.note as string | null) ?? null,
    createdAt: toIso(row.created_at)!,
    acknowledgedAt: toIso(row.acknowledged_at),
  };
}

export async function listTransfers(organizationId: string, technicianId?: string | null) {
  const rows = await sql`
    SELECT t.*, tech.name AS technician_name,
      (SELECT COALESCE(SUM(m.quantity), 0)::int FROM part_movements m WHERE m.transfer_id = t.id AND m.quantity > 0) AS units
    FROM part_transfers t
    JOIN technicians tech ON tech.id = t.technician_id
    WHERE t.organization_id = ${organizationId}
      AND (${technicianId ?? null}::uuid IS NULL OR t.technician_id = ${technicianId ?? null}::uuid)
    ORDER BY t.created_at DESC
    LIMIT 300
  `;
  return rows.map(toTransfer);
}

export async function getTransfer(organizationId: string, transferId: unknown, technicianId?: string) {
  if (!isUuid(transferId)) throw new PartsError('Remessa inválida.');
  const row = (
    await sql`
      SELECT t.*, tech.name AS technician_name,
        (SELECT COALESCE(SUM(m.quantity), 0)::int FROM part_movements m WHERE m.transfer_id = t.id AND m.quantity > 0) AS units
      FROM part_transfers t JOIN technicians tech ON tech.id = t.technician_id
      WHERE t.id = ${transferId} AND t.organization_id = ${organizationId}
        AND (${technicianId ?? null}::uuid IS NULL OR t.technician_id = ${technicianId ?? null}::uuid)
    `
  )[0];
  if (!row) throw new PartsError('Remessa não encontrada.', 404);
  const items = await sql`
    SELECT m.part_id, p.name, p.barcode, p.unit, m.quantity, m.unit_technician_price, m.unit_cost
    FROM part_movements m JOIN parts p ON p.id = m.part_id
    WHERE m.transfer_id = ${transferId} AND m.quantity > 0
    ORDER BY lower(p.name)
  `;
  return {
    ...toTransfer(row),
    items: items.map((item) => ({
      partId: String(item.part_id),
      name: String(item.name),
      barcode: (item.barcode as string | null) ?? null,
      unit: String(item.unit),
      quantity: Number(item.quantity),
      unitTechnicianPrice: money(item.unit_technician_price),
      unitCost: money(item.unit_cost),
    })),
  };
}

/** The technician confirms, in the app, that they received the parts (the consignment receipt). */
export async function acknowledgeTransfer(organizationId: string, transferId: unknown, technicianId: string, actor: PartsActor, ip: string | null) {
  const transfer = await getTransfer(organizationId, transferId, technicianId);
  if (transfer.acknowledgedAt) return transfer;
  await sql`
    UPDATE part_transfers SET acknowledged_at = NOW(), acknowledged_by = ${actor.id}, acknowledged_ip = ${ip}
    WHERE id = ${transfer.id} AND acknowledged_at IS NULL
  `;
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.transfer_acknowledged', targetType: 'part_transfer', targetId: transfer.id, details: { ip },
  });
  return getTransfer(organizationId, transfer.id, technicianId);
}

// ---------------------------------------------------------------- movements

export async function listMovements(organizationId: string, filters: { partId?: unknown; technicianId?: unknown; central?: boolean }) {
  const partId = isUuid(filters.partId) ? filters.partId : null;
  const technicianId = isUuid(filters.technicianId) ? filters.technicianId : null;
  const rows = await sql`
    SELECT m.*, p.name AS part_name, t.name AS technician_name, u.name AS created_by_name
    FROM part_movements m
    JOIN parts p ON p.id = m.part_id
    LEFT JOIN technicians t ON t.id = m.technician_id
    LEFT JOIN users u ON u.id = m.created_by
    WHERE m.organization_id = ${organizationId}
      AND (${partId}::uuid IS NULL OR m.part_id = ${partId}::uuid)
      AND (${technicianId}::uuid IS NULL OR m.technician_id = ${technicianId}::uuid)
      AND (${filters.central === true} = FALSE OR m.technician_id IS NULL)
    ORDER BY m.created_at DESC
    LIMIT 500
  `;
  return rows.map((row) => ({
    id: String(row.id),
    partId: String(row.part_id),
    partName: String(row.part_name),
    technicianId: (row.technician_id as string | null) ?? null,
    technicianName: (row.technician_name as string | null) ?? null,
    quantity: Number(row.quantity),
    kind: row.kind as MovementKind,
    kindLabel: MOVEMENT_KIND_LABELS[row.kind as MovementKind] ?? String(row.kind),
    unitCost: row.unit_cost === null ? null : money(row.unit_cost),
    unitTechnicianPrice: row.unit_technician_price === null ? null : money(row.unit_technician_price),
    transferId: (row.transfer_id as string | null) ?? null,
    saleId: (row.sale_id as string | null) ?? null,
    inventoryId: (row.inventory_id as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    createdAt: toIso(row.created_at)!,
    createdByName: (row.created_by_name as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------- inventories (contagem)

export async function startInventory(organizationId: string, input: { technicianId?: unknown; note?: unknown }, actor: PartsActor) {
  const technicianId = input.technicianId ? (await requireTechnician(organizationId, input.technicianId, true)).id : null;
  const open = (
    await sql`
      SELECT id FROM part_inventories
      WHERE organization_id = ${organizationId} AND status = 'open' AND technician_id IS NOT DISTINCT FROM ${technicianId}::uuid
    `
  )[0];
  if (open) return getInventory(organizationId, open.id);

  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
  return withNumberRetry(async () => {
    const id = randomUUID();
    await sql`
      INSERT INTO part_inventories (id, organization_id, number, technician_id, note, started_by)
      VALUES (
        ${id}, ${organizationId}, (SELECT COALESCE(MAX(number), 0) + 1 FROM part_inventories WHERE organization_id = ${organizationId}),
        ${technicianId}, ${note}, ${actor.id}
      )
    `;
    await recordAudit({
      organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
      action: 'part.inventory_started', targetType: 'part_inventory', targetId: id, details: { technicianId },
    });
    return getInventory(organizationId, id);
  });
}

export interface InventoryLine {
  partId: string;
  name: string;
  barcode: string | null;
  unit: string;
  imageUrl: string | null;
  /** Live stock while open; the stock at closing once closed. */
  expected: number;
  counted: number;
  difference: number;
  unitTechnicianPrice: number;
  resolution: 'charge' | 'absorb' | null;
}

export async function getInventory(organizationId: string, inventoryId: unknown) {
  if (!isUuid(inventoryId)) throw new PartsError('Inventário inválido.');
  const row = (
    await sql`
      SELECT i.*, t.name AS technician_name, d.id AS debt_id, d.number AS debt_number
      FROM part_inventories i
      LEFT JOIN technicians t ON t.id = i.technician_id
      LEFT JOIN part_debts d ON d.inventory_id = i.id AND d.status = 'active'
      WHERE i.id = ${inventoryId} AND i.organization_id = ${organizationId}
    `
  )[0];
  if (!row) throw new PartsError('Inventário não encontrado.', 404);
  const technicianId = (row.technician_id as string | null) ?? null;
  const open = row.status === 'open';

  // Every part either in this stock or already counted.
  const lines = await sql`
    WITH stock AS (
      SELECT part_id, SUM(quantity)::int AS quantity FROM part_movements
      WHERE organization_id = ${organizationId} AND technician_id IS NOT DISTINCT FROM ${technicianId}::uuid
      GROUP BY part_id
    )
    SELECT p.id, p.name, p.barcode, p.unit, p.image_id, p.technician_price,
      COALESCE(s.quantity, 0) AS live_stock, c.counted, c.expected, c.unit_technician_price, c.resolution
    FROM parts p
    LEFT JOIN stock s ON s.part_id = p.id
    LEFT JOIN part_inventory_items c ON c.inventory_id = ${row.id} AND c.part_id = p.id
    WHERE p.organization_id = ${organizationId}
      AND (COALESCE(s.quantity, 0) <> 0 OR c.id IS NOT NULL)
    ORDER BY lower(p.name)
  `;
  const items: InventoryLine[] = lines.map((line) => {
    const expected = open ? Number(line.live_stock) : Number(line.expected ?? 0);
    const counted = Number(line.counted ?? 0);
    return {
      partId: String(line.id),
      name: String(line.name),
      barcode: (line.barcode as string | null) ?? null,
      unit: String(line.unit),
      imageUrl: line.image_id ? `/api/parts/${line.id}/image?v=${String(line.image_id).slice(0, 8)}` : null,
      expected,
      counted,
      difference: counted - expected,
      unitTechnicianPrice: money(line.unit_technician_price ?? line.technician_price),
      resolution: (line.resolution as 'charge' | 'absorb' | null) ?? null,
    };
  });

  return {
    id: String(row.id),
    number: Number(row.number),
    technicianId,
    technicianName: (row.technician_name as string | null) ?? null,
    status: row.status as 'open' | 'closed' | 'canceled',
    note: (row.note as string | null) ?? null,
    startedAt: toIso(row.started_at)!,
    closedAt: toIso(row.closed_at),
    shortageValue: row.shortage_value === null ? null : money(row.shortage_value),
    debtId: (row.debt_id as string | null) ?? null,
    debtNumber: row.debt_number === null || row.debt_number === undefined ? null : Number(row.debt_number),
    items,
    totals: {
      expected: items.reduce((sum, item) => sum + item.expected, 0),
      counted: items.reduce((sum, item) => sum + item.counted, 0),
      missingUnits: items.reduce((sum, item) => sum + Math.max(0, -item.difference), 0),
      surplusUnits: items.reduce((sum, item) => sum + Math.max(0, item.difference), 0),
      missingValue: money(items.reduce((sum, item) => sum + Math.max(0, -item.difference) * item.unitTechnicianPrice, 0)),
    },
  };
}

export async function listInventories(organizationId: string) {
  const rows = await sql`
    SELECT i.*, t.name AS technician_name,
      (SELECT COALESCE(SUM(counted), 0)::int FROM part_inventory_items c WHERE c.inventory_id = i.id) AS counted
    FROM part_inventories i LEFT JOIN technicians t ON t.id = i.technician_id
    WHERE i.organization_id = ${organizationId}
    ORDER BY (i.status = 'open') DESC, i.started_at DESC
    LIMIT 200
  `;
  return rows.map((row) => ({
    id: String(row.id),
    number: Number(row.number),
    technicianId: (row.technician_id as string | null) ?? null,
    technicianName: (row.technician_name as string | null) ?? null,
    status: row.status as 'open' | 'closed' | 'canceled',
    startedAt: toIso(row.started_at)!,
    closedAt: toIso(row.closed_at),
    counted: Number(row.counted),
    shortageValue: row.shortage_value === null ? null : money(row.shortage_value),
    surplusUnits: row.surplus_units === null ? null : Number(row.surplus_units),
  }));
}

async function requireOpenInventory(organizationId: string, inventoryId: unknown) {
  if (!isUuid(inventoryId)) throw new PartsError('Inventário inválido.');
  const row = (await sql`SELECT id, status, technician_id FROM part_inventories WHERE id = ${inventoryId} AND organization_id = ${organizationId}`)[0];
  if (!row) throw new PartsError('Inventário não encontrado.', 404);
  if (row.status !== 'open') throw new PartsError('Este inventário já foi encerrado.', 409);
  return { id: String(row.id), technicianId: (row.technician_id as string | null) ?? null };
}

/**
 * One read of the barcode (adds `add` units, default 1) or a typed count (`set`). Returns the part
 * counted and its total so far, so the phone can confirm each read.
 */
export async function countInventoryItem(
  organizationId: string,
  inventoryId: unknown,
  input: { barcode?: unknown; partId?: unknown; add?: unknown; set?: unknown },
  actor: PartsActor,
) {
  const inventory = await requireOpenInventory(organizationId, inventoryId);
  let partId: string | null = isUuid(input.partId) ? input.partId : null;
  if (!partId && input.barcode !== undefined) {
    const part = await findPartByBarcode(organizationId, input.barcode);
    if (!part) throw new PartsError(`Nenhuma peça cadastrada com o código ${String(input.barcode)}.`, 404);
    partId = part.id;
  }
  if (!partId) throw new PartsError('Leia o código de barras ou escolha a peça.');
  const exists = (await sql`SELECT name FROM parts WHERE id = ${partId} AND organization_id = ${organizationId}`)[0];
  if (!exists) throw new PartsError('Peça não encontrada.', 404);

  let counted: number;
  if (input.set !== undefined) {
    const value = Number(input.set);
    if (!Number.isInteger(value) || value < 0) throw new PartsError('Contagem inválida.');
    const rows = await sql`
      INSERT INTO part_inventory_items (organization_id, inventory_id, part_id, counted, updated_by)
      VALUES (${organizationId}, ${inventory.id}, ${partId}, ${value}, ${actor.id})
      ON CONFLICT (inventory_id, part_id) DO UPDATE SET counted = EXCLUDED.counted, updated_at = NOW(), updated_by = EXCLUDED.updated_by
      RETURNING counted
    `;
    counted = Number(rows[0].counted);
  } else {
    const add = input.add === undefined ? 1 : Number(input.add);
    if (!Number.isInteger(add) || add === 0 || Math.abs(add) > 10_000) throw new PartsError('Quantidade inválida.');
    const rows = await sql`
      INSERT INTO part_inventory_items (organization_id, inventory_id, part_id, counted, updated_by)
      VALUES (${organizationId}, ${inventory.id}, ${partId}, ${Math.max(0, add)}, ${actor.id})
      ON CONFLICT (inventory_id, part_id) DO UPDATE
      SET counted = GREATEST(0, part_inventory_items.counted + ${add}), updated_at = NOW(), updated_by = EXCLUDED.updated_by
      RETURNING counted
    `;
    counted = Number(rows[0].counted);
  }
  const stock = await getStock(organizationId, inventory.technicianId, [partId]);
  return { partId, name: String(exists.name), counted, expected: stock.get(partId) ?? 0 };
}

/**
 * Closes the count. Each difference becomes a movement (the stock now matches what was counted).
 * Shortages in a technician's stock marked 'charge' become one debt with installments; 'absorb'
 * (e.g. theft with a police report) is the organization's loss.
 */
export async function closeInventory(
  organizationId: string,
  inventoryId: unknown,
  input: { resolutions?: unknown; installments?: unknown; firstDueMonth?: unknown; debtDescription?: unknown },
  actor: PartsActor,
) {
  const inventory = await requireOpenInventory(organizationId, inventoryId);
  const snapshot = await getInventory(organizationId, inventory.id);
  const resolutions = (input.resolutions && typeof input.resolutions === 'object' ? input.resolutions : {}) as Record<string, unknown>;

  const shortages = snapshot.items.filter((item) => item.difference < 0);
  const surpluses = snapshot.items.filter((item) => item.difference > 0);
  const charged = inventory.technicianId
    ? shortages.filter((item) => (resolutions[item.partId] ?? 'charge') === 'charge')
    : [];
  const chargedValue = money(charged.reduce((sum, item) => sum + -item.difference * item.unitTechnicianPrice, 0));

  const installments = input.installments === undefined ? 1 : Number(input.installments);
  const firstDueMonth = isMonthKey(input.firstDueMonth) ? input.firstDueMonth : currentMonth();
  if (chargedValue > 0 && (!Number.isInteger(installments) || installments < 1 || installments > 48)) {
    throw new PartsError('Parcelas devem ser entre 1 e 48.');
  }

  await sql.transaction([
    ...snapshot.items.map(
      (item) => sql`
        INSERT INTO part_inventory_items (organization_id, inventory_id, part_id, counted, expected, unit_technician_price, resolution, updated_by)
        VALUES (
          ${organizationId}, ${inventory.id}, ${item.partId}, ${item.counted}, ${item.expected}, ${item.unitTechnicianPrice},
          ${item.difference < 0 ? (inventory.technicianId && (resolutions[item.partId] ?? 'charge') === 'charge' ? 'charge' : 'absorb') : null},
          ${actor.id}
        )
        ON CONFLICT (inventory_id, part_id) DO UPDATE
        SET expected = EXCLUDED.expected, unit_technician_price = EXCLUDED.unit_technician_price, resolution = EXCLUDED.resolution, updated_at = NOW()
      `,
    ),
    ...[...shortages, ...surpluses].map(
      (item) => sql`
        INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_technician_price, inventory_id, note, created_by)
        VALUES (
          ${organizationId}, ${item.partId}, ${inventory.technicianId}, ${item.difference},
          ${item.difference < 0 ? 'inventory_shortage' : 'inventory_surplus'}, ${item.unitTechnicianPrice}, ${inventory.id},
          ${`Inventário nº ${snapshot.number}`}, ${actor.id}
        )
      `,
    ),
    sql`
      UPDATE part_inventories
      SET status = 'closed', closed_at = NOW(), closed_by = ${actor.id},
          shortage_value = ${snapshot.totals.missingValue}, surplus_units = ${snapshot.totals.surplusUnits}
      WHERE id = ${inventory.id}
    `,
  ]);

  if (chargedValue > 0 && inventory.technicianId) {
    const description =
      (typeof input.debtDescription === 'string' && input.debtDescription.trim()) ||
      `Peças em falta no inventário nº ${snapshot.number}: ` +
        charged.map((item) => `${-item.difference}× ${item.name}`).join(', ');
    await createDebt(
      organizationId,
      {
        technicianId: inventory.technicianId,
        description,
        totalAmount: chargedValue,
        installments,
        firstDueMonth,
        inventoryId: inventory.id,
      },
      actor,
    );
  }

  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.inventory_closed', targetType: 'part_inventory', targetId: inventory.id,
    details: { technicianId: inventory.technicianId, ...snapshot.totals, chargedValue, installments },
  });
  return getInventory(organizationId, inventory.id);
}

export async function cancelInventory(organizationId: string, inventoryId: unknown, actor: PartsActor) {
  const inventory = await requireOpenInventory(organizationId, inventoryId);
  await sql`UPDATE part_inventories SET status = 'canceled', closed_at = NOW(), closed_by = ${actor.id} WHERE id = ${inventory.id}`;
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.inventory_canceled', targetType: 'part_inventory', targetId: inventory.id,
  });
}
