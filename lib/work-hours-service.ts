import { sql } from './db';
import { PORTO_LAUDO_PENDING_MARKER } from './organization-settings';

/**
 * `cancelled_service`: a day whose services were all cancelled (set by the Porto import, or by
 * hand). Its hours are recorded like `worked`, but the day's planned hours aren't charged — the
 * cancellation isn't the technician's doing.
 */
export type AttendanceStatus = 'worked' | 'day_off' | 'missed' | 'justified' | 'cancelled_service';

/** Statuses that record real hours (a work_hours row), as opposed to an absence. */
export function attendanceHasHours(status: AttendanceStatus) {
  return status === 'worked' || status === 'cancelled_service';
}
export type WorkHourSource = 'manual' | 'porto';

export type WorkHourEntry = {
  technician_id: string;
  date: string;
  start_time: string;
  end_time: string;
  planned_start_time: string;
  planned_end_time: string;
  hours_worked: number;
  week_number: number;
  month: number;
  year: number;
  attendance_status: AttendanceStatus;
  notes: string;
};

export function getIsoWeekNumber(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getScheduleStatusForAttendance(status: AttendanceStatus) {
  return attendanceHasHours(status) ? 'completed' : 'cancelled';
}

/**
 * The driver returns `date`-typed columns as JS Date objects (constructed at local midnight for
 * that calendar date), not plain 'YYYY-MM-DD' strings. `String(dateObject)` calls
 * Date.prototype.toString(), which starts with a weekday abbreviation ("Sat Aug 01 2026...") and
 * never matches a plain date string under any timezone. Use local getters (matching how the Date
 * was constructed) to recover the real calendar-date key instead of relying on string coercion.
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

function getAttendanceLabel(status: AttendanceStatus) {
  if (status === 'day_off') return 'folga';
  if (status === 'missed') return 'falta';
  if (status === 'justified') return 'justificado';
  if (status === 'cancelled_service') return 'serviço cancelado';
  return 'trabalhou';
}

function buildAttendanceNote(entry: WorkHourEntry) {
  const cleanNotes = entry.notes.trim();
  const base = `Apontamento manual: ${getAttendanceLabel(entry.attendance_status)}; previsto=${entry.planned_start_time}-${entry.planned_end_time}`;

  return cleanNotes ? `${base}; obs=${cleanNotes}` : base;
}

/**
 * Returns the set of "technicianId::date" keys that already have a Porto-imported work_hours row
 * within the given range — used by the hours-import job to skip re-fetching service detail pages
 * for days it has already covered, so a full month-to-date sweep stays cheap on every run after
 * the first catch-up.
 */
export async function getExistingPortoImportedDates(
  organizationId: string,
  technicianIds: string[],
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  if (!technicianIds.length) return new Set();

  const rows = await sql.query(
    `
      SELECT technician_id, date
      FROM work_hours
      WHERE organization_id = $1
        AND source = 'porto'
        AND technician_id = ANY($2)
        AND date >= $3
        AND date <= $4
        AND deleted_at IS NULL
    `,
    [organizationId, technicianIds, startDate, endDate],
  );

  return new Set(rows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`));
}

/**
 * Returns the "technicianId::date" keys an admin entered by hand within the range — the Porto
 * import must never overwrite these (its write replaces the day). A manual "worked" entry is a
 * `source='manual'` work_hours row; a manual folga/falta/justificado leaves no work_hours row at
 * all, only a schedule row with the manual note. The Porto import also writes that note prefix,
 * but always alongside its own `source='porto'` work_hours row, hence the NOT EXISTS.
 */
export async function getManualWorkHourDates(
  organizationId: string,
  technicianIds: string[],
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  if (!technicianIds.length) return new Set();

  const rows = await sql.query(
    `
      SELECT technician_id, date
      FROM work_hours
      WHERE organization_id = $1
        AND source = 'manual'
        AND technician_id = ANY($2)
        AND date >= $3
        AND date <= $4
        AND deleted_at IS NULL
      UNION
      SELECT s.technician_id, s.date
      FROM schedule s
      WHERE s.organization_id = $1
        AND s.notes LIKE 'Apontamento manual:%'
        AND s.technician_id = ANY($2)
        AND s.date >= $3
        AND s.date <= $4
        AND s.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM work_hours w
          WHERE w.organization_id = s.organization_id
            AND w.technician_id = s.technician_id
            AND w.date = s.date
            AND w.deleted_at IS NULL
        )
    `,
    [organizationId, technicianIds, startDate, endDate],
  );

  return new Set(rows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`));
}

