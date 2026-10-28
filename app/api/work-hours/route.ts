import { sql } from '@/lib/db';
import { after, NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { isUuid } from '@/lib/platform/errors';
import { notifyJustified } from '@/lib/whatsapp/notifications';
import { applyWorkHourEntries, attendanceHasHours, getActiveTechnicianIds, getIsoWeekNumber, type AttendanceStatus, type WorkHourEntry } from '@/lib/work-hours-service';

function isValidTime(value: unknown) {
  return typeof value === 'string' && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(value);
}

function normalizeTime(value: unknown) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return '';

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** A real calendar day: JavaScript would roll 2026-02-31 over to March 3, the database refuses it. */
function isValidDateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseHours(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 24 ? Number(parsed.toFixed(2)) : null;
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return value === 'worked' || value === 'day_off' || value === 'missed' || value === 'justified' || value === 'cancelled_service';
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');
    const month = searchParams.get('month');

    let query = `
      SELECT id, technician_id, date, start_time, end_time, hours_worked,
             week_number, month, year, created_at
      FROM work_hours
    `;

    const params: string[] = [auth.organizationId];
    const conditions = [
      'organization_id = $1',
      'deleted_at IS NULL',
      `EXISTS (SELECT 1 FROM technicians t WHERE t.id = work_hours.technician_id AND t.status = 'active' AND t.deleted_at IS NULL)`,
    ];

    // A technician only ever sees their own hours, whatever technicianId the request names.
    if (auth.role === 'technician') {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(auth.technicianId || auth.userId);
    } else if (technicianId) {
      conditions.push(`technician_id = $${params.length + 1}`);
      params.push(technicianId);
    }

    if (month) {
      conditions.push(`TO_CHAR(date::date, 'YYYY-MM') = $${params.length + 1}`);
      params.push(month);
    }

    query += ` WHERE ${conditions.join(' AND ')}`;
    query += ` ORDER BY date DESC`;

    const workHours = await sql.query(query, params);
    return NextResponse.json({ workHours });
  } catch (error) {
    console.error('[v0] Get work hours error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();

    if (auth.role === 'admin' && Array.isArray(body?.entries)) {
      const parsedEntries: WorkHourEntry[] = (body.entries as unknown[])
        .map((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) {
            return null;
          }

          const raw = entry as Record<string, unknown>;
          const date = String(raw.date ?? '');
          const technicianId = String(raw.technician_id ?? '');
          const attendanceStatus = isAttendanceStatus(raw.attendance_status) ? raw.attendance_status : 'worked';
          const startTime = normalizeTime(raw.start_time);
          const endTime = normalizeTime(raw.end_time);
          const plannedStartTime = normalizeTime(raw.planned_start_time) || startTime;
          const plannedEndTime = normalizeTime(raw.planned_end_time) || endTime;
          const hasHours = attendanceHasHours(attendanceStatus);
          const parsedHoursWorked = hasHours ? parseHours(raw.hours_worked) : 0;

          if (
            !isUuid(technicianId) ||
            !isValidDateKey(date) ||
            !isValidTime(plannedStartTime) ||
            !isValidTime(plannedEndTime) ||
            (hasHours && (!isValidTime(startTime) || !isValidTime(endTime) || parsedHoursWorked === null))
          ) {
            return null;
          }

          return {
            technician_id: technicianId,
            date,
            start_time: hasHours ? startTime : plannedStartTime,
            end_time: hasHours ? endTime : plannedEndTime,
            planned_start_time: plannedStartTime,
            planned_end_time: plannedEndTime,
            hours_worked: parsedHoursWorked ?? 0,
            week_number: Number.isInteger(Number(raw.week_number)) ? Number(raw.week_number) : getIsoWeekNumber(date),
            month: Number.isInteger(Number(raw.month)) ? Number(raw.month) : Number(date.slice(5, 7)),
            year: Number.isInteger(Number(raw.year)) ? Number(raw.year) : Number(date.slice(0, 4)),
            attendance_status: attendanceStatus,
            notes: typeof raw.notes === 'string' ? raw.notes : '',
          };
        })
        .filter((entry: WorkHourEntry | null): entry is WorkHourEntry => Boolean(entry));

      if (!parsedEntries.length) {
        return NextResponse.json({ error: 'Nenhum apontamento válido informado.' }, { status: 400 });
      }

      const { workHours, schedules, count, skippedInactive } = await applyWorkHourEntries(auth.organizationId, parsedEntries, {
        source: 'manual',
        actorId: auth.userId,
      });

      if (!count) {
        return NextResponse.json({ error: 'Nenhum apontamento para tecnico ativo foi informado.' }, { status: 400 });
      }

      const justifiedEntries = parsedEntries
        .filter((entry) => entry.attendance_status === 'justified')
        .map((entry) => ({ technicianId: entry.technician_id, date: entry.date, notes: entry.notes }));

      if (justifiedEntries.length) {
        after(async () => {
          try {
            await notifyJustified(auth.organizationId, justifiedEntries);
          } catch (error) {
            console.error('[work-hours] WhatsApp notification failed:', error);
          }
        });
      }

      return NextResponse.json({ workHours, schedules, count, skippedInactive }, { status: 201 });
    }

    // Hours are an admin record: a technician posting their own would feed the hour bank and the
    // overtime of their payroll. Nothing in the app uses this single-entry form; the admin's
    // apontamento goes through `entries` above.
    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Apenas o administrador lança horas.' }, { status: 403 });
    }

    const {
      date,
      start_time,
      end_time,
      hours_worked,
      week_number,
      month,
      year,
    } = body;

    const technicianId = request.headers.get('x-technician-id');

    if (!isValidDateKey(date) || !isValidTime(start_time) || !isValidTime(end_time) || parseHours(hours_worked) === null) {
      return NextResponse.json({ error: 'Informe data, horários e horas válidos.' }, { status: 400 });
    }

    if (!isUuid(technicianId) || !(await getActiveTechnicianIds(auth.organizationId, [technicianId])).has(technicianId)) {
      return NextResponse.json({ error: 'Selecione um técnico ativo para lançar horas.' }, { status: 409 });
    }

    const result = await sql`
      INSERT INTO work_hours (
        organization_id, technician_id, date, start_time, end_time, hours_worked,
        week_number, month, year
      )
      VALUES (
        ${auth.organizationId}, ${technicianId}, ${date}, ${normalizeTime(start_time)}, ${normalizeTime(end_time)}, ${parseHours(hours_worked)},
        ${Number.isInteger(Number(week_number)) ? Number(week_number) : getIsoWeekNumber(date)},
        ${Number.isInteger(Number(month)) ? Number(month) : Number(date.slice(5, 7))},
        ${Number.isInteger(Number(year)) ? Number(year) : Number(date.slice(0, 4))}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create work hours error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
