import type { ScheduleStatus } from './types';
import { brasiliaNow } from './whatsapp/dates';

// Defaults mean Brasília's month/year: the server (UTC) is already in the next one from 21:00 on the last day.
const currentBrasiliaMonth = () => Number(brasiliaNow().monthKey.slice(5, 7));
const currentBrasiliaYear = () => Number(brasiliaNow().dateKey.slice(0, 4));

export type SchedulePeriodMode = 'day' | 'week' | 'month' | 'year';
export type ScheduleScopeMode = 'all' | 'selected';
export type WeekendCoverageMode = 'off' | 'all' | 'rotation' | 'selected';
/**
 * 'alternating' works in the even weeks of the calendar and 'alternating_off' in the odd ones ("semana sim, semana não"
 * and its opposite). Weeks are counted from a fixed Monday, never from the start of the period being built, so an
 * escala made month after month keeps alternating where the previous one stopped.
 */
export type WeekendRotationCadence = 'weekly' | 'alternating' | 'alternating_off';
export type ScheduleDayRuleKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface WeekendCoverageRule {
  mode: WeekendCoverageMode;
  technician_ids: string[];
  rotation_cadence?: WeekendRotationCadence;
  start_time?: string;
  end_time?: string;
}

export interface ScheduleRotationGroupInput {
  label?: string;
  day_keys: ScheduleDayRuleKey[];
  technician_ids: string[];
  rotation_cadence?: WeekendRotationCadence;
}

export interface ScheduleRecurringRuleInput {
  technician_id: string;
  day_keys: ScheduleDayRuleKey[];
  status: ScheduleStatus;
  start_time?: string;
  end_time?: string;
  notes?: string;
}

export interface ScheduleDayOffInput {
  date: string;
  notes?: string;
}

export interface ScheduleOverrideInput {
  technician_id: string;
  date: string;
  status: ScheduleStatus;
  start_time?: string;
  end_time?: string;
  notes?: string;
}

export interface ScheduleGenerationInput {
  period_mode: SchedulePeriodMode;
  year: number;
  month?: number;
  date?: string;
  technician_scope: ScheduleScopeMode;
  technician_ids: string[];
  weekday_start_time: string;
  weekday_end_time: string;
  weekend_start_time: string;
  weekend_end_time: string;
  saturday_rule: WeekendCoverageRule;
  sunday_rule: WeekendCoverageRule;
  day_rules?: Partial<Record<ScheduleDayRuleKey, WeekendCoverageRule>>;
  rotation_groups?: ScheduleRotationGroupInput[];
  recurring_rules?: ScheduleRecurringRuleInput[];
  general_days_off: ScheduleDayOffInput[];
  overrides: ScheduleOverrideInput[];
}

export interface ScheduleSeedRow {
  technician_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: ScheduleStatus;
  notes: string | null;
}

export interface ScheduleGenerationPreview {
  startDate: string;
  endDate: string;
  dayCount: number;
  technicianCount: number;
  totalRows: number;
}

interface DayAssignmentResult {
  workingTechnicians: Set<string>;
  eligibleTechnicians: Set<string>;
}

type DayKind = ScheduleDayRuleKey;

const DAY_LABELS: Record<DayKind, string> = {
  monday: 'segunda-feira',
  tuesday: 'terça-feira',
  wednesday: 'quarta-feira',
  thursday: 'quinta-feira',
  friday: 'sexta-feira',
  saturday: 'sábado',
  sunday: 'domingo',
};

const DEFAULT_WEEKDAY_RULE: WeekendCoverageRule = {
  mode: 'all',
  technician_ids: [],
  rotation_cadence: 'weekly',
};

const DEFAULT_OVERRIDE_NOTE: Record<ScheduleStatus, string> = {
  scheduled: 'Ajuste manual na escala',
  completed: 'Turno concluído',
  cancelled: 'Folga individual',
};

export function normalizeDateKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

