import { sql } from './db';
import type { ScheduleSeedRow } from './schedule-planner';

export const PORTO_SCHEDULE_NOTE_PREFIX = 'Importado do Porto:';
const MANUAL_NOTE_PREFIX = 'Apontamento manual:';

type ProtectionMode = 'generated' | 'porto';

/**
 * The driver returns `date`-typed columns as JS Date objects (constructed at local midnight for
 * that calendar date), not plain 'YYYY-MM-DD' strings. `String(dateObject)` calls
 * Date.prototype.toString(), which starts with a weekday abbreviation ("Sat Aug 01 2026...") and
 * never matches a plain date string under any timezone — so comparing that against
 * `ScheduleSeedRow.date` ("2026-08-01") always fails. Use local getters (matching how the Date was
 * constructed) to recover the real calendar-date key instead of relying on string coercion.
 */
function toDateKey(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

type ReplaceScheduleRowsParams = {
  organizationId: string;
  /** Who replaced the rows (null for automated jobs) — recorded on the rows marked deleted. */
  actorId?: string | null;
  technicianIds: string[];
  startDate: string;
  endDate: string;
  rows: ScheduleSeedRow[];
};

async function replaceScheduleRows(params: ReplaceScheduleRowsParams & { mode: ProtectionMode }) {
  const { organizationId, technicianIds, startDate, endDate, rows, mode } = params;
  const actorId = params.actorId ?? null;

  // 'generated' (internal "Montar escala" wizard) also treats Porto-imported rows as protected,
  // so it never clobbers data that already came from the source of truth. The Porto import job
  // itself uses 'porto' mode, which is allowed to replace its own previously-imported rows
  // (idempotent re-import) while still never touching completed or manually-entered days.
  const protectedClause =
    mode === 'generated'
      ? `(status = 'completed' OR notes LIKE '${MANUAL_NOTE_PREFIX}%' OR notes LIKE '${PORTO_SCHEDULE_NOTE_PREFIX}%')`
      : `(status = 'completed' OR notes LIKE '${MANUAL_NOTE_PREFIX}%')`;

  const replaceClause =
    mode === 'generated'
      ? `status <> 'completed' AND COALESCE(notes, '') NOT LIKE '${MANUAL_NOTE_PREFIX}%' AND COALESCE(notes, '') NOT LIKE '${PORTO_SCHEDULE_NOTE_PREFIX}%'`
      : `status <> 'completed' AND COALESCE(notes, '') NOT LIKE '${MANUAL_NOTE_PREFIX}%'`;

  const preservedRows = await sql.query(
    `
      SELECT technician_id, date
      FROM schedule
      WHERE organization_id = $1
        AND technician_id = ANY($2)
        AND date >= $3
        AND date <= $4
        AND deleted_at IS NULL
        AND ${protectedClause}
    `,
    [organizationId, technicianIds, startDate, endDate],
  );

  const preservedKeys = new Set(
    preservedRows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`),
  );

  const filteredRows = rows.filter((row) => !preservedKeys.has(`${row.technician_id}::${row.date}`));

  const inserted = await sql.query(
    `
      WITH replaced AS (
        UPDATE schedule
        SET deleted_at = NOW(), deleted_by = $6, updated_at = NOW()
        WHERE organization_id = $1
          AND technician_id = ANY($2)
          AND date >= $3
          AND date <= $4
          AND deleted_at IS NULL
          AND ${replaceClause}
        RETURNING 1
      ),
      input_rows AS (
        SELECT *
        FROM jsonb_to_recordset($5::jsonb) AS item(
          technician_id uuid,
          date date,
          start_time time,
          end_time time,
          status schedule_status,
          notes text
        )
      )
      INSERT INTO schedule (
        organization_id, technician_id, date, start_time, end_time, status, notes
      )
      SELECT $1, technician_id, date, start_time, end_time, status, notes
      FROM input_rows
      RETURNING id, technician_id, date, start_time, end_time, status, notes, created_at
    `,
    [organizationId, technicianIds, startDate, endDate, JSON.stringify(filteredRows), actorId],
  );

  return { inserted, preservedCount: preservedKeys.size };
}

/**
 * Used by the internal "Montar escala" generator. Never overwrites completed or manually-entered
 * days. Who owns the escala depends on the Porto automation (product owner, 2026-10-06): while it's
 * on, Porto rules — its imported days stay protected here (and the daily import replaces generated
 * rows anyway); while it's off, the generator rules — Porto-imported days are replaceable too.
 */
export async function replaceGeneratedScheduleRows(params: ReplaceScheduleRowsParams & { portoAutomationEnabled: boolean }) {
  const { portoAutomationEnabled, ...rest } = params;
  return replaceScheduleRows({ ...rest, mode: portoAutomationEnabled ? 'generated' : 'porto' });
}

/**
 * Used only by the Porto schedule-import job. Never overwrites completed or manually-entered
 * days. Unlike `replaceGeneratedScheduleRows`, it does NOT treat its own prior `Importado do
 * Porto:` rows as protected — so it replaces them freely, making re-imports idempotent. Note this
 * means it also replaces any other non-completed/non-manual row in scope (e.g. a plain
 * `status='scheduled'` row the internal "Montar escala" wizard created before Porto import was
 * ever enabled for that period) — same broad replace-scope the internal generator itself already
 * uses against arbitrary pre-existing rows, just without excluding Porto's own output from it.
 */
export async function replacePortoScheduleRows(params: ReplaceScheduleRowsParams) {
  return replaceScheduleRows({ ...params, mode: 'porto' });
}