/**
 * "technicianId::date" keys of Porto-imported days already flagged with a laudo warning. The hours
 * job never recomputes these: once given, the warning stays, even if the laudo is filled in
 * afterwards. Only a manual correction removes it.
 */
export async function getPortoWarningDates(
  organizationId: string,
  technicianIds: string[],
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  if (!technicianIds.length) return new Set();

  const rows = await sql.query(
    `
      SELECT s.technician_id, s.date
      FROM schedule s
      JOIN work_hours w
        ON w.organization_id = s.organization_id
       AND w.technician_id = s.technician_id
       AND w.date = s.date
       AND w.source = 'porto'
       AND w.deleted_at IS NULL
      WHERE s.organization_id = $1
        AND s.notes LIKE '%ADVERTÊNCIA%'
        AND s.technician_id = ANY($2)
        AND s.date >= $3
        AND s.date <= $4
        AND s.deleted_at IS NULL
    `,
    [organizationId, technicianIds, startDate, endDate],
  );

  return new Set(rows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`));
}

/**
 * Porto-imported days still waiting for their laudo ("LAUDO PENDENTE" in the note): the hours job
 * recomputes them every run, even outside the reprocess window, until the laudo is filled in or
 * the grace period ends (then the warning applies).
 */
export async function getPendingLaudoDates(
  organizationId: string,
  technicianIds: string[],
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  if (!technicianIds.length) return new Set();

  const rows = await sql.query(
    `
      SELECT s.technician_id, s.date
      FROM schedule s
      JOIN work_hours w
        ON w.organization_id = s.organization_id
       AND w.technician_id = s.technician_id
       AND w.date = s.date
       AND w.source = 'porto'
       AND w.deleted_at IS NULL
      WHERE s.organization_id = $1
        AND s.notes LIKE $5
        AND s.technician_id = ANY($2)
        AND s.date >= $3
        AND s.date <= $4
        AND s.deleted_at IS NULL
    `,
    [organizationId, technicianIds, startDate, endDate, `%${PORTO_LAUDO_PENDING_MARKER}%`],
  );

  return new Set(rows.map((row) => `${String(row.technician_id)}::${toDateKey(row.date)}`));
}

/** The oldest pending-laudo day of the organization since `sinceDate`, so a run's range reaches back to it. */
export async function getOldestPendingLaudoDate(organizationId: string, sinceDate: string): Promise<string | null> {
  const rows = await sql`
    SELECT MIN(s.date) AS date FROM schedule s
    JOIN work_hours w
      ON w.organization_id = s.organization_id
     AND w.technician_id = s.technician_id
     AND w.date = s.date
     AND w.source = 'porto'
     AND w.deleted_at IS NULL
    WHERE s.organization_id = ${organizationId}
      AND s.notes LIKE ${`%${PORTO_LAUDO_PENDING_MARKER}%`}
      AND s.date >= ${sinceDate}
      AND s.deleted_at IS NULL
  `;
  return rows[0]?.date ? toDateKey(rows[0].date) : null;
}

/** The "previsto" already recorded per "technicianId::date" (from the schedule note), when there is one. */
export async function getStoredPlannedTimes(
  organizationId: string,
  technicianIds: string[],
  startDate: string,
  endDate: string,
): Promise<Map<string, { start: string; end: string }>> {
  if (!technicianIds.length) return new Map();

  const rows = await sql.query(
    `
      SELECT technician_id, date, notes
      FROM schedule
      WHERE organization_id = $1
        AND notes LIKE '%previsto=%'
        AND technician_id = ANY($2)
        AND date >= $3
        AND date <= $4
        AND deleted_at IS NULL
    `,
    [organizationId, technicianIds, startDate, endDate],
  );

  const planned = new Map<string, { start: string; end: string }>();
  for (const row of rows) {
    const match = String(row.notes).match(/previsto=(\d{2}:\d{2})-(\d{2}:\d{2})/);
    if (match) planned.set(`${String(row.technician_id)}::${toDateKey(row.date)}`, { start: match[1], end: match[2] });
  }
  return planned;
}

export async function getActiveTechnicianIds(organizationId: string, technicianIds: string[]) {
  if (!technicianIds.length) {
    return new Set<string>();
  }

  const rows = await sql.query(
    `
      SELECT id
      FROM technicians
      WHERE organization_id = $1
        AND status = 'active'
        AND deleted_at IS NULL
        AND id = ANY($2)
    `,
    [organizationId, technicianIds],
  );
  return new Set(rows.map((row) => String(row.id)));
}

/**
 * Replaces each entry's day for its technician: the previous work_hours and schedule rows for that
 * day are marked deleted (never removed) and the new ones inserted.
 */
export async function applyWorkHourEntries(
  organizationId: string,
  entries: WorkHourEntry[],
  options: { source?: WorkHourSource; actorId?: string | null } = {},
) {
  const source: WorkHourSource = options.source ?? 'manual';
  const actorId = options.actorId ?? null;
  const activeTechnicianIds = await getActiveTechnicianIds(
    organizationId,
    Array.from(new Set(entries.map((entry) => entry.technician_id))),
  );
  const entriesForActiveTechnicians = entries.filter((entry) => activeTechnicianIds.has(entry.technician_id));
  const skippedInactive = entries.length - entriesForActiveTechnicians.length;

  const saved = [];
  const schedules = [];

  for (const entry of entriesForActiveTechnicians) {
    const hasHours = attendanceHasHours(entry.attendance_status);
    const scheduleStatus = getScheduleStatusForAttendance(entry.attendance_status);
    const scheduleNote = buildAttendanceNote(entry);

    // One transaction per day: a failure can't leave the day with its old hours archived and no new
    // ones (or the new hours without their schedule row).
    const results = await sql.transaction([
      sql`
        UPDATE work_hours
        SET deleted_at = NOW(), deleted_by = ${actorId}, updated_at = NOW()
        WHERE organization_id = ${organizationId}
          AND technician_id = ${entry.technician_id}
          AND date = ${entry.date}
          AND deleted_at IS NULL
      `,
      ...(hasHours
        ? [
            sql`
              INSERT INTO work_hours (
                organization_id, technician_id, date, start_time, end_time, hours_worked,
                week_number, month, year, source
              )
              VALUES (
                ${organizationId}, ${entry.technician_id}, ${entry.date}, ${entry.start_time}, ${entry.end_time}, ${entry.hours_worked},
                ${entry.week_number}, ${entry.month}, ${entry.year}, ${source}
              )
              RETURNING *
            `,
          ]
        : []),
      sql`
        UPDATE schedule
        SET deleted_at = NOW(), deleted_by = ${actorId}, updated_at = NOW()
        WHERE organization_id = ${organizationId}
          AND technician_id = ${entry.technician_id}
          AND date = ${entry.date}
          AND deleted_at IS NULL
      `,
      sql`
        INSERT INTO schedule (
          organization_id, technician_id, date, start_time, end_time, status, notes
        )
        VALUES (
          ${organizationId}, ${entry.technician_id}, ${entry.date}, ${entry.start_time}, ${entry.end_time}, ${scheduleStatus}, ${scheduleNote}
        )
        RETURNING *
      `,
    ]);

    if (hasHours) saved.push(results[1][0]);
    schedules.push(results[results.length - 1][0]);
  }

  return {
    workHours: saved,
    schedules,
    count: entriesForActiveTechnicians.length,
    skippedInactive,
  };
}
