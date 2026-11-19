import { del } from '@vercel/blob';
import { recordAudit } from '../audit';
import { sql } from '../db';
import { cancelDebt } from './account';
import {
  isUuid,
  lockStock,
  money,
  parseQuantity,
  PartsError,
  requireUnits,
  runStockTransaction,
  toIso,
  type PartsActor,
} from './common';
import { getStock } from './stock';

// Fixing what was entered wrong. The stock is the sum of part_movements, so a past row is never edited: a correction adds a row
// that points at what it corrects (`corrects_id`, migration 0068). The one thing that is erased for good is a part with no
// history (and the entries that were all it had), because the owner asked for it: see `purgeParts`.

function cleanReason(value: unknown, message = 'Informe o motivo.') {
  const reason = typeof value === 'string' ? value.trim().slice(0, 300) : '';
  if (!reason) throw new PartsError(message);
  return reason;
}

// ---------------------------------------------------------------- permanent delete of parts

export interface PurgeCandidate {
  id: string;
  name: string;
  barcode: string | null;
  /** Units in the central stock that go away with the part. */
  units: number;
  /** Why it can't be erased; null when it can. */
  blockedReason: string | null;
}

/**
 * A part can be erased for good only while it has no history: no sale, no inventory, never with a technician. What is left
 * are the entries into the central stock (and their corrections), which are exactly the "launched wrong" case.
 * `importId` makes the same check for undoing an import: then every movement must belong to that import.
 */
