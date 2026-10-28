import { sql } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { isUuid } from '@/lib/platform/errors';
import { getPortoConfig } from '@/lib/porto-sync-log';
import { replaceGeneratedScheduleRows } from '@/lib/schedule-write-service';
import {
  buildPersistedSchedule,
  getScheduleRange,
  normalizeTechnicianIds,
  type ScheduleDayRuleKey,
  type ScheduleGenerationInput,
} from '@/lib/schedule-planner';

const DAY_RULE_KEYS: ScheduleDayRuleKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

async function isActiveTechnician(organizationId: string, technicianId: string) {
  const technicians = await sql`
    SELECT status
    FROM technicians
    WHERE id = ${technicianId}
      AND organization_id = ${organizationId}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  return technicians[0]?.status === 'active';
}

function isValidTime(value: unknown) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** A real calendar day: JavaScript would roll 2026-02-31 over to March 3, the database refuses it. */
function isValidDateKey(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isEmptyTimeValue(value: unknown) {
  return value === undefined || value === null || value === '';
}

function isOptionalTimeRange(startTime: unknown, endTime: unknown) {
  if (isEmptyTimeValue(startTime) && isEmptyTimeValue(endTime)) {
    return true;
  }

  return isValidTime(startTime) && isValidTime(endTime) && String(startTime) < String(endTime);
}

function normalizeOptionalTime(value: unknown) {
  return isValidTime(value) ? String(value) : undefined;
}

function isValidScheduleStatus(value: unknown): value is 'scheduled' | 'completed' | 'cancelled' {
  return value === 'scheduled' || value === 'completed' || value === 'cancelled';
}

function isWeekendRotationCadence(value: unknown) {
  return value === undefined || value === 'weekly' || value === 'alternating';
}

function isWeekendRule(value: unknown): value is ScheduleGenerationInput['saturday_rule'] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const mode = (value as { mode?: unknown }).mode;
  const technicianIds = (value as { technician_ids?: unknown }).technician_ids;
  const rotationCadence = (value as { rotation_cadence?: unknown }).rotation_cadence;
  const startTime = (value as { start_time?: unknown }).start_time;
  const endTime = (value as { end_time?: unknown }).end_time;

  return (
    (mode === 'off' || mode === 'all' || mode === 'rotation' || mode === 'selected') &&
    Array.isArray(technicianIds) &&
    technicianIds.every((item) => typeof item === 'string') &&
    isWeekendRotationCadence(rotationCadence) &&
    isOptionalTimeRange(startTime, endTime)
  );
}

function normalizeWeekendRule(value: unknown): ScheduleGenerationInput['saturday_rule'] {
  const rule = value as {
    mode: ScheduleGenerationInput['saturday_rule']['mode'];
    technician_ids: string[];
    rotation_cadence?: unknown;
    start_time?: unknown;
    end_time?: unknown;
  };

  return {
    mode: rule.mode,
    technician_ids: normalizeTechnicianIds(Array.isArray(rule.technician_ids) ? rule.technician_ids : []),
    rotation_cadence: rule.rotation_cadence === 'alternating' ? 'alternating' : 'weekly',
    start_time: normalizeOptionalTime(rule.start_time),
    end_time: normalizeOptionalTime(rule.end_time),
  };
}

function isDayKeyList(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => DAY_RULE_KEYS.includes(item as ScheduleDayRuleKey));
}

function isRotationGroup(value: unknown): value is NonNullable<ScheduleGenerationInput['rotation_groups']>[number] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const dayKeys = (value as { day_keys?: unknown }).day_keys;
  const technicianIds = (value as { technician_ids?: unknown }).technician_ids;
  const rotationCadence = (value as { rotation_cadence?: unknown }).rotation_cadence;
  const label = (value as { label?: unknown }).label;

  return (
    isDayKeyList(dayKeys) &&
    Array.isArray(technicianIds) &&
    technicianIds.every((item) => typeof item === 'string') &&
    isWeekendRotationCadence(rotationCadence) &&
    (label === undefined || typeof label === 'string')
  );
}

function normalizeRotationGroup(value: NonNullable<ScheduleGenerationInput['rotation_groups']>[number]) {
  return {
    label: value.label?.trim() || '',
    day_keys: Array.from(new Set(value.day_keys.filter((dayKey) => DAY_RULE_KEYS.includes(dayKey)))) as ScheduleDayRuleKey[],
    technician_ids: normalizeTechnicianIds(value.technician_ids),
    rotation_cadence: value.rotation_cadence === 'alternating' ? 'alternating' : 'weekly',
  } satisfies NonNullable<ScheduleGenerationInput['rotation_groups']>[number];
}

function isRecurringRule(value: unknown): value is NonNullable<ScheduleGenerationInput['recurring_rules']>[number] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const technicianId = (value as { technician_id?: unknown }).technician_id;
  const dayKeys = (value as { day_keys?: unknown }).day_keys;
  const status = (value as { status?: unknown }).status;
  const startTime = (value as { start_time?: unknown }).start_time;
  const endTime = (value as { end_time?: unknown }).end_time;
  const notes = (value as { notes?: unknown }).notes;

  return (
    typeof technicianId === 'string' &&
    isDayKeyList(dayKeys) &&
    isValidScheduleStatus(status) &&
    isOptionalTimeRange(startTime, endTime) &&
    (notes === undefined || typeof notes === 'string')
  );
}

function normalizeRecurringRule(value: NonNullable<ScheduleGenerationInput['recurring_rules']>[number]) {
  return {
    technician_id: value.technician_id,
    day_keys: Array.from(new Set(value.day_keys.filter((dayKey) => DAY_RULE_KEYS.includes(dayKey)))) as ScheduleDayRuleKey[],
    status: value.status,
    start_time: normalizeOptionalTime(value.start_time),
    end_time: normalizeOptionalTime(value.end_time),
    notes: typeof value.notes === 'string' ? value.notes : '',
  } satisfies NonNullable<ScheduleGenerationInput['recurring_rules']>[number];
}

function isDayRules(value: unknown) {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.entries(value).every(([key, rule]) => DAY_RULE_KEYS.includes(key as ScheduleDayRuleKey) && isWeekendRule(rule));
}

function normalizeDayRules(value: unknown): ScheduleGenerationInput['day_rules'] {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const entries = DAY_RULE_KEYS.flatMap((dayKey) => {
    const rule = (value as Record<string, unknown>)[dayKey];
    return isWeekendRule(rule) ? ([[dayKey, normalizeWeekendRule(rule)] as const]) : [];
  });

  return entries.length ? Object.fromEntries(entries) as ScheduleGenerationInput['day_rules'] : undefined;
}

function parseGenerationInput(value: unknown): ScheduleGenerationInput | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const periodMode = raw.period_mode;
  const year = Number(raw.year);
  const month = raw.month === undefined || raw.month === null || raw.month === '' ? undefined : Number(raw.month);
  const date = typeof raw.date === 'string' ? raw.date : undefined;
  const technicianScope = raw.technician_scope;
  // Ids go to a uuid column: anything else would fail the whole request with a 500.
  const technicianIds = Array.isArray(raw.technician_ids) ? raw.technician_ids.filter((item): item is string => typeof item === 'string' && isUuid(item)) : [];
  const generalDaysOff = Array.isArray(raw.general_days_off) ? raw.general_days_off : [];
  const overrides = Array.isArray(raw.overrides) ? raw.overrides : [];
  const rotationGroups = Array.isArray(raw.rotation_groups) ? raw.rotation_groups : [];
  const recurringRules = Array.isArray(raw.recurring_rules) ? raw.recurring_rules : [];

  if ((periodMode !== 'day' && periodMode !== 'week' && periodMode !== 'month' && periodMode !== 'year') || !Number.isInteger(year) || year < 2020 || year > 2100) {
    return null;
  }

  if ((periodMode === 'day' || periodMode === 'week') && !isValidDateKey(date)) {
    return null;
  }

  if (periodMode === 'month' && (!Number.isInteger(month) || Number(month) < 1 || Number(month) > 12)) {
    return null;
  }

  if ((technicianScope !== 'all' && technicianScope !== 'selected') || !isValidTime(raw.weekday_start_time) || !isValidTime(raw.weekday_end_time) || !isValidTime(raw.weekend_start_time) || !isValidTime(raw.weekend_end_time) || !isWeekendRule(raw.saturday_rule) || !isWeekendRule(raw.sunday_rule) || !isDayRules(raw.day_rules) || !rotationGroups.every(isRotationGroup) || !recurringRules.every(isRecurringRule)) {
    return null;
  }

  const parsedGeneralDaysOff = generalDaysOff
    // A blank or impossible date is left out (an invalid one would fail the whole insert).
    .filter((item): item is { date: string; notes?: string } => typeof item === 'object' && item !== null && isValidDateKey((item as { date?: unknown }).date))
    .map((item) => ({
      date: String(item.date),
      notes: typeof item.notes === 'string' ? item.notes : '',
    }));

  const parsedOverrides = overrides
    .filter(
      (item): item is { technician_id: string; date: string; status: 'scheduled' | 'completed' | 'cancelled'; start_time?: string; end_time?: string; notes?: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { technician_id?: unknown }).technician_id === 'string' &&
        isValidDateKey((item as { date?: unknown }).date) &&
        isValidScheduleStatus((item as { status?: unknown }).status),
    )
    .map((item) => ({
      technician_id: item.technician_id,
      date: item.date,
      status: item.status,
      start_time: isValidTime(item.start_time) ? item.start_time : undefined,
      end_time: isValidTime(item.end_time) ? item.end_time : undefined,
      notes: typeof item.notes === 'string' ? item.notes : '',
    }));

  const parsedRotationGroups = rotationGroups.map((group) => normalizeRotationGroup(group as NonNullable<ScheduleGenerationInput['rotation_groups']>[number]));
  const parsedRecurringRules = recurringRules.map((rule) => normalizeRecurringRule(rule as NonNullable<ScheduleGenerationInput['recurring_rules']>[number]));

  return {
    period_mode: periodMode,
    year,
    month,
    date,
    technician_scope: technicianScope,
    technician_ids: technicianIds,
    weekday_start_time: String(raw.weekday_start_time),
    weekday_end_time: String(raw.weekday_end_time),
    weekend_start_time: String(raw.weekend_start_time),
    weekend_end_time: String(raw.weekend_end_time),
    saturday_rule: normalizeWeekendRule(raw.saturday_rule),
    sunday_rule: normalizeWeekendRule(raw.sunday_rule),
    day_rules: normalizeDayRules(raw.day_rules),
    rotation_groups: parsedRotationGroups,
    recurring_rules: parsedRecurringRules,
    general_days_off: parsedGeneralDaysOff,
    overrides: parsedOverrides,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const technicianId = searchParams.get('technicianId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if ((startDate && !isValidDateKey(startDate)) || (endDate && !isValidDateKey(endDate)) || (technicianId && !isUuid(technicianId))) {
      return NextResponse.json({ error: 'Período ou técnico inválido.' }, { status: 400 });
    }

    let query = `
      SELECT s.id, s.technician_id, s.date, s.start_time, s.end_time, s.status, s.notes, s.created_at,
             t.name as technician_name
      FROM schedule s
      LEFT JOIN technicians t ON t.id = s.technician_id
    `;

    const params: string[] = [auth.organizationId];
    const conditions = ['s.organization_id = $1', 's.deleted_at IS NULL'];

    // A technician only ever sees their own schedule, whatever technicianId the request names.
    if (auth.role === 'technician') {
      conditions.push(`s.technician_id = $${params.length + 1}`);
      params.push(auth.technicianId || auth.userId);
    } else if (technicianId) {
      conditions.push(`s.technician_id = $${params.length + 1}`);
      params.push(technicianId);
    }

    conditions.push(`t.status = 'active'`, 't.deleted_at IS NULL');

    if (startDate) {
      conditions.push(`s.date >= $${params.length + 1}`);
      params.push(startDate);
    }

    if (endDate) {
      conditions.push(`s.date <= $${params.length + 1}`);
      params.push(endDate);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY s.date ASC`;

    const schedules = await sql.query(query, params);
    return NextResponse.json({ schedules });
  } catch (error) {
    console.error('[v0] Get schedule error:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 401 }
      );
    }

    const {
      technician_id,
      date,
      start_time,
      end_time,
      status = 'scheduled',
      notes,
    } = await request.json();

    if (typeof technician_id !== 'string' || !isUuid(technician_id) || !isValidDateKey(date) || !isValidScheduleStatus(status) || !isOptionalTimeRange(start_time, end_time)) {
      return NextResponse.json({ error: 'Informe técnico, data, situação e horários válidos.' }, { status: 400 });
    }

    if (!(await isActiveTechnician(auth.organizationId, technician_id))) {
      return NextResponse.json(
        { error: 'Selecione um técnico ativo para lançar escala.' },
        { status: 409 }
      );
    }

    const result = await sql`
      INSERT INTO schedule (
        organization_id, technician_id, date, start_time, end_time, status, notes
      )
      VALUES (
        ${auth.organizationId}, ${technician_id}, ${date}, ${normalizeOptionalTime(start_time) ?? null}, ${normalizeOptionalTime(end_time) ?? null}, ${status}, ${typeof notes === 'string' && notes ? notes : null}
      )
      RETURNING *
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[v0] Create schedule error:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role !== 'admin') {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 401 }
      );
    }

    const parsedInput = parseGenerationInput(await request.json());

    if (!parsedInput) {
      return NextResponse.json(
        { error: 'Payload de escala inválido.' },
        { status: 400 }
      );
    }

    const techniciansQuery =
      parsedInput.technician_scope === 'selected'
        ? await sql.query(
            `
              SELECT id, name
              FROM technicians
              WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL AND id = ANY($2)
              ORDER BY name ASC
            `,
            [auth.organizationId, normalizeTechnicianIds(parsedInput.technician_ids)],
          )
        : await sql`
            SELECT id, name
            FROM technicians
            WHERE organization_id = ${auth.organizationId} AND status = 'active' AND deleted_at IS NULL
            ORDER BY name ASC
          `;

    const targetTechnicianIds = normalizeTechnicianIds(
      techniciansQuery.map((technician) => String(technician.id)),
    );

    if (!targetTechnicianIds.length) {
      return NextResponse.json(
        { error: 'Nenhum técnico ativo encontrado para montar a escala.' },
        { status: 400 }
      );
    }

    const { startDate, endDate } = getScheduleRange(parsedInput.period_mode, parsedInput.year, parsedInput.month, parsedInput.date);

    const generatedRows = buildPersistedSchedule(parsedInput, targetTechnicianIds);

    // Porto automation on: Porto owns the escala (its imported days are kept). Off: this generator does.
    const portoAutomationEnabled = Boolean((await getPortoConfig(auth.organizationId))?.automation_enabled);
    const { inserted: persistedSchedules, preservedCount } = await replaceGeneratedScheduleRows({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      technicianIds: targetTechnicianIds,
      startDate,
      endDate,
      rows: generatedRows,
      portoAutomationEnabled,
    });

    return NextResponse.json(
      {
        schedules: persistedSchedules,
        summary: {
          startDate,
          endDate,
          technicians: targetTechnicianIds.length,
          preservedCompleted: preservedCount,
          inserted: persistedSchedules.length,
          portoAutomationEnabled,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[v0] Replace schedule error:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
