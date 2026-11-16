import { recordAudit } from '../audit';
import { sql } from '../db';
import { brasiliaDateKey } from '../formatters';
import { notifyFineNotice } from '../whatsapp/notifications';
import { resolveNotifications } from '../notifications';
import { indicationState, fineStage, summarizeFines, type AppealStatus, type DriverStance, type FineInput, type FineStage } from './fines-rules';
import { VehicleError, type Actor } from './store';

export type FineRow = {
  id: string;
  vehicleId: string;
  plate: string;
  carName: string;
  technicianId: string | null;
  technicianName: string | null;
  aitNumber: string | null;
  infractionAt: string;
  description: string;
  location: string | null;
  authority: string | null;
  amount: number;
  points: number | null;
  receivedOn: string | null;
  indicationDeadline: string | null;
  paymentDue: string | null;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: 'technician' | 'admin' | null;
  driverStance: DriverStance | null;
  driverNote: string | null;
  indicatedAt: string | null;
  appealStatus: AppealStatus;
  paidAt: string | null;
  notes: string | null;
  stage: FineStage;
  /** Typed by the admin, or found by the weekly lookup. */
  source: 'manual' | 'auto';
  createdAt: string;
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

function toRow(row: Record<string, unknown>): FineRow {
  const base = {
    technicianId: (row.technician_id as string | null) ?? null,
    notifiedAt: iso(row.notified_at),
    acknowledgedAt: iso(row.acknowledged_at),
    indicatedAt: iso(row.indicated_at),
    appealStatus: String(row.appeal_status) as AppealStatus,
    paidAt: (row.paid_at_text as string | null) ?? null,
    indicationDeadline: (row.indication_deadline_text as string | null) ?? null,
  };
  return {
    id: String(row.id),
    vehicleId: String(row.vehicle_id),
    plate: String(row.plate),
    carName: [row.brand, row.model].filter(Boolean).join(' '),
    technicianName: (row.technician_name as string | null) ?? null,
    aitNumber: (row.ait_number as string | null) ?? null,
    infractionAt: new Date(row.infraction_at as string).toISOString(),
    description: String(row.description),
    location: (row.location as string | null) ?? null,
    authority: (row.authority as string | null) ?? null,
    amount: Number(row.amount),
    points: row.points === null ? null : Number(row.points),
    receivedOn: (row.received_on_text as string | null) ?? null,
    paymentDue: (row.payment_due_text as string | null) ?? null,
    acknowledgedBy: (row.acknowledged_by as 'technician' | 'admin' | null) ?? null,
    driverStance: (row.driver_stance as DriverStance | null) ?? null,
    driverNote: (row.driver_note as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    stage: fineStage(base),
    source: row.source === 'auto' ? 'auto' : 'manual',
    createdAt: new Date(row.created_at as string).toISOString(),
    ...base,
  };
}

// The columns every list needs, with the dates as plain text (a DATE must not slide a day through the time zone).
const SELECT_FINES = `
  SELECT f.*, f.received_on::text AS received_on_text, f.indication_deadline::text AS indication_deadline_text,
         f.payment_due::text AS payment_due_text, f.paid_at::text AS paid_at_text,
         v.plate, v.brand, v.model, t.name AS technician_name
  FROM vehicle_fines f
  JOIN vehicles v ON v.id = f.vehicle_id
  LEFT JOIN technicians t ON t.id = f.technician_id
`;

/** Every fine of the company (newest infraction first), with the numbers the screen shows on top. */
export async function loadFines(organizationId: string, today = brasiliaDateKey()) {
  const rows = await sql.query(`${SELECT_FINES} WHERE f.organization_id = $1 AND f.deleted_at IS NULL ORDER BY f.infraction_at DESC`, [organizationId]);
  const fines = rows.map(toRow);
  return { today, fines, summary: summarizeFines(fines, today) };
}

async function loadFine(organizationId: string, id: string): Promise<FineRow> {
  const rows = await sql.query(`${SELECT_FINES} WHERE f.id = $1 AND f.organization_id = $2 AND f.deleted_at IS NULL`, [id, organizationId]);
  if (!rows.length) throw new VehicleError('Multa não encontrada.', 404);
  return toRow(rows[0]);
}

async function requireCar(organizationId: string, vehicleId: string) {
  const rows = await sql`SELECT 1 FROM vehicles WHERE id = ${vehicleId} AND organization_id = ${organizationId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VehicleError('Carro não encontrado.', 404);
}

async function requireDriver(organizationId: string, technicianId: string) {
  const rows = await sql`SELECT 1 FROM technicians WHERE id = ${technicianId} AND organization_id = ${organizationId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VehicleError('Escolha um técnico da sua empresa.');
}

const isDuplicateAit = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

function audit(actor: Actor, action: string, fineId: string, details: Record<string, unknown>) {
  return recordAudit({
    organizationId: actor.organizationId,
    actorId: actor.userId,
    actorRole: actor.role,
    impersonationId: actor.impersonationId,
    action,
    targetType: 'vehicle_fine',
    targetId: fineId,
    details,
  });
}

export async function createFine(actor: Actor, input: Partial<FineInput>): Promise<string> {
  await requireCar(actor.organizationId, input.vehicleId as string);
  if (input.technicianId) await requireDriver(actor.organizationId, input.technicianId);
  try {
    const rows = await sql`
      INSERT INTO vehicle_fines (
        organization_id, vehicle_id, technician_id, ait_number, infraction_at, description, location, authority, amount, points,
        received_on, indication_deadline, payment_due, appeal_status, notes, created_by
      )
      VALUES (
        ${actor.organizationId}, ${input.vehicleId}, ${input.technicianId ?? null}, ${input.aitNumber ?? null}, ${input.infractionAt},
        ${input.description}, ${input.location ?? null}, ${input.authority ?? null}, ${input.amount ?? 0}, ${input.points ?? null},
        ${input.receivedOn ?? null}::date, ${input.indicationDeadline ?? null}::date, ${input.paymentDue ?? null}::date,
        ${input.appealStatus ?? 'none'}, ${input.notes ?? null}, ${actor.userId}
      )
      RETURNING id
    `;
    const id = String(rows[0].id);
    await audit(actor, 'fine.created', id, { vehicleId: input.vehicleId, aitNumber: input.aitNumber ?? null, amount: input.amount, technicianId: input.technicianId ?? null });
    return id;
  } catch (error) {
    if (isDuplicateAit(error)) throw new VehicleError('Essa multa (número do auto) já está cadastrada.', 409);
    throw error;
  }
}

/** Edits the fine and/or records progress (indicated, paid, aware, appeal). A new driver starts over: he has not been told yet. */
export async function updateFine(actor: Actor, id: string, patch: Partial<FineInput>) {
  const current = await loadFine(actor.organizationId, id);
  if (patch.vehicleId) await requireCar(actor.organizationId, patch.vehicleId);
  if (patch.technicianId) await requireDriver(actor.organizationId, patch.technicianId);

  const has = (key: keyof FineInput) => Object.prototype.hasOwnProperty.call(patch, key);
  const keep = (key: keyof FineInput) => (has(key) ? (patch[key] ?? null) : null);
  const driverChanged = has('technicianId') && (patch.technicianId ?? null) !== current.technicianId;
  const today = brasiliaDateKey();

  try {
    await sql`
      UPDATE vehicle_fines SET
        vehicle_id = CASE WHEN ${has('vehicleId')} THEN ${keep('vehicleId')}::uuid ELSE vehicle_id END,
        technician_id = CASE WHEN ${has('technicianId')} THEN ${keep('technicianId')}::uuid ELSE technician_id END,
        ait_number = CASE WHEN ${has('aitNumber')} THEN ${keep('aitNumber')} ELSE ait_number END,
        infraction_at = CASE WHEN ${has('infractionAt')} THEN ${keep('infractionAt')}::timestamptz ELSE infraction_at END,
        description = CASE WHEN ${has('description')} THEN ${keep('description')} ELSE description END,
        location = CASE WHEN ${has('location')} THEN ${keep('location')} ELSE location END,
        authority = CASE WHEN ${has('authority')} THEN ${keep('authority')} ELSE authority END,
        amount = CASE WHEN ${has('amount')} THEN ${keep('amount')}::numeric ELSE amount END,
        points = CASE WHEN ${has('points')} THEN ${keep('points')}::smallint ELSE points END,
        received_on = CASE WHEN ${has('receivedOn')} THEN ${keep('receivedOn')}::date ELSE received_on END,
        indication_deadline = CASE WHEN ${has('indicationDeadline')} THEN ${keep('indicationDeadline')}::date ELSE indication_deadline END,
        payment_due = CASE WHEN ${has('paymentDue')} THEN ${keep('paymentDue')}::date ELSE payment_due END,
        appeal_status = CASE WHEN ${has('appealStatus')} THEN ${keep('appealStatus')} ELSE appeal_status END,
        notes = CASE WHEN ${has('notes')} THEN ${keep('notes')} ELSE notes END,
        indicated_at = CASE WHEN ${has('indicated')} THEN (CASE WHEN ${patch.indicated === true} THEN COALESCE(indicated_at, NOW()) ELSE NULL END) ELSE indicated_at END,
        paid_at = CASE WHEN ${has('paid')} THEN (CASE WHEN ${patch.paid === true} THEN COALESCE(${keep('paidOn')}::date, paid_at, ${today}::date) ELSE NULL END) ELSE paid_at END,
        acknowledged_at = CASE
          WHEN ${driverChanged} THEN NULL
          WHEN ${has('acknowledged')} THEN (CASE WHEN ${patch.acknowledged === true} THEN COALESCE(acknowledged_at, NOW()) ELSE NULL END)
          ELSE acknowledged_at END,
        acknowledged_by = CASE
          WHEN ${driverChanged} THEN NULL
          WHEN ${has('acknowledged')} THEN (CASE WHEN ${patch.acknowledged === true} THEN COALESCE(acknowledged_by, 'admin') ELSE NULL END)
          ELSE acknowledged_by END,
        driver_stance = CASE WHEN ${driverChanged} OR (${has('acknowledged')} AND ${patch.acknowledged !== true}) THEN NULL ELSE driver_stance END,
        driver_note = CASE WHEN ${driverChanged} OR (${has('acknowledged')} AND ${patch.acknowledged !== true}) THEN NULL ELSE driver_note END,
        notified_at = CASE WHEN ${driverChanged} THEN NULL ELSE notified_at END,
        updated_at = NOW()
      WHERE id = ${id} AND organization_id = ${actor.organizationId} AND deleted_at IS NULL
    `;
  } catch (error) {
    if (isDuplicateAit(error)) throw new VehicleError('Essa multa (número do auto) já está cadastrada.', 409);
    throw error;
  }
  if (has('indicated') && patch.indicated === true) await resolveNotifications(actor.organizationId, `fleet:indicate:${id}`).catch(() => undefined);
  await audit(actor, 'fine.updated', id, { fields: Object.keys(patch), driverChanged });
}

export type NoticeOutcome = 'sent' | 'failed' | 'skipped' | 'duplicate' | 'off';

/** Tells the driver about the fine: marks it as told (so "Minhas multas" shows it) and sends the WhatsApp when it is turned on. */
export async function notifyDriver(actor: Actor, id: string): Promise<{ outcome: NoticeOutcome; error: string | null }> {
  const fine = await loadFine(actor.organizationId, id);
  if (!fine.technicianId) throw new VehicleError('Defina o condutor antes de avisar o prestador.');
  const rows = await sql`
    UPDATE vehicle_fines SET notified_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${actor.organizationId} AND deleted_at IS NULL
    RETURNING notified_at
  `;
  const notifiedAt = new Date(rows[0].notified_at as string).toISOString();
  const result = await notifyFineNotice(actor.organizationId, {
    fineId: id,
    technicianId: fine.technicianId,
    plate: fine.plate,
    infractionAt: fine.infractionAt,
    description: fine.description,
    amount: fine.amount,
    deadline: fine.indicationDeadline,
    notifiedAt,
  }).catch((error) => ({ outcome: 'failed' as const, error: error instanceof Error ? error.message : 'Falha ao enviar.' }));
  await audit(actor, 'fine.notified', id, { technicianId: fine.technicianId, whatsapp: result?.outcome ?? 'off' });
  return result ? { outcome: result.outcome, error: result.error } : { outcome: 'off', error: null };
}

/** Soft delete: the fine leaves the lists, nothing is erased. */
export async function removeFine(actor: Actor, id: string) {
  await loadFine(actor.organizationId, id);
  await sql`
    UPDATE vehicle_fines SET deleted_at = NOW(), deleted_by = ${actor.userId}, updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${actor.organizationId}
  `;
  await resolveNotifications(actor.organizationId, `fleet:indicate:${id}`).catch(() => undefined);
  await audit(actor, 'fine.removed', id, {});
}

// ---------------------------------------------------------------------------------------------------------- the technician

/** What the driver sees of his own fine: never the internal notes, never a fine he has not been told about. */
export type MyFine = Pick<
  FineRow,
  'id' | 'plate' | 'carName' | 'aitNumber' | 'infractionAt' | 'description' | 'location' | 'authority' | 'amount' | 'points' | 'indicationDeadline' | 'paymentDue' | 'notifiedAt' | 'acknowledgedAt' | 'driverStance' | 'driverNote' | 'paidAt'
> & { status: 'to_answer' | 'answered' | 'closed' };

export async function listMyFines(organizationId: string, technicianId: string): Promise<MyFine[]> {
  const rows = await sql.query(
    `${SELECT_FINES} WHERE f.organization_id = $1 AND f.technician_id = $2 AND f.deleted_at IS NULL AND f.notified_at IS NOT NULL ORDER BY f.infraction_at DESC`,
    [organizationId, technicianId],
  );
  return rows.map((row) => {
    const fine = toRow(row);
    return {
      id: fine.id,
      plate: fine.plate,
      carName: fine.carName,
      aitNumber: fine.aitNumber,
      infractionAt: fine.infractionAt,
      description: fine.description,
      location: fine.location,
      authority: fine.authority,
      amount: fine.amount,
      points: fine.points,
      indicationDeadline: fine.indicationDeadline,
      paymentDue: fine.paymentDue,
      notifiedAt: fine.notifiedAt,
      acknowledgedAt: fine.acknowledgedAt,
      driverStance: fine.driverStance,
      driverNote: fine.driverNote,
      paidAt: fine.paidAt,
      status: fine.stage === 'resolved' ? 'closed' : fine.acknowledgedAt ? 'answered' : 'to_answer',
    };
  });
}

/** Whether a technician has anything to do in "Minhas multas": a car in his hands or a fine he was told about. */
export async function technicianHasFleet(organizationId: string, technicianId: string): Promise<boolean> {
  const rows = await sql`
    SELECT (
      EXISTS (SELECT 1 FROM vehicles WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM vehicle_fines WHERE organization_id = ${organizationId} AND technician_id = ${technicianId} AND deleted_at IS NULL AND notified_at IS NOT NULL)
    ) AS has_fleet
  `;
  return Boolean(rows[0]?.has_fleet);
}

/** The driver says he is aware and whether he agrees. He can change his answer until the fine is resolved. */
export async function respondToFine(
  organizationId: string,
  userId: string,
  technicianId: string,
  id: string,
  response: { stance: DriverStance; note: string | null },
) {
  const rows = await sql`
    UPDATE vehicle_fines SET
      acknowledged_at = COALESCE(acknowledged_at, NOW()), acknowledged_by = 'technician',
      driver_stance = ${response.stance}, driver_note = ${response.note}, updated_at = NOW()
    WHERE id = ${id} AND organization_id = ${organizationId} AND technician_id = ${technicianId}
      AND deleted_at IS NULL AND notified_at IS NOT NULL
    RETURNING id
  `;
  if (!rows.length) throw new VehicleError('Multa não encontrada.', 404);
  await recordAudit({
    organizationId,
    actorId: userId,
    actorRole: 'technician',
    impersonationId: null,
    action: 'fine.acknowledged',
    targetType: 'vehicle_fine',
    targetId: id,
    details: { stance: response.stance },
  });
}

// ------------------------------------------------------------------------------------------------------------ the bell

/** Fines whose time to name the driver is running out, and the car papers about to expire: the admin's bell. Safe to run often. */
export async function loadFleetAlerts(organizationId: string, today: string) {
  const { fines } = await loadFines(organizationId, today);
  const urgent = fines.filter((fine) => {
    const state = indicationState(fine, today);
    return fineStage(fine) !== 'resolved' && (state === 'soon' || state === 'overdue');
  });
  return { today, urgent, fineCount: fines.length };
}