export function createDateKey(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isDateKey(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getReferenceDate(date: string | undefined, year: number, month?: number) {
  if (isDateKey(date)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const safeMonth = Math.min(Math.max(month ?? currentBrasiliaMonth(), 1), 12);
  return new Date(Date.UTC(year, safeMonth - 1, 1));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function getScheduleRange(periodMode: SchedulePeriodMode, year: number, month?: number, date?: string) {
  const safeYear = Number.isFinite(year) ? year : currentBrasiliaYear();

  if (periodMode === 'day') {
    const reference = getReferenceDate(date, safeYear, month);

    return {
      startDate: formatDateKey(reference),
      endDate: formatDateKey(reference),
    };
  }

  if (periodMode === 'week') {
    const reference = getReferenceDate(date, safeYear, month);
    const mondayOffset = (reference.getUTCDay() + 6) % 7;
    const start = new Date(reference);
    start.setUTCDate(reference.getUTCDate() - mondayOffset);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);

    return {
      startDate: formatDateKey(start),
      endDate: formatDateKey(end),
    };
  }

  if (periodMode === 'year') {
    return {
      startDate: `${safeYear}-01-01`,
      endDate: `${safeYear}-12-31`,
    };
  }

  const safeMonth = Math.min(Math.max(month ?? currentBrasiliaMonth(), 1), 12);
  const start = new Date(Date.UTC(safeYear, safeMonth - 1, 1));
  const end = new Date(Date.UTC(safeYear, safeMonth, 0));

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function enumerateDateKeys(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function normalizeTechnicianIds(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

export function getScheduleGenerationPreview(periodMode: SchedulePeriodMode, year: number, month: number | undefined, technicianIds: string[], date?: string): ScheduleGenerationPreview {
  const { startDate, endDate } = getScheduleRange(periodMode, year, month, date);
  const dayCount = enumerateDateKeys(startDate, endDate).length;
  const technicianCount = normalizeTechnicianIds(technicianIds).length;

  return {
    startDate,
    endDate,
    dayCount,
    technicianCount,
    totalRows: dayCount * technicianCount,
  };
}

function isWeekendDay(dayKind: DayKind) {
  return dayKind === 'saturday' || dayKind === 'sunday';
}

function capitalizeLabel(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function getDayKind(dateKey: string): DayKind {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  if (day === 1) return 'monday';
  if (day === 2) return 'tuesday';
  if (day === 3) return 'wednesday';
  if (day === 4) return 'thursday';
  if (day === 5) return 'friday';
  if (day === 6) return 'saturday';
  return 'sunday';
}

function getFallbackDayTimes(dayKind: DayKind, input: ScheduleGenerationInput) {
  if (!isWeekendDay(dayKind)) {
    return {
      start_time: input.weekday_start_time,
      end_time: input.weekday_end_time,
    };
  }

  return {
    start_time: input.weekend_start_time,
    end_time: input.weekend_end_time,
  };
}

function getDayTimes(dayKind: DayKind, input: ScheduleGenerationInput, rule: WeekendCoverageRule) {
  const fallbackTimes = getFallbackDayTimes(dayKind, input);

  return {
    start_time: rule.start_time || fallbackTimes.start_time,
    end_time: rule.end_time || fallbackTimes.end_time,
  };
}

function createScheduleKey(technicianId: string, dateKey: string) {
  return `${technicianId}::${dateKey}`;
}

const SCHEDULE_WEEK_ANCHOR = Date.UTC(2024, 0, 1); // a Monday
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Whole weeks (Monday to Sunday) between a fixed Monday and the week of the date: the same for every period. */
export function getScheduleWeekIndex(dateKey: string) {
  const [year, month, day] = dateKey.slice(0, 10).split('-').map(Number);
  return Math.floor((Date.UTC(year, month - 1, day) - SCHEDULE_WEEK_ANCHOR) / WEEK_MS);
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeRotationCadence(value: unknown): WeekendRotationCadence {
  return value === 'alternating' || value === 'alternating_off' ? value : 'weekly';
}

function getWeekendRotationCadence(rule: WeekendCoverageRule): WeekendRotationCadence {
  return normalizeRotationCadence(rule.rotation_cadence);
}

function isActiveCadenceOccurrence(weekIndex: number, cadence: WeekendRotationCadence) {
  if (cadence === 'weekly') return true;
  return positiveModulo(weekIndex, 2) === (cadence === 'alternating' ? 0 : 1);
}

function getRotationGroupCadence(group: ScheduleRotationGroupInput): WeekendRotationCadence {
  return normalizeRotationCadence(group.rotation_cadence);
}

function getAssignedRotationTechnician(participants: string[], weekIndex: number, cadence: WeekendRotationCadence) {
  if (!isActiveCadenceOccurrence(weekIndex, cadence)) return undefined;

  const participantIndex = cadence === 'weekly' ? weekIndex : Math.floor(weekIndex / 2);
  return participants[positiveModulo(participantIndex, participants.length)];
}

function normalizeCoverageRule(rule: WeekendCoverageRule | undefined, fallbackRule: WeekendCoverageRule) {
  return {
    mode: rule?.mode ?? fallbackRule.mode,
    technician_ids: normalizeTechnicianIds(rule?.technician_ids ?? fallbackRule.technician_ids),
    rotation_cadence: rule?.rotation_cadence ? normalizeRotationCadence(rule.rotation_cadence) : getWeekendRotationCadence(fallbackRule),
    start_time: rule?.start_time?.trim() || fallbackRule.start_time?.trim() || undefined,
    end_time: rule?.end_time?.trim() || fallbackRule.end_time?.trim() || undefined,
  } satisfies WeekendCoverageRule;
}

function normalizeRotationGroups(groups: ScheduleGenerationInput['rotation_groups']) {
  return (groups ?? []).map((group, index) => ({
    label: group.label?.trim() || `Revezamento ${index + 1}`,
    day_keys: Array.from(new Set(group.day_keys.filter(Boolean))) as ScheduleDayRuleKey[],
    technician_ids: normalizeTechnicianIds(group.technician_ids),
    rotation_cadence: getRotationGroupCadence(group),
  })).filter((group) => group.day_keys.length && group.technician_ids.length);
}

function normalizeRecurringRules(rules: ScheduleGenerationInput['recurring_rules']) {
  return (rules ?? []).map((rule) => ({
    technician_id: String(rule.technician_id || '').trim(),
    day_keys: Array.from(new Set(rule.day_keys.filter(Boolean))) as ScheduleDayRuleKey[],
    status: rule.status,
    start_time: rule.start_time?.trim() || undefined,
    end_time: rule.end_time?.trim() || undefined,
    notes: rule.notes?.trim() || undefined,
  })).filter((rule) => rule.technician_id && rule.day_keys.length);
}

function getDayRules(input: ScheduleGenerationInput): Record<DayKind, WeekendCoverageRule> {
  const rawDayRules = input.day_rules ?? {};

  return {
    monday: normalizeCoverageRule(rawDayRules.monday, DEFAULT_WEEKDAY_RULE),
    tuesday: normalizeCoverageRule(rawDayRules.tuesday, DEFAULT_WEEKDAY_RULE),
    wednesday: normalizeCoverageRule(rawDayRules.wednesday, DEFAULT_WEEKDAY_RULE),
    thursday: normalizeCoverageRule(rawDayRules.thursday, DEFAULT_WEEKDAY_RULE),
    friday: normalizeCoverageRule(rawDayRules.friday, DEFAULT_WEEKDAY_RULE),
    saturday: normalizeCoverageRule(rawDayRules.saturday ?? input.saturday_rule, input.saturday_rule),
    sunday: normalizeCoverageRule(rawDayRules.sunday ?? input.sunday_rule, input.sunday_rule),
  };
}

function applyRotationGroupDayOverrides(
  dayRules: Record<DayKind, WeekendCoverageRule>,
  rotationGroups: ScheduleRotationGroupInput[],
) {
  const nextRules = { ...dayRules };
  const rotationDays = new Set<DayKind>();

  rotationGroups.forEach((group) => {
    if (!normalizeTechnicianIds(group.technician_ids).length) {
      return;
    }

    group.day_keys.forEach((dayKey) => rotationDays.add(dayKey));
  });

  rotationDays.forEach((dayKind) => {
    nextRules[dayKind] = {
      ...nextRules[dayKind],
      mode: 'all',
      technician_ids: [],
      rotation_cadence: 'weekly',
    };
  });

  return nextRules;
}

function getWeekendParticipants(rule: WeekendCoverageRule, technicianIds: string[]) {
  const selectedIds = normalizeTechnicianIds(rule.technician_ids);

  if (!selectedIds.length) {
    return rule.mode === 'rotation' ? technicianIds : [];
  }

  return technicianIds.filter((technicianId) => selectedIds.includes(technicianId));
}

function getEligibleDayParticipants(rule: WeekendCoverageRule, technicianIds: string[]) {
  if (rule.mode === 'off') {
    return [];
  }

  if (rule.mode === 'all') {
    return technicianIds;
  }

  return getWeekendParticipants(rule, technicianIds);
}

function getDayAssignments(
  dayKind: DayKind,
  rule: WeekendCoverageRule,
  technicianIds: string[],
  weekIndex: number,
) : DayAssignmentResult {
  if (rule.mode === 'off') {
    return {
      workingTechnicians: new Set<string>(),
      eligibleTechnicians: new Set<string>(),
    };
  }

  const rotationCadence = getWeekendRotationCadence(rule);
  const rotationIndex = weekIndex;

  if (!isActiveCadenceOccurrence(rotationIndex, rotationCadence)) {
    return {
      workingTechnicians: new Set<string>(),
      eligibleTechnicians: new Set<string>(),
    };
  }

  const participants = getEligibleDayParticipants(rule, technicianIds);
  const eligibleTechnicians = new Set<string>(participants);

  if (rule.mode === 'all') {
    return {
      workingTechnicians: new Set(technicianIds),
      eligibleTechnicians,
    };
  }

  if (!participants.length) {
    return {
      workingTechnicians: new Set<string>(),
      eligibleTechnicians,
    };
  }

  if (rule.mode === 'selected') {
    return {
      workingTechnicians: new Set(participants),
      eligibleTechnicians,
    };
  }

  const assignedTechnicianId = getAssignedRotationTechnician(participants, rotationIndex, rotationCadence);

  return {
    workingTechnicians: new Set<string>(assignedTechnicianId ? [assignedTechnicianId] : []),
    eligibleTechnicians,
  };
}

function getRotationGroupNote(dayKind: DayKind, group: ScheduleRotationGroupInput, isWorking: boolean) {
  const dayLabel = DAY_LABELS[dayKind];
  const capitalizedDayLabel = capitalizeLabel(dayLabel);
  const labelSuffix = group.label?.trim() ? ` no revezamento ${group.label.trim()}` : ' no revezamento';

  if (!isWorking) {
    return `Folga de ${dayLabel}${labelSuffix}`;
  }

  if (getRotationGroupCadence(group) !== 'weekly') {
    return `${capitalizedDayLabel}${labelSuffix} em revezamento alternado`;
  }

  return `${capitalizedDayLabel}${labelSuffix} em revezamento`;
}

function getRotationGroupAssignments(group: ScheduleRotationGroupInput, eligibleTechnicians: Set<string>, weekIndex: number) {
  const eligibleIds = Array.from(eligibleTechnicians);
  const firstTeam = normalizeTechnicianIds(group.technician_ids).filter((technicianId) => eligibleTechnicians.has(technicianId));
  const nextTeam = eligibleIds.filter((technicianId) => !firstTeam.includes(technicianId));

  if (!firstTeam.length || !nextTeam.length) {
    return {
      workingTechnicians: new Set<string>(),
      restingTechnicians: new Set<string>(),
      hasAlternation: false,
    };
  }

  const cadence = getRotationGroupCadence(group);
  const cycleIndex = cadence === 'weekly' ? weekIndex : Math.floor(weekIndex / 2);
  const useNextTeam = positiveModulo(cycleIndex, 2) !== 0;

  return {
    workingTechnicians: new Set<string>(useNextTeam ? nextTeam : firstTeam),
    restingTechnicians: new Set<string>(useNextTeam ? firstTeam : nextTeam),
    hasAlternation: true,
  };
}

function applyRotationGroups(
  dayKind: DayKind,
  groups: ScheduleRotationGroupInput[],
  eligibleTechnicians: Set<string>,
  workingTechnicians: Set<string>,
  noteOverrides: Map<string, string | null>,
  weekIndex: number,
) {
  if (!eligibleTechnicians.size) {
    return;
  }

  const activeGroups = groups.filter((group) => group.day_keys.includes(dayKind));

  for (const group of activeGroups) {
    const participants = normalizeTechnicianIds(group.technician_ids).filter((technicianId) => eligibleTechnicians.has(technicianId));

    if (!participants.length) {
      continue;
    }

    const assignments = getRotationGroupAssignments(group, eligibleTechnicians, weekIndex);

    if (!assignments.hasAlternation) {
      continue;
    }

    for (const technicianId of assignments.restingTechnicians) {
      workingTechnicians.delete(technicianId);
      noteOverrides.set(technicianId, getRotationGroupNote(dayKind, group, false));
    }

    for (const technicianId of assignments.workingTechnicians) {
      workingTechnicians.add(technicianId);
      noteOverrides.set(technicianId, getRotationGroupNote(dayKind, group, true));
    }
  }
}

function getBaseNote(dayKind: DayKind, weekendRule: WeekendCoverageRule, isWorking: boolean) {
  const dayLabel = DAY_LABELS[dayKind];
  const capitalizedDayLabel = capitalizeLabel(dayLabel);
  const isAlternating = getWeekendRotationCadence(weekendRule) !== 'weekly';

  if (!isWorking) {
    return isAlternating && weekendRule.mode !== 'off'
      ? `Folga de ${dayLabel} por alternância da regra base`
      : `Folga de ${dayLabel}`;
  }

  if (!isWeekendDay(dayKind) && weekendRule.mode === 'all' && !isAlternating) {
    return null;
  }

  if (weekendRule.mode === 'rotation') {
    return isAlternating
      ? `${capitalizedDayLabel} com 1 técnico por vez em ocorrências alternadas`
      : `${capitalizedDayLabel} com 1 técnico por vez`;
  }

  if (weekendRule.mode === 'all') {
    return isAlternating
      ? `${capitalizedDayLabel} com equipe completa em ocorrências alternadas`
      : `${capitalizedDayLabel} com equipe completa`;
  }

  if (weekendRule.mode === 'selected') {
    return isAlternating
      ? `${capitalizedDayLabel} com equipe selecionada em ocorrências alternadas`
      : `${capitalizedDayLabel} com equipe selecionada`;
  }

  return `${capitalizedDayLabel} escalado`;
}

function createRow(input: ScheduleGenerationInput, technicianId: string, dateKey: string, dayRule: WeekendCoverageRule, status: ScheduleStatus, notes: string | null) {
  const dayKind = getDayKind(dateKey);
  const { start_time, end_time } = getDayTimes(dayKind, input, dayRule);

  return {
    technician_id: technicianId,
    date: dateKey,
    start_time,
    end_time,
    status,
    notes,
  } satisfies ScheduleSeedRow;
}

export function buildPersistedSchedule(input: ScheduleGenerationInput, targetTechnicianIds: string[]) {
  const technicianIds = normalizeTechnicianIds(targetTechnicianIds);
  const { startDate, endDate } = getScheduleRange(input.period_mode, input.year, input.month, input.date);
  const dateKeys = enumerateDateKeys(startDate, endDate);
  const rowMap = new Map<string, ScheduleSeedRow>();
  const rotationGroups = normalizeRotationGroups(input.rotation_groups);
  const dayRules = applyRotationGroupDayOverrides(getDayRules(input), rotationGroups);
  const recurringRules = normalizeRecurringRules(input.recurring_rules);

  for (const dateKey of dateKeys) {
    const dayKind = getDayKind(dateKey);
    const dayRule = dayRules[dayKind];
    const weekIndex = getScheduleWeekIndex(dateKey);
    const { workingTechnicians, eligibleTechnicians } = getDayAssignments(dayKind, dayRule, technicianIds, weekIndex);
    const noteOverrides = new Map<string, string | null>();

    applyRotationGroups(dayKind, rotationGroups, eligibleTechnicians, workingTechnicians, noteOverrides, weekIndex);

    for (const technicianId of technicianIds) {
      const isWorking = workingTechnicians.has(technicianId);
      const note = noteOverrides.get(technicianId) ?? getBaseNote(dayKind, dayRule, isWorking);
      rowMap.set(createScheduleKey(technicianId, dateKey), createRow(input, technicianId, dateKey, dayRule, isWorking ? 'scheduled' : 'cancelled', note));
    }
  }

  for (const dayOff of input.general_days_off) {
    const dateKey = normalizeDateKey(dayOff.date);
    if (dateKey < startDate || dateKey > endDate) {
      continue;
    }

    const note = dayOff.notes?.trim() || 'Folga geral';

    for (const technicianId of technicianIds) {
      rowMap.set(createScheduleKey(technicianId, dateKey), createRow(input, technicianId, dateKey, dayRules[getDayKind(dateKey)], 'cancelled', note));
    }
  }

  for (const recurringRule of recurringRules) {
    if (!technicianIds.includes(recurringRule.technician_id)) {
      continue;
    }

    for (const dateKey of dateKeys) {
      const dayKind = getDayKind(dateKey);

      if (!recurringRule.day_keys.includes(dayKind)) {
        continue;
      }

      const dayRule = dayRules[dayKind];
      const fallbackTimes = getDayTimes(dayKind, input, dayRule);

      rowMap.set(createScheduleKey(recurringRule.technician_id, dateKey), {
        technician_id: recurringRule.technician_id,
        date: dateKey,
        start_time: recurringRule.start_time || fallbackTimes.start_time,
        end_time: recurringRule.end_time || fallbackTimes.end_time,
        status: recurringRule.status,
        notes: recurringRule.notes || DEFAULT_OVERRIDE_NOTE[recurringRule.status],
      });
    }
  }

  for (const override of input.overrides) {
    const technicianId = String(override.technician_id || '').trim();
    const dateKey = normalizeDateKey(override.date);

    if (!technicianIds.includes(technicianId) || dateKey < startDate || dateKey > endDate) {
      continue;
    }

    const dayRule = dayRules[getDayKind(dateKey)];
    const defaultTimes = getDayTimes(getDayKind(dateKey), input, dayRule);
    rowMap.set(createScheduleKey(technicianId, dateKey), {
      technician_id: technicianId,
      date: dateKey,
      start_time: override.start_time || defaultTimes.start_time,
      end_time: override.end_time || defaultTimes.end_time,
      status: override.status,
      notes: override.notes?.trim() || DEFAULT_OVERRIDE_NOTE[override.status],
    });
  }

  return Array.from(rowMap.values()).sort((left, right) => {
    if (left.date === right.date) {
      return left.technician_id.localeCompare(right.technician_id);
    }

    return left.date.localeCompare(right.date);
  });
}
