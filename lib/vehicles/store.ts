import { recordAudit } from '../audit';
import { sql } from '../db';
import { brasiliaDateKey } from '../formatters';
import type { VehicleInput } from './rules';

export type Actor = { organizationId: string; userId: string; role: string; impersonationId: string | null };

export class VehicleError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type VehicleRow = {
  id: string;
  plate: string;
  brand: string | null;
  model: string;
  year: number | null;
  color: string | null;
  renavam: string | null;
  chassis: string | null;
  fuel: string | null;
  odometer: number | null;
  licensingDue: string | null;
  insuranceDue: string | null;
  notes: string | null;
  status: string;
  technicianId: string | null;
  technicianName: string | null;
  /** When the current technician took the car. */
  assignedAt: string | null;
  createdAt: string;
};

function toRow(row: Record<string, unknown>): VehicleRow {
  return {
    id: String(row.id),
    plate: String(row.plate),
    brand: (row.brand as string | null) ?? null,
    model: String(row.model),
    year: row.year === null ? null : Number(row.year),
    color: (row.color as string | null) ?? null,
    renavam: (row.renavam as string | null) ?? null,
    chassis: (row.chassis as string | null) ?? null,
    fuel: (row.fuel as string | null) ?? null,
    odometer: row.odometer === null ? null : Number(row.odometer),
    licensingDue: (row.licensing_due_text as string | null) ?? null,
    insuranceDue: (row.insurance_due_text as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    status: String(row.status),
    technicianId: (row.technician_id as string | null) ?? null,
    technicianName: (row.technician_name as string | null) ?? null,
    assignedAt: row.assigned_at ? new Date(row.assigned_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/** Everything the screen needs in one go: the cars (with who has them) and the technicians a car can be given to. */
export async function loadFleet(organizationId: string) {
  const vehicles = await sql`
    SELECT v.*, v.licensing_due::text AS licensing_due_text, v.insurance_due::text AS insurance_due_text, t.name AS technician_name,
           (SELECT a.assigned_at FROM vehicle_assignments a WHERE a.vehicle_id = v.id AND a.released_at IS NULL ORDER BY a.assigned_at DESC LIMIT 1) AS assigned_at
    FROM vehicles v
    LEFT JOIN technicians t ON t.id = v.technician_id
    WHERE v.organization_id = ${organizationId} AND v.deleted_at IS NULL
    ORDER BY v.plate
  `;
  const technicians = await sql`
    SELECT id, name FROM technicians
    WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND status = 'active'
    ORDER BY name
  `;
  return {
    today: brasiliaDateKey(),
    vehicles: vehicles.map(toRow),
    technicians: technicians.map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

async function requireActiveTechnician(organizationId: string, technicianId: string) {
  const rows = await sql`
    SELECT 1 FROM technicians
    WHERE id = ${technicianId} AND organization_id = ${organizationId} AND deleted_at IS NULL AND status = 'active'
    LIMIT 1
  `;
  if (!rows.length) throw new VehicleError('Escolha um técnico ativo da sua empresa.');
}

async function requireVehicle(organizationId: string, id: string) {
  const rows = await sql`
    SELECT id, plate, technician_id FROM vehicles
    WHERE id = ${id} AND organization_id = ${organizationId} AND deleted_at IS NULL
    LIMIT 1
  `;
  if (!rows.length) throw new VehicleError('Carro não encontrado.', 404);
  return rows[0] as { id: string; plate: string; technician_id: string | null };
}

const isDuplicatePlate = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/** Hands the car to a technician (or takes it back with null): closes the open stretch of the history and opens a new one. */
async function moveCar(actor: Actor, vehicleId: string, from: string | null, to: string | null) {
  if (from === to) return;
  await sql`
    UPDATE vehicle_assignments SET released_at = NOW(), released_by = ${actor.userId}
    WHERE vehicle_id = ${vehicleId} AND organization_id = ${actor.organizationId} AND released_at IS NULL
  `;
  if (to) {
    await sql`
      INSERT INTO vehicle_assignments (organization_id, vehicle_id, technician_id, assigned_by)
      VALUES (${actor.organizationId}, ${vehicleId}, ${to}, ${actor.userId})
    `;
  }
  await sql`UPDATE vehicles SET technician_id = ${to}, updated_at = NOW() WHERE id = ${vehicleId} AND organization_id = ${actor.organizationId}`;
}

function audit(actor: Actor, action: string, vehicleId: string, details: Record<string, unknown>) {
  return recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorRole: actor.role,
    impersonationId: actor.impersonationId,
    action,
    targetType: 'vehicle',
    targetId: vehicleId,
    details,
  });
}

export async function createVehicle(actor: Actor, input: Partial<VehicleInput>, technicianId: string | null) {
  if (technicianId) await requireActiveTechnician(actor.organizationId, technicianId);
  let id: string;
  try {
    const rows = await sql`
      INSERT INTO vehicles (
        organization_id, plate, brand, model, year, color, renavam, chassis, fuel, odometer,
        licensing_due, insurance_due, notes, status, created_by
      )
      VALUES (
        ${actor.organizationId}, ${input.plate}, ${input.brand ?? null}, ${input.model}, ${input.year ?? null}, ${input.color ?? null},
        ${input.renavam ?? null}, ${input.chassis ?? null}, ${input.fuel ?? null}, ${input.odometer ?? null},
        ${input.licensingDue ?? null}::date, ${input.insuranceDue ?? null}::date, ${input.notes ?? null}, ${input.status ?? 'active'}, ${actor.userId}
      )
      RETURNING id
    `;
    id = String(rows[0].id);
  } catch (error) {
    if (isDuplicatePlate(error)) throw new VehicleError('Já existe um carro com essa placa.', 409);
    throw error;
  }
  await moveCar(actor, id, null, technicianId);
  await audit(actor, 'vehicle.created', id, { plate: input.plate, technicianId });
  return id;
}

/** `technicianId`: undefined leaves the car where it is, null takes it back, an id hands it over. */
export async function updateVehicle(actor: Actor, id: string, patch: Partial<VehicleInput>, technicianId: string | null | undefined) {
  const current = await requireVehicle(actor.organizationId, id);
  if (technicianId) await requireActiveTechnician(actor.organizationId, technicianId);

  const has = (key: keyof VehicleInput) => Object.prototype.hasOwnProperty.call(patch, key);
  const keep = (key: keyof VehicleInput) => (has(key) ? (patch[key] ?? null) : null);
  try {
    await sql`
      UPDATE vehicles SET
        plate = CASE WHEN ${has('plate')} THEN ${keep('plate')} ELSE plate END,
        brand = CASE WHEN ${has('brand')} THEN ${keep('brand')} ELSE brand END,
        model = CASE WHEN ${has('model')} THEN ${keep('model')} ELSE model END,
        year = CASE WHEN ${has('year')} THEN ${keep('year')}::int ELSE year END,
        color = CASE WHEN ${has('color')} THEN ${keep('color')} ELSE color END,
        renavam = CASE WHEN ${has('renavam')} THEN ${keep('renavam')} ELSE renavam END,
        chassis = CASE WHEN ${has('chassis')} THEN ${keep('chassis')} ELSE chassis END,
        fuel = CASE WHEN ${has('fuel')} THEN ${keep('fuel')} ELSE fuel END,
        odometer = CASE WHEN ${has('odometer')} THEN ${keep('odometer')}::int ELSE odometer END,
        licensing_due = CASE WHEN ${has('licensingDue')} THEN ${keep('licensingDue')}::date ELSE licensing_due END,
        insurance_due = CASE WHEN ${has('insuranceDue')} THEN ${keep('insuranceDue')}::date ELSE insurance_due END,
        notes = CASE WHEN ${has('notes')} THEN ${keep('notes')} ELSE notes END,
        status = CASE WHEN ${has('status')} THEN ${keep('status')} ELSE status END,
        updated_at = NOW()
      WHERE id = ${id} AND organization_id = ${actor.organizationId} AND deleted_at IS NULL
    `;
  } catch (error) {
    if (isDuplicatePlate(error)) throw new VehicleError('Já existe um carro com essa placa.', 409);
    throw error;
  }
  if (technicianId !== undefined) await moveCar(actor, id, current.technician_id, technicianId);
  await audit(actor, technicianId !== undefined && technicianId !== current.technician_id ? 'vehicle.assigned' : 'vehicle.updated', id, {
    plate: current.plate,
    fields: Object.keys(patch),
    technicianId: technicianId === undefined ? undefined : technicianId,
  });
}

/** Soft delete: the car leaves the lists and frees its plate; its history stays. */
export async function removeVehicle(actor: Actor, id: string) {
  const current = await requireVehicle(actor.organizationId, id);
  await moveCar(actor, id, current.technician_id, null);
  await sql`
    UPDATE vehicles SET deleted_at = NOW(), deleted_by = ${actor.userId}, updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${actor.organizationId}
  `;
  await audit(actor, 'vehicle.removed', id, { plate: current.plate });
}

export type AssignmentRow = { id: string; technicianId: string; technicianName: string | null; assignedAt: string; releasedAt: string | null };

export async function vehicleHistory(organizationId: string, id: string): Promise<AssignmentRow[]> {
  await requireVehicle(organizationId, id);
  const rows = await sql`
    SELECT a.id, a.technician_id, t.name AS technician_name, a.assigned_at, a.released_at
    FROM vehicle_assignments a
    LEFT JOIN technicians t ON t.id = a.technician_id
    WHERE a.vehicle_id = ${id} AND a.organization_id = ${organizationId}
    ORDER BY a.assigned_at DESC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    technicianId: String(row.technician_id),
    technicianName: (row.technician_name as string | null) ?? null,
    assignedAt: new Date(row.assigned_at as string).toISOString(),
    releasedAt: row.released_at ? new Date(row.released_at as string).toISOString() : null,
  }));
}