export async function checkPurge(organizationId: string, partIds: string[], importId: string | null = null): Promise<PurgeCandidate[]> {
  if (!partIds.length) return [];
  const rows = await sql`
    SELECT p.id, p.name, p.barcode,
      COALESCE((SELECT SUM(m.quantity) FROM part_movements m WHERE m.part_id = p.id AND m.technician_id IS NULL), 0)::int AS units,
      EXISTS (SELECT 1 FROM part_sale_items i WHERE i.part_id = p.id) AS has_sales,
      EXISTS (SELECT 1 FROM part_inventory_items i WHERE i.part_id = p.id) AS has_inventory,
      EXISTS (
        SELECT 1 FROM part_movements m
        WHERE m.part_id = p.id AND (m.technician_id IS NOT NULL OR m.kind NOT IN ('purchase', 'adjustment'))
      ) AS has_technician_history,
      (${importId}::uuid IS NOT NULL AND EXISTS (
        SELECT 1 FROM part_movements m WHERE m.part_id = p.id AND m.import_id IS DISTINCT FROM ${importId}::uuid
      )) AS has_later_movements
    FROM parts p
    WHERE p.organization_id = ${organizationId} AND p.id = ANY(${partIds}::uuid[])
    ORDER BY lower(p.name)
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    barcode: (row.barcode as string | null) ?? null,
    units: Number(row.units),
    blockedReason: row.has_sales
      ? 'tem vendas registradas'
      : row.has_technician_history
        ? 'já foi enviada a um técnico'
        : row.has_inventory
          ? 'entrou em um inventário'
          : row.has_later_movements
            ? 'tem entradas ou ajustes feitos depois da importação'
            : null,
  }));
}

/** The statements that erase parts for good with their entries and pictures; the caller runs them in its own transaction. */
function eraseStatements(organizationId: string, partIds: string[]) {
  return [
    sql`UPDATE parts SET image_id = NULL WHERE organization_id = ${organizationId} AND id = ANY(${partIds}::uuid[])`,
    sql`DELETE FROM part_movements WHERE organization_id = ${organizationId} AND part_id = ANY(${partIds}::uuid[])`,
    sql`DELETE FROM part_images WHERE organization_id = ${organizationId} AND part_id = ANY(${partIds}::uuid[])`,
    sql`DELETE FROM parts WHERE organization_id = ${organizationId} AND id = ANY(${partIds}::uuid[])`,
  ];
}

async function pictureUrls(organizationId: string, partIds: string[]) {
  if (!partIds.length) return [];
  const rows = await sql`SELECT url FROM part_images WHERE organization_id = ${organizationId} AND part_id = ANY(${partIds}::uuid[])`;
  return rows.map((row) => String(row.url));
}

/** Once the rows are gone, the picture files go too (they were counted in the company's storage). */
async function removePictures(urls: string[]) {
  if (!urls.length || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(urls);
  } catch (error) {
    console.warn('[parts] could not remove the pictures of the erased parts:', error instanceof Error ? error.message : error);
  }
}

const RACE_MESSAGE = 'Uma das peças ganhou uma venda ou remessa agora há pouco e não pode mais ser excluída. Nada foi apagado; confira e tente de novo.';

/** Permanent delete of one or more parts. `dryRun` only reports which ones can go. */
export async function purgeParts(organizationId: string, ids: unknown, options: { dryRun?: boolean }, actor: PartsActor) {
  const partIds = Array.from(new Set(Array.isArray(ids) ? ids.filter(isUuid) : []));
  if (!partIds.length) throw new PartsError('Escolha ao menos uma peça.');
  if (partIds.length > 2000) throw new PartsError('Exclua no máximo 2.000 peças por vez.');

  const candidates = await checkPurge(organizationId, partIds);
  const eligible = candidates.filter((part) => !part.blockedReason);
  const blocked = candidates.filter((part) => part.blockedReason);
  const units = eligible.reduce((sum, part) => sum + Math.max(0, part.units), 0);
  if (options.dryRun) return { eligible, blocked, deleted: 0, units };

  const eligibleIds = eligible.map((part) => part.id);
  if (eligibleIds.length) {
    const urls = await pictureUrls(organizationId, eligibleIds);
    try {
      await sql.transaction(eraseStatements(organizationId, eligibleIds));
    } catch (error) {
      // A sale or a remittance was registered for one of them a moment ago: the foreign keys refuse, nothing was erased.
      if ((error as { code?: string })?.code === '23503') throw new PartsError(RACE_MESSAGE, 409);
      throw error;
    }
    await removePictures(urls);
  }
  if (eligible.length) {
    await recordAudit({
      organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
      action: 'part.purged', targetType: 'part',
      details: { count: eligible.length, units, blocked: blocked.length, parts: eligible.slice(0, 100).map((part) => ({ name: part.name, barcode: part.barcode, units: part.units })) },
    });
  }
  return { eligible, blocked, deleted: eligible.length, units };
}

// ---------------------------------------------------------------- undoing and correcting an entry or an adjustment

async function loadMovement(organizationId: string, movementId: unknown) {
  if (!isUuid(movementId)) throw new PartsError('Movimentação inválida.');
  const row = (
    await sql`
      SELECT m.*, p.name AS part_name,
        EXISTS (SELECT 1 FROM part_movements r WHERE r.corrects_id = m.id AND r.correction_kind = 'reversal') AS reversed
      FROM part_movements m JOIN parts p ON p.id = m.part_id
      WHERE m.id = ${movementId} AND m.organization_id = ${organizationId}
    `
  )[0];
  if (!row) throw new PartsError('Movimentação não encontrada.', 404);
  return row;
}

function assertCorrectable(row: Record<string, unknown>) {
  if (row.corrects_id) throw new PartsError('Esta linha já é uma correção. Desfaça ou corrija a linha original.', 409);
  if (row.reversed) throw new PartsError('Este lançamento já foi desfeito.', 409);
  if (row.kind !== 'purchase' && row.kind !== 'adjustment') {
    throw new PartsError('Só entradas de estoque e ajustes se desfazem aqui. Venda, remessa e inventário têm o próprio botão.', 409);
  }
}

function insertReversal(organizationId: string, row: Record<string, unknown>, note: string, actor: PartsActor) {
  return sql`
    INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, corrects_id, correction_kind, note, created_by)
    VALUES (${organizationId}, ${row.part_id}, ${row.technician_id ?? null}, ${-Number(row.quantity)}, ${row.kind}, ${row.unit_cost ?? null}, ${row.unit_technician_price ?? null},
            ${row.id}, 'reversal', ${note}, ${actor.id})
  `;
}

/** Units that would leave a stock when the entry goes away must still be there: otherwise they were already sold or sent on. */
function guardRemoval(organizationId: string, technicianId: string | null, partId: string, units: number) {
  return [lockStock(organizationId, technicianId), requireUnits(organizationId, technicianId, partId, units)];
}

async function assertUnitsStillThere(organizationId: string, technicianId: string | null, partId: string, partName: string, units: number) {
  const have = (await getStock(organizationId, technicianId, [partId])).get(partId) ?? 0;
  if (have < units) {
    throw new PartsError(
      `Não dá para desfazer: ${partName} — ${units} unidade(s) dessa entrada já saíram ${technicianId ? 'do carro do técnico' : 'do estoque central'} (restam ${Math.max(0, have)}).`,
      409,
    );
  }
}

/** Undoes an entry of stock or an adjustment: a row with the opposite quantity, so the trail stays. */
export async function reverseMovement(organizationId: string, movementId: unknown, input: { reason?: unknown }, actor: PartsActor) {
  const row = await loadMovement(organizationId, movementId);
  assertCorrectable(row);
  const reason = cleanReason(input.reason, 'Informe o motivo para desfazer.');
  const technicianId = (row.technician_id as string | null) ?? null;
  const units = Number(row.quantity);
  if (units > 0) await assertUnitsStillThere(organizationId, technicianId, String(row.part_id), String(row.part_name), units);

  const insert = insertReversal(organizationId, row, `Desfeito: ${reason}`, actor);
  try {
    await runStockTransaction(units > 0 ? [...guardRemoval(organizationId, technicianId, String(row.part_id), units), insert] : [insert]);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new PartsError('Este lançamento já foi desfeito.', 409);
    throw error;
  }
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.movement_reversed', targetType: 'part', targetId: String(row.part_id),
    details: { movementId: String(row.id), kind: row.kind, quantity: units, reason },
  });
}

/** Fixes a purchase: reverses it and enters it again with the right quantity and cost, in one step. */
export async function correctPurchase(
  organizationId: string,
  movementId: unknown,
  input: { quantity?: unknown; unitCost?: unknown; reason?: unknown },
  actor: PartsActor,
) {
  const row = await loadMovement(organizationId, movementId);
  assertCorrectable(row);
  if (row.kind !== 'purchase' || row.technician_id) throw new PartsError('Só a entrada de estoque central pode ser corrigida desta forma.', 409);
  const reason = cleanReason(input.reason, 'Informe o motivo da correção.');
  const quantity = parseQuantity(input.quantity);
  const cost = Number(input.unitCost);
  if (!Number.isFinite(cost) || cost < 0) throw new PartsError('Custo unitário inválido.');
  const unitCost = money(cost);
  const oldQuantity = Number(row.quantity);
  if (quantity === oldQuantity && unitCost === money(row.unit_cost)) throw new PartsError('Nada mudou na entrada.');
  const removed = Math.max(0, oldQuantity - quantity);
  if (removed > 0) await assertUnitsStillThere(organizationId, null, String(row.part_id), String(row.part_name), removed);

  const queries = [
    ...(removed > 0 ? guardRemoval(organizationId, null, String(row.part_id), removed) : []),
    insertReversal(organizationId, row, `Corrigida: ${reason}`, actor),
    sql`
      INSERT INTO part_movements (organization_id, part_id, technician_id, quantity, kind, unit_cost, unit_technician_price, note, created_by)
      VALUES (${organizationId}, ${row.part_id}, NULL, ${quantity}, 'purchase', ${unitCost}, ${row.unit_technician_price ?? null}, ${`Entrada corrigida: ${reason}`}, ${actor.id})
    `,
  ];
  try {
    await runStockTransaction(queries);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') throw new PartsError('Este lançamento já foi corrigido.', 409);
    throw error;
  }
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.purchase_corrected', targetType: 'part', targetId: String(row.part_id),
    details: { movementId: String(row.id), before: { quantity: oldQuantity, unitCost: money(row.unit_cost) }, after: { quantity, unitCost }, reason },
  });
}

// ---------------------------------------------------------------- undoing a remittance or a return

/** Sends the units back where they came from. Refused when the receiving stock no longer has them. */
export async function undoTransfer(organizationId: string, transferId: unknown, input: { reason?: unknown }, actor: PartsActor) {
  if (!isUuid(transferId)) throw new PartsError('Remessa inválida.');
  const transfer = (await sql`SELECT id, number, direction, technician_id, canceled_at FROM part_transfers WHERE id = ${transferId} AND organization_id = ${organizationId}`)[0];
  if (!transfer) throw new PartsError('Remessa não encontrada.', 404);
  if (transfer.canceled_at) throw new PartsError('Esta remessa já foi desfeita.', 409);
  const reason = cleanReason(input.reason, 'Informe o motivo para desfazer.');

  const moves = await sql`
    SELECT m.*, p.name AS part_name FROM part_movements m JOIN parts p ON p.id = m.part_id
    WHERE m.transfer_id = ${transfer.id} AND m.corrects_id IS NULL
    ORDER BY (m.technician_id IS NOT NULL), m.created_at
  `;
  // The leg that received the units is the one that has to give them back.
  const removals = moves.filter((move) => Number(move.quantity) > 0);
  for (const move of removals) {
    await assertUnitsStillThere(organizationId, (move.technician_id as string | null) ?? null, String(move.part_id), String(move.part_name), Number(move.quantity));
  }
  const stocks = Array.from(new Set(removals.map((move) => (move.technician_id as string | null) ?? null)));
  const note = `Remessa nº ${transfer.number} desfeita: ${reason}`;
  await runStockTransaction([
    ...stocks.flatMap((technicianId) => [
      lockStock(organizationId, technicianId),
      ...removals.filter((move) => ((move.technician_id as string | null) ?? null) === technicianId).map((move) => requireUnits(organizationId, technicianId, String(move.part_id), Number(move.quantity))),
    ]),
    ...moves.map((move) => insertReversal(organizationId, move, note, actor)),
    sql`
      UPDATE part_transfers SET canceled_at = NOW(), canceled_by = ${actor.id}, cancel_reason = ${reason}
      WHERE id = ${transfer.id} AND organization_id = ${organizationId} AND canceled_at IS NULL
    `,
  ]);
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.transfer_undone', targetType: 'part_transfer', targetId: String(transfer.id),
    details: { number: Number(transfer.number), direction: transfer.direction, units: removals.reduce((sum, move) => sum + Number(move.quantity), 0), reason },
  });
}

// ---------------------------------------------------------------- undoing a closed inventory

/** Puts the stock back as it was before the count and cancels the debt it generated. Only a closed count. */
export async function revertInventory(organizationId: string, inventoryId: unknown, input: { reason?: unknown }, actor: PartsActor) {
  if (!isUuid(inventoryId)) throw new PartsError('Inventário inválido.');
  const inventory = (await sql`SELECT id, number, status, technician_id FROM part_inventories WHERE id = ${inventoryId} AND organization_id = ${organizationId}`)[0];
  if (!inventory) throw new PartsError('Inventário não encontrado.', 404);
  if (inventory.status === 'reverted') throw new PartsError('Este inventário já foi desfeito.', 409);
  if (inventory.status !== 'closed') throw new PartsError('Só um inventário encerrado pode ser desfeito (o aberto pode ser cancelado).', 409);
  const reason = cleanReason(input.reason, 'Informe o motivo para desfazer.');
  const technicianId = (inventory.technician_id as string | null) ?? null;

  const moves = await sql`
    SELECT m.*, p.name AS part_name FROM part_movements m JOIN parts p ON p.id = m.part_id
    WHERE m.inventory_id = ${inventory.id} AND m.corrects_id IS NULL
  `;
  // A surplus that was entered goes out again: those units must still be there.
  const removals = moves.filter((move) => Number(move.quantity) > 0);
  for (const move of removals) await assertUnitsStillThere(organizationId, technicianId, String(move.part_id), String(move.part_name), Number(move.quantity));

  const note = `Inventário nº ${inventory.number} desfeito: ${reason}`;
  await runStockTransaction([
    ...(removals.length ? [lockStock(organizationId, technicianId), ...removals.map((move) => requireUnits(organizationId, technicianId, String(move.part_id), Number(move.quantity)))] : []),
    ...moves.map((move) => insertReversal(organizationId, move, note, actor)),
    sql`
      UPDATE part_inventories SET status = 'reverted', reverted_at = NOW(), reverted_by = ${actor.id}, revert_reason = ${reason}
      WHERE id = ${inventory.id} AND organization_id = ${organizationId} AND status = 'closed'
    `,
  ]);

  const debt = (await sql`SELECT id, first_due_month FROM part_debts WHERE inventory_id = ${inventory.id} AND organization_id = ${organizationId} AND status = 'active'`)[0];
  if (debt) {
    await cancelDebt(organizationId, debt.id, { reason: `Inventário nº ${inventory.number} desfeito: ${reason}`, fromMonth: String(debt.first_due_month) }, actor);
  }
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.inventory_reverted', targetType: 'part_inventory', targetId: String(inventory.id),
    details: { number: Number(inventory.number), movements: moves.length, debtCanceled: Boolean(debt), reason },
  });
}

// ---------------------------------------------------------------- spreadsheet imports

export interface PartImport {
  id: string;
  createdAt: string;
  createdByName: string | null;
  created: number;
  updated: number;
  units: number;
  undoneAt: string | null;
}

export async function listImports(organizationId: string): Promise<PartImport[]> {
  const rows = await sql`
    SELECT i.*, u.name AS created_by_name FROM part_imports i LEFT JOIN users u ON u.id = i.created_by
    WHERE i.organization_id = ${organizationId}
    ORDER BY i.created_at DESC
    LIMIT 20
  `;
  return rows.map((row) => ({
    id: String(row.id),
    createdAt: toIso(row.created_at)!,
    createdByName: (row.created_by_name as string | null) ?? null,
    created: Number(row.created_count),
    updated: Number(row.updated_count),
    units: Number(row.units),
    undoneAt: toIso(row.undone_at),
  }));
}

/**
 * Takes back everything one spreadsheet import did: the parts it created are erased with their entries, the ones it updated go
 * back to how they were and the units it entered are reversed. All or nothing: when something it created already has sales,
 * remittances or later movements, nothing is touched and the message says which.
 */
export async function undoImport(organizationId: string, importId: unknown, actor: PartsActor) {
  if (!isUuid(importId)) throw new PartsError('Importação inválida.');
  const entry = (await sql`SELECT * FROM part_imports WHERE id = ${importId} AND organization_id = ${organizationId}`)[0];
  if (!entry) throw new PartsError('Importação não encontrada.', 404);
  if (entry.undone_at) throw new PartsError('Esta importação já foi desfeita.', 409);

  const createdIds = (await sql`SELECT id FROM parts WHERE organization_id = ${organizationId} AND import_id = ${entry.id}`).map((row) => String(row.id));
  const candidates = await checkPurge(organizationId, createdIds, String(entry.id));
  const blocked = candidates.filter((part) => part.blockedReason);
  if (blocked.length) {
    throw new PartsError(
      `Não dá para desfazer a importação inteira: ${blocked.length} peça(s) criada(s) por ela já ${blocked.length === 1 ? 'tem' : 'têm'} movimento depois. ` +
        blocked.slice(0, 8).map((part) => `${part.name} (${part.blockedReason})`).join('; ') + (blocked.length > 8 ? `; e mais ${blocked.length - 8}` : '') +
        '. Arquive ou exclua essas peças primeiro, ou desfaça só os lançamentos errados na aba Movimentações.',
      409,
    );
  }

  // The parts it only updated: what it entered into their stock is reversed, their data goes back.
  const updatedIds = new Set(((entry.previous as Array<Record<string, unknown>>) ?? []).map((item) => String(item.id)));
  const entered = await sql`
    SELECT m.*, p.name AS part_name
    FROM part_movements m JOIN parts p ON p.id = m.part_id
    WHERE m.organization_id = ${organizationId} AND m.import_id = ${entry.id} AND m.corrects_id IS NULL AND m.part_id = ANY(${Array.from(updatedIds)}::uuid[])
      AND NOT EXISTS (SELECT 1 FROM part_movements r WHERE r.corrects_id = m.id AND r.correction_kind = 'reversal')
  `;
  const perPart = new Map<string, { name: string; units: number }>();
  for (const move of entered) {
    const current = perPart.get(String(move.part_id)) ?? { name: String(move.part_name), units: 0 };
    current.units += Number(move.quantity);
    perPart.set(String(move.part_id), current);
  }
  const central = await getStock(organizationId, null, Array.from(perPart.keys()));
  const short = Array.from(perPart, ([partId, item]) => ({ partId, ...item, have: central.get(partId) ?? 0 })).filter((item) => item.have < item.units);
  if (short.length) {
    throw new PartsError(
      'Não dá para desfazer: parte das unidades que a importação colocou no estoque central já saiu (' +
        short.slice(0, 8).map((item) => `${item.name}: entrou ${item.units}, restam ${Math.max(0, item.have)}`).join('; ') + ').',
      409,
    );
  }

  const restore = ((entry.previous as Array<Record<string, unknown>>) ?? []).map(
    (item) => sql`
      UPDATE parts SET name = ${item.name}, barcode = ${item.barcode ?? null}, sku = ${item.sku ?? null}, category = ${item.category ?? null}, brand = ${item.brand ?? null},
        unit = ${item.unit}, cost_price = ${item.costPrice}, technician_price = ${item.technicianPrice}, suggested_price = ${item.suggestedPrice},
        min_stock = ${item.minStock ?? null}, updated_at = NOW()
      WHERE id = ${item.id} AND organization_id = ${organizationId} AND deleted_at IS NULL
    `,
  );
  const urls = await pictureUrls(organizationId, createdIds);
  try {
    // One transaction: the entries are reversed, the updated parts go back and the created ones are erased, or nothing changes.
    await runStockTransaction([
      ...Array.from(perPart, ([partId, item]) => [lockStock(organizationId, null), requireUnits(organizationId, null, partId, item.units)]).flat(),
      ...entered.map((move) => insertReversal(organizationId, move, 'Importação desfeita', actor)),
      ...restore,
      ...(createdIds.length ? eraseStatements(organizationId, createdIds) : []),
      sql`UPDATE part_imports SET undone_at = NOW(), undone_by = ${actor.id} WHERE id = ${entry.id} AND undone_at IS NULL`,
    ]);
  } catch (error) {
    if ((error as { code?: string })?.code === '23503') throw new PartsError(RACE_MESSAGE, 409);
    // A part's barcode was taken by another part in the meantime: the partial unique index refuses the restore.
    if ((error as { code?: string })?.code === '23505') {
      throw new PartsError('Não deu para devolver o código de barras de uma peça atualizada (outra peça já usa esse código). Nada foi alterado.', 409);
    }
    throw error;
  }
  await removePictures(urls);
  await recordAudit({
    organizationId, actorId: actor.id, actorRole: actor.role, impersonationId: actor.impersonationId,
    action: 'part.import_undone', details: { importId: String(entry.id), erased: createdIds.length, restored: updatedIds.size, reversedUnits: entered.reduce((sum, move) => sum + Number(move.quantity), 0) },
  });
  return { erased: createdIds.length, restored: updatedIds.size };
}
