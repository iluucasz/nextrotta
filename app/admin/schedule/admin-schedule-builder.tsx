'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { CalendarDays, ChevronDown, Clock3, Download, FileText, Plus, Search, Trash2, Upload, Users, WandSparkles } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { compactName, formatDate, formatHours, formatTime, formatTimeRange, normalizeText } from '@/lib/formatters';
import { applyBrazilianDateText, readSpreadsheet } from '@/lib/spreadsheet-import';
import { PortoRunWizard } from './porto-run-wizard';
import {
  createDateKey,
  enumerateDateKeys,
  getScheduleGenerationPreview,
  getScheduleRange,
  normalizeDateKey,
  normalizeTechnicianIds,
  type ScheduleDayRuleKey,
  type ScheduleGenerationInput,
  type SchedulePeriodMode,
  type ScheduleRecurringRuleInput,
  type ScheduleRotationGroupInput,
  type WeekendCoverageMode,
  type WeekendCoverageRule,
  type WeekendRotationCadence,
} from '@/lib/schedule-planner';
import type { Schedule, Technician, WorkHours } from '@/lib/types';
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@/lib/organization-settings';
import { useAppSession } from '@/hooks/use-app-session';
import { fetchOrganizationSettings, useOrganizationSettings } from '@/hooks/use-organization-settings';

interface DayOffDraft {
  id: string;
  date: string;
  notes: string;
}

interface OverrideDraft {
  id: string;
  technician_id: string;
  date: string;
  status: Schedule['status'];
  start_time: string;
  end_time: string;
  notes: string;
}

interface RotationGroupDraft extends ScheduleRotationGroupInput {
  id: string;
}

interface CoverageGroupDraft {
  id: string;
  name: string;
  technician_ids: string[];
}

interface RecurringRuleDraft extends ScheduleRecurringRuleInput {
  id: string;
}

interface ScheduleBuilderForm {
  period_mode: SchedulePeriodMode;
  year: number;
  month: number;
  date: string;
  technician_scope: 'all' | 'selected';
  technician_ids: string[];
  weekday_start_time: string;
  weekday_end_time: string;
  weekend_start_time: string;
  weekend_end_time: string;
  day_rules: Record<ScheduleDayRuleKey, WeekendCoverageRule>;
  groups: CoverageGroupDraft[];
  day_rule_group_ids: Record<ScheduleDayRuleKey, string>;
  rotation_groups: RotationGroupDraft[];
  recurring_rules: RecurringRuleDraft[];
  general_days_off: DayOffDraft[];
  overrides: OverrideDraft[];
}

type AttendanceStatus = 'not_marked' | 'worked' | 'day_off' | 'missed' | 'justified' | 'cancelled_service';

/** Statuses with real hours (start/end times). "Serviço cancelado" records hours like "Trabalhou". */
function attendanceHasHours(status: AttendanceStatus | undefined) {
  return status === 'worked' || status === 'cancelled_service';
}
type AttendanceMode = 'day' | 'month' | 'spreadsheet';
type HourBankPeriodMode = 'day' | 'week' | 'month' | 'year';

interface AttendanceDraft {
  key: string;
  date: string;
  technician_id: string;
  technician_name: string;
  attendance_status: AttendanceStatus;
  planned_start_time: string;
  planned_end_time: string;
  planned_hours: number;
  actual_start_time: string;
  actual_end_time: string;
  notes: string;
  schedule_status?: Schedule['status'];
}

interface AttendanceImportRow {
  key: string;
  row_number: number;
  sheet_name: string;
  date: string;
  technician_id: string;
  technician_name: string;
  imported_name: string;
  start_time: string;
  end_time: string;
  planned_start_time: string;
  planned_end_time: string;
  hours_worked: number;
  week_number: number;
  month: number;
  year: number;
  notes: string;
}

interface AttendanceImportError {
  key: string;
  row_number: number;
  sheet_name: string;
  message: string;
  details: string[];
  suggestion: string;
  values: {
    date: string;
    employee: string;
    start_time: string;
    end_time: string;
    hours_worked: string;
    week_number: string;
    month: string;
    year: string;
  };
}

interface SchedulePageData {
  schedule: Schedule[];
  technicians: Technician[];
  workHours: WorkHours[];
  error: string;
}

interface HourBankRow {
  technician_id: string;
  technician_name: string;
  planned_hours: number;
  worked_hours: number;
  balance: number;
  worked_days: number;
  day_off_days: number;
  missed_days: number;
  justified_days: number;
  pending_days: number;
}

interface HourBankDetailRow {
  key: string;
  date: string;
  technician_id: string;
  technician_name: string;
  status_label: string;
  schedule_status?: Schedule['status'];
  planned_start_time: string;
  planned_end_time: string;
  actual_start_time: string;
  actual_end_time: string;
  planned_hours: number;
  worked_hours: number;
  balance: number;
  observation: string;
}

interface TechnicianChecklistProps {
  technicians: Technician[];
  value: string[];
  onToggle: (technicianId: string) => void;
  emptyLabel: string;
}

interface DayKeyChecklistProps {
  value: ScheduleDayRuleKey[];
  onToggle: (dayKey: ScheduleDayRuleKey) => void;
}

interface DayRuleEditorProps {
  label: string;
  dayLabel: string;
  rule: WeekendCoverageRule;
  technicians: Technician[];
  selectionLabel?: string;
  fallbackStartTime: string;
  fallbackEndTime: string;
  onModeChange: (mode: WeekendCoverageMode) => void;
  onCadenceChange: (cadence: WeekendRotationCadence) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onSetTechnicians: (technicianIds: string[]) => void;
  onConfigureTechnicians: () => void;
  inputClassName: string;
}

type ScheduleBuilderDialog = 'scope' | 'groups' | 'recurring' | 'rotation' | 'general-days-off' | 'overrides' | null;

interface BuilderActionCardProps {
  eyebrow: string;
  title: string;
  value: string;
  buttonLabel?: string;
  onClick: () => void;
}

interface RotationPreviewRow {
  date: string;
  dayLabel: string;
  workerNames: string[];
}

const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const weekdayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
/**
 * Configurações rules used by the module-level helpers in this file. The page syncs it from
 * useOrganizationSettings() at the top of every render (applyScheduleRules), before any helper runs
 * — these helpers are only called from this page's render and handlers.
 */
const scheduleRules = {
  defaultStartTime: DEFAULT_ORGANIZATION_SETTINGS.defaultShiftStart,
  defaultEndTime: DEFAULT_ORGANIZATION_SETTINGS.defaultShiftEnd,
  dailyBreakHours: DEFAULT_ORGANIZATION_SETTINGS.dailyBreakMinutes / 60,
  dailyBreakMinutes: DEFAULT_ORGANIZATION_SETTINGS.dailyBreakMinutes,
  chargeCancelledServicePlanned: DEFAULT_ORGANIZATION_SETTINGS.chargeCancelledServicePlanned,
};

function applyScheduleRules(settings: OrganizationSettings) {
  scheduleRules.defaultStartTime = settings.defaultShiftStart;
  scheduleRules.defaultEndTime = settings.defaultShiftEnd;
  scheduleRules.dailyBreakHours = settings.dailyBreakMinutes / 60;
  scheduleRules.dailyBreakMinutes = settings.dailyBreakMinutes;
  scheduleRules.chargeCancelledServicePlanned = settings.chargeCancelledServicePlanned;
}

/** "1h", "30 min", "1h30" — the configured daily break, for on-screen text. */
function formatBreakLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}
const hourBankPeriodOptions: Array<{ value: HourBankPeriodMode; label: string }> = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'year', label: 'Ano' },
];
const dayRuleDefinitions: Array<{ key: ScheduleDayRuleKey; label: string; dayLabel: string }> = [
  { key: 'monday', label: 'Segunda', dayLabel: 'segunda-feira' },
  { key: 'tuesday', label: 'Terça', dayLabel: 'terça-feira' },
  { key: 'wednesday', label: 'Quarta', dayLabel: 'quarta-feira' },
  { key: 'thursday', label: 'Quinta', dayLabel: 'quinta-feira' },
  { key: 'friday', label: 'Sexta', dayLabel: 'sexta-feira' },
  { key: 'saturday', label: 'Sábado', dayLabel: 'sábado' },
  { key: 'sunday', label: 'Domingo', dayLabel: 'domingo' },
];
const MANUAL_ATTENDANCE_PREFIX = 'Apontamento manual:';

function parseManualAttendanceNote(notes: string | null | undefined) {
  const value = String(notes ?? '').trim();
  if (!value.startsWith(MANUAL_ATTENDANCE_PREFIX)) {
    return {
      observation: '',
    };
  }

  const statusMatch = value.match(/^Apontamento manual:\s*([^;]+)/i);
  const normalizedStatus = normalizeText(statusMatch?.[1] ?? '');
  const plannedMatch = value.match(/(?:^|;\s*)previsto=(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/i);
  const observationMatch = value.match(/(?:^|;\s*)obs=(.*)$/i);
  let attendance_status: AttendanceStatus | undefined;

  if (normalizedStatus.includes('servico cancelado')) {
    attendance_status = 'cancelled_service';
  } else if (normalizedStatus.includes('folga')) {
    attendance_status = 'day_off';
  } else if (normalizedStatus.includes('falta')) {
    attendance_status = 'missed';
  } else if (normalizedStatus.includes('justificado')) {
    attendance_status = 'justified';
  } else if (normalizedStatus.includes('trabalhou')) {
    attendance_status = 'worked';
  }

  return {
    attendance_status,
    planned_start_time: plannedMatch?.[1],
    planned_end_time: plannedMatch?.[2],
    observation: observationMatch?.[1]?.trim() ?? '',
  };
}

function getAttendanceStatusLabel(status: AttendanceStatus | undefined) {
  if (status === 'worked') return 'Trabalhou';
  if (status === 'day_off') return 'Folgou';
  if (status === 'missed') return 'Faltou';
  if (status === 'justified') return 'Justificou';
  if (status === 'cancelled_service') return 'Serviço cancelado';
  return 'Sem apontamento';
}

function createCoverageRule(mode: WeekendCoverageMode): WeekendCoverageRule {
  return {
    mode,
    technician_ids: [],
    rotation_cadence: 'weekly',
    start_time: '',
    end_time: '',
  };
}

function getDayDefinition(dayKey: ScheduleDayRuleKey) {
  return dayRuleDefinitions.find((definition) => definition.key === dayKey);
}

function formatDayKeyList(dayKeys: ScheduleDayRuleKey[]) {
  const labels = dayRuleDefinitions.filter((definition) => dayKeys.includes(definition.key)).map((definition) => definition.label);
  return labels.length ? labels.join(', ') : 'Nenhum dia selecionado';
}

function getDayKeyFromDateKey(dateKey: string): ScheduleDayRuleKey {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  if (day === 1) return 'monday';
  if (day === 2) return 'tuesday';
  if (day === 3) return 'wednesday';
  if (day === 4) return 'thursday';
  if (day === 5) return 'friday';
  if (day === 6) return 'saturday';
  return 'sunday';
}

function getDayLabelFromKey(dayKey: ScheduleDayRuleKey) {
  return dayRuleDefinitions.find((definition) => definition.key === dayKey)?.label ?? dayKey;
}

function createId() {
  return crypto.randomUUID();
}

function createDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function createMonthInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getYearFromDateKey(dateKey: string, fallbackYear: number) {
  const year = Number(dateKey.slice(0, 4));
  return Number.isInteger(year) ? year : fallbackYear;
}

function parseTimeToMinutes(value: string | null | undefined) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return hours * 60 + minutes;
}

function normalizeTimeInput(value: string | null | undefined, fallback = '') {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function getHoursBetween(startTime: string | null | undefined, endTime: string | null | undefined) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null || end <= start) {
    return 0;
  }

  const grossHours = (end - start) / 60;
  const netHours = grossHours > scheduleRules.dailyBreakHours ? grossHours - scheduleRules.dailyBreakHours : grossHours;

  return Number(netHours.toFixed(2));
}

function addHoursToTime(startTime: string, hours: number) {
  const start = parseTimeToMinutes(startTime) ?? parseTimeToMinutes(scheduleRules.defaultStartTime) ?? 0;
  const totalMinutes = Math.max(0, Math.round(start + hours * 60));
  const dayMinutes = totalMinutes % (24 * 60);

  return `${String(Math.floor(dayMinutes / 60)).padStart(2, '0')}:${String(dayMinutes % 60).padStart(2, '0')}`;
}

function getIsoWeekNumber(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function isAttendanceSelected(draft: AttendanceDraft) {
  return draft.attendance_status !== 'not_marked';
}

function getAttendanceWorkedHours(draft: AttendanceDraft) {
  if (draft.attendance_status === 'not_marked') return 0;
  if (draft.attendance_status === 'missed') return 0;
  if (draft.attendance_status === 'day_off') return 0;
  if (draft.attendance_status === 'justified') return 0;

  return getHoursBetween(draft.actual_start_time, draft.actual_end_time);
}

function getAttendanceBalance(draft: AttendanceDraft) {
  if (!isAttendanceSelected(draft)) return 0;
  if (draft.attendance_status === 'day_off' || draft.attendance_status === 'justified') return 0;
  if (draft.attendance_status === 'missed') return -draft.planned_hours;
  // By default the cancellation isn't the technician's doing: the hours count, the planned ones
  // aren't charged (Configurações → "Dia de serviço cancelado cobra as horas previstas").
  if (draft.attendance_status === 'cancelled_service' && !scheduleRules.chargeCancelledServicePlanned) return getAttendanceWorkedHours(draft);

  return getAttendanceWorkedHours(draft) - draft.planned_hours;
}

function getAttendanceResultLabel(draft: AttendanceDraft, hoursWorked: number) {
  if (draft.attendance_status === 'cancelled_service') return `Serviço cancelado: ${formatHours(hoursWorked)}`;
  if (draft.attendance_status === 'day_off') return 'Folga registrada';
  if (draft.attendance_status === 'justified') return 'Justificado';
  if (draft.attendance_status === 'missed') return 'Falta registrada';

  return `Realizado: ${formatHours(hoursWorked)}`;
}

function getAttendanceStatusFromSchedule(entry?: Schedule): AttendanceStatus {
  if (!entry) {
    return 'not_marked';
  }

  const manual = parseManualAttendanceNote(entry.notes);
  if (manual.attendance_status) {
    return manual.attendance_status;
  }

  if (entry.status === 'cancelled') {
    return 'day_off';
  }

  return 'worked';
}

function createInitialBuilderForm(): ScheduleBuilderForm {
  const now = new Date();

  return {
    period_mode: 'month',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    date: createDateInputValue(now),
    technician_scope: 'all',
    technician_ids: [],
    weekday_start_time: scheduleRules.defaultStartTime,
    weekday_end_time: scheduleRules.defaultEndTime,
    weekend_start_time: scheduleRules.defaultStartTime,
    weekend_end_time: scheduleRules.defaultEndTime,
    day_rules: {
      monday: createCoverageRule('all'),
      tuesday: createCoverageRule('all'),
      wednesday: createCoverageRule('all'),
      thursday: createCoverageRule('all'),
      friday: createCoverageRule('all'),
      saturday: {
        ...createCoverageRule('all'),
        rotation_cadence: 'alternating',
      },
      sunday: createCoverageRule('off'),
    },
    groups: [],
    day_rule_group_ids: {
      monday: '',
      tuesday: '',
      wednesday: '',
      thursday: '',
      friday: '',
      saturday: '',
      sunday: '',
    },
    rotation_groups: [],
    recurring_rules: [],
    general_days_off: [],
    overrides: [],
  };
}

function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluído';
  return 'Escalado';
}

function getStatusTone(status: Schedule['status']) {
  if (status === 'cancelled') return 'warning' as const;
  if (status === 'completed') return 'success' as const;
  return 'info' as const;
}

function getSchedulePriority(status: Schedule['status']) {
  if (status === 'scheduled') return 3;
  if (status === 'completed') return 2;
  return 1;
}

function getScheduleTimestamp(entry: Schedule) {
  const timestamp = Date.parse(entry.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBestScheduleEntry(entries: Schedule[]) {
  return entries.reduce<Schedule | undefined>((best, entry) => {
    if (!best) {
      return entry;
    }

    const entryTimestamp = getScheduleTimestamp(entry);
    const bestTimestamp = getScheduleTimestamp(best);

    if (entryTimestamp > bestTimestamp || (entryTimestamp === bestTimestamp && getSchedulePriority(entry.status) > getSchedulePriority(best.status))) {
      return entry;
    }

    return best;
  }, undefined);
}

function createAttendanceKey(technicianId: string, dateKey: string) {
  return `${technicianId}::${dateKey}`;
}

function getWorkHoursTimestamp(entry: WorkHours) {
  const timestamp = Date.parse(entry.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getBestWorkHour(entries: WorkHours[]) {
  return entries.reduce<WorkHours | undefined>((best, entry) => {
    if (!best) {
      return entry;
    }

    return getWorkHoursTimestamp(entry) >= getWorkHoursTimestamp(best) ? entry : best;
  }, undefined);
}

function getScheduleDisplayLabel(entry: Schedule | undefined) {
  const manualStatus = parseManualAttendanceNote(entry?.notes).attendance_status;
  if (manualStatus) return getAttendanceStatusLabel(manualStatus);
  if (!entry) return 'Sem escala';

  return getStatusLabel(entry.status);
}

function getScheduleDisplayTone(entry: Schedule | undefined) {
  const manualStatus = parseManualAttendanceNote(entry?.notes).attendance_status;
  if (manualStatus === 'worked') return 'success' as const;
  if (manualStatus === 'missed') return 'danger' as const;
  if (manualStatus === 'day_off' || manualStatus === 'justified' || manualStatus === 'cancelled_service') return 'warning' as const;
  if (!entry) return 'neutral' as const;

  return getStatusTone(entry.status);
}

function getSchedulePlannedTimes(entry: Schedule | undefined, fallbackStartTime = scheduleRules.defaultStartTime, fallbackEndTime = scheduleRules.defaultEndTime) {
  const manual = parseManualAttendanceNote(entry?.notes);

  return {
    startTime: normalizeTimeInput(manual.planned_start_time || entry?.start_time, fallbackStartTime),
    endTime: normalizeTimeInput(manual.planned_end_time || entry?.end_time, fallbackEndTime),
  };
}

function getSchedulePlannedHoursForDraft(entry: Schedule | undefined, startTime: string, endTime: string) {
  if (!entry) return 0;

  const manualStatus = parseManualAttendanceNote(entry.notes).attendance_status;
  if (manualStatus) return getHoursBetween(startTime, endTime);
  if (entry.status === 'cancelled') return 0;

  return getHoursBetween(startTime, endTime);
}

function getSchedulePlannedHoursForBank(entry: Schedule | undefined) {
  if (!entry) return 0;

  const manualStatus = parseManualAttendanceNote(entry.notes).attendance_status;
  const { startTime, endTime } = getSchedulePlannedTimes(entry);

  if (manualStatus === 'day_off' || manualStatus === 'justified') return 0;
  if (manualStatus === 'cancelled_service') return scheduleRules.chargeCancelledServicePlanned ? getHoursBetween(startTime, endTime) : 0;
  if (manualStatus === 'missed' || manualStatus === 'worked') return getHoursBetween(startTime, endTime);
  if (entry.status === 'completed') return getHoursBetween(startTime, endTime);

  return 0;
}

function getScheduleTimeLabel(entry: Schedule) {
  const manualStatus = parseManualAttendanceNote(entry.notes).attendance_status;

  if (attendanceHasHours(manualStatus)) {
    const plannedTimes = getSchedulePlannedTimes(entry);
    return `${formatTimeRange(entry.start_time, entry.end_time)} (prev. ${formatTimeRange(plannedTimes.startTime, plannedTimes.endTime)})`;
  }

  if (manualStatus) {
    const plannedTimes = getSchedulePlannedTimes(entry);
    return formatTimeRange(plannedTimes.startTime, plannedTimes.endTime);
  }

  if (entry.status === 'cancelled') return entry.notes || 'Dia de folga';

  return formatTimeRange(entry.start_time, entry.end_time);
}

function getScheduleObservation(entry: Schedule) {
  const manual = parseManualAttendanceNote(entry.notes);
  if (manual.attendance_status) return manual.observation || '-';

  return entry.notes || '-';
}

/**
 * Shared by the live (period-filtered) hour-bank view and the "export all periods" action, which
 * needs the same merge logic over the full, unfiltered schedule/work_hours arrays instead of just
 * the current hourBankRange window.
 */
function buildHourBankDetailRows(scheduleRows: Schedule[], workHoursRows: WorkHours[], technicianNameById: Map<string, string>): HourBankDetailRow[] {
  const scheduleByTechnicianDate = new Map<string, Schedule[]>();
  const workHoursByTechnicianDate = new Map<string, WorkHours[]>();

  scheduleRows.forEach((item) => {
    const dateKey = normalizeDateKey(item.date);
    const key = createAttendanceKey(item.technician_id, dateKey);
    scheduleByTechnicianDate.set(key, [...(scheduleByTechnicianDate.get(key) ?? []), item]);
  });

  workHoursRows.forEach((item) => {
    const dateKey = normalizeDateKey(item.date);
    const key = createAttendanceKey(item.technician_id, dateKey);
    workHoursByTechnicianDate.set(key, [...(workHoursByTechnicianDate.get(key) ?? []), item]);
  });

  const allKeys = Array.from(new Set([...scheduleByTechnicianDate.keys(), ...workHoursByTechnicianDate.keys()]));

  return allKeys.map((key) => {
    const [technicianId, dateKey] = key.split('::');
    const entry = getBestScheduleEntry(scheduleByTechnicianDate.get(key) ?? []);
    const workHour = getBestWorkHour(workHoursByTechnicianDate.get(key) ?? []);
    const plannedTimes = getSchedulePlannedTimes(entry);
    const plannedHours = getSchedulePlannedHoursForBank(entry);
    const workedHours = Number(workHour?.hours_worked || 0);
    const technicianName = entry?.technician_name || technicianNameById.get(technicianId) || technicianId;

    return {
      key,
      date: dateKey,
      technician_id: technicianId,
      technician_name: technicianName,
      status_label: workHour ? 'Trabalhou' : getScheduleDisplayLabel(entry),
      schedule_status: entry?.status,
      planned_start_time: plannedTimes.startTime,
      planned_end_time: plannedTimes.endTime,
      actual_start_time: workHour ? normalizeTimeInput(workHour.start_time, '') : '',
      actual_end_time: workHour ? normalizeTimeInput(workHour.end_time, '') : '',
      planned_hours: plannedHours,
      worked_hours: Number(workedHours.toFixed(2)),
      balance: Number((workedHours - plannedHours).toFixed(2)),
      observation: entry ? getScheduleObservation(entry) : '-',
    };
  }).sort((left, right) => left.date.localeCompare(right.date) || left.technician_name.localeCompare(right.technician_name, 'pt-BR'));
}

function buildHourBankExportRows(rows: HourBankDetailRow[]) {
  return rows.map((row) => ({
    Data: formatDate(row.date),
    Situacao: row.status_label,
    Tecnico: row.technician_name,
    Escala: row.schedule_status ? getStatusLabel(row.schedule_status) : 'Sem escala',
    Previsto_inicio: formatTime(row.planned_start_time),
    Previsto_fim: formatTime(row.planned_end_time),
    Entrada: row.actual_start_time ? formatTime(row.actual_start_time) : '-',
    Saida: row.actual_end_time ? formatTime(row.actual_end_time) : '-',
    Horas_previstas: row.planned_hours,
    Horas_realizadas: row.worked_hours,
    Saldo: row.balance,
    Observação: row.observation,
  }));
}

function slugify(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function getMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const monthName = monthNames[month - 1];

  return monthName && Number.isInteger(year) ? `${monthName} ${year}` : monthKey;
}

function getHourBankPeriodLabel(periodMode: HourBankPeriodMode, startDate: string, endDate: string, monthKey: string) {
  if (periodMode === 'day') return formatDate(startDate);
  if (periodMode === 'week') return `${formatDate(startDate)} a ${formatDate(endDate)}`;
  if (periodMode === 'year') return startDate.slice(0, 4);

  return getMonthLabel(monthKey);
}

function getYearMonthParts(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);

  return {
    year: Number.isInteger(year) ? year : new Date().getFullYear(),
    month: Number.isInteger(month) ? month : new Date().getMonth() + 1,
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMonthWeeks(year: number, monthIndex: number) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstDayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDayOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

function getNextDateKeys(dayCount: number) {
  const start = new Date();
  const result: string[] = [];

  for (let index = 0; index < dayCount; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    result.push(date.toISOString().slice(0, 10));
  }

  return result;
}

function toggleStringValue(values: string[], nextValue: string) {
  return values.includes(nextValue) ? values.filter((value) => value !== nextValue) : [...values, nextValue];
}

function toggleDayKeyValue(values: ScheduleDayRuleKey[], nextValue: ScheduleDayRuleKey): ScheduleDayRuleKey[] {
  return values.includes(nextValue) ? values.filter((value): value is ScheduleDayRuleKey => value !== nextValue) : [...values, nextValue];
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function getRotationTeams(selectedTechnicianIds: string[], availableTechnicianIds: string[]) {
  const firstTeam = normalizeTechnicianIds(selectedTechnicianIds).filter((technicianId) => availableTechnicianIds.includes(technicianId));
  const nextTeam = availableTechnicianIds.filter((technicianId) => !firstTeam.includes(technicianId));

  return {
    firstTeam,
    nextTeam,
  };
}

function getDayRuleLabel(rule: WeekendCoverageRule) {
  if (rule.mode === 'off') return 'Todos Folgam';
  if (rule.mode === 'all') return rule.rotation_cadence === 'alternating' ? 'Todos em dias alternados' : 'Todos trabalham';
  if (rule.mode === 'rotation') {
    return rule.rotation_cadence === 'alternating' ? 'Técnico específico alternado' : 'Técnico específico';
  }

  return rule.rotation_cadence === 'alternating' ? 'Equipe em dias alternados' : 'Equipe selecionada';
}

function buildSuccessMessage(summary: {
  startDate: string;
  endDate: string;
  technicians: number;
  inserted: number;
  preservedCompleted: number;
  portoAutomationEnabled?: boolean;
}) {
  const base = `Escala salva de ${formatDate(summary.startDate)} até ${formatDate(summary.endDate)} para ${formatCount(summary.technicians, 'técnico', 'técnicos')}. O sistema gravou ${formatCount(summary.inserted, 'linha', 'linhas')} e preservou ${formatCount(summary.preservedCompleted, 'linha', 'linhas')} (dias concluídos, apontados à mão${summary.portoAutomationEnabled ? ' ou importados do Porto' : ''}).`;
  // Porto automation on = Porto owns the escala: its daily import replaces what's built here.
  return summary.portoAutomationEnabled
    ? `${base} A automação do Porto está ligada: a escala do Porto prevalece e é reimportada toda madrugada.`
    : base;
}

const attendanceImportColumnAliases = {
  date: ['data', 'date'],
  employee: ['funcionario', 'funcionário', 'tecnico', 'técnico', 'colaborador', 'nome'],
  startTime: ['hora inicio', 'hora início', 'inicio', 'início', 'entrada', 'hora entrada'],
  endTime: ['hora final', 'fim', 'saida', 'saída', 'hora saida', 'hora saída'],
  hoursWorked: ['horas trabalhadas', 'horas', 'total horas', 'total'],
  weekNumber: ['semana do ano', 'semana'],
  month: ['mes', 'mês'],
  year: ['ano'],
};

function getImportValue(row: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map((alias) => normalizeText(alias)));
  const entry = Object.entries(row).find(([key]) => normalizedAliases.has(normalizeText(key)));
  return entry?.[1] ?? '';
}

function formatImportValue(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleString('pt-BR');
  }

  return String(value ?? '').trim();
}

function getImportErrorSuggestion(errors: string[]) {
  if (errors.some((error) => error.includes('técnico não encontrado'))) {
    return 'Confira se o nome do Funcionário está igual ao cadastro de Técnicos ativos.';
  }

  if (errors.some((error) => error.includes('hora'))) {
    return 'Preencha Hora Início e Hora Final no formato HH:mm, por exemplo 08:00 e 17:30.';
  }

  if (errors.some((error) => error.includes('data'))) {
    return 'Preencha Data no formato dd/mm/aaaa, por exemplo 01/04/2026.';
  }

  if (errors.some((error) => error.includes('duplicado'))) {
    return 'Deixe apenas uma linha para o mesmo técnico na mesma data.';
  }

  return 'Revise os campos obrigatórios da linha antes de importar novamente.';
}

function parseImportNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseImportInteger(value: unknown) {
  const parsed = parseImportNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function normalizeImportYear(value: number) {
  if (value >= 100) return value;
  return value >= 70 ? 1900 + value : 2000 + value;
}

function buildImportDateKey(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return '';
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return '';
  }

  return createDateInputValue(date);
}

function parseImportedDate(value: unknown, monthValue: unknown, yearValue: unknown) {
  const monthHint = parseImportInteger(monthValue);
  const yearHint = parseImportInteger(yearValue);

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const date = createDateInputValue(value);
    return { date, month: value.getMonth() + 1, year: value.getFullYear() };
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const date = buildImportDateKey(parsed.y, parsed.m, parsed.d);
      if (date) return { date, month: parsed.m, year: parsed.y };
    }
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const date = buildImportDateKey(year, month, day);
    return date ? { date, month, year } : null;
  }

  const parts = raw.match(/\d+/g)?.map(Number) ?? [];
  if (parts.length < 3) return null;

  if (parts[0] >= 1900) {
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    const date = buildImportDateKey(year, month, day);
    return date ? { date, month, year } : null;
  }

  let day = parts[0];
  let month = parts[1];
  const year = yearHint && yearHint >= 1900 ? yearHint : normalizeImportYear(parts[2]);

  if (monthHint && monthHint >= 1 && monthHint <= 12) {
    if (parts[0] === monthHint) {
      month = parts[0];
      day = parts[1];
    } else if (parts[1] === monthHint) {
      month = parts[1];
      day = parts[0];
    }
  }

  // Without a month column the date is day/month/year; an impossible month is an invalid date.
  const date = buildImportDateKey(year, month, day);
  return date ? { date, month, year } : null;
}

function parseImportedTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.H).padStart(2, '0')}:${String(parsed.M).padStart(2, '0')}`;
    }
  }

  const raw = String(value ?? '').trim();
  const numericValue = raw && !raw.includes(':') && !/[a-zA-Z]/.test(raw) ? parseImportNumber(raw) : null;
  if (numericValue !== null && numericValue >= 0 && numericValue < 1) {
    const parsed = XLSX.SSF.parse_date_code(numericValue);
    if (parsed) {
      return `${String(parsed.H).padStart(2, '0')}:${String(parsed.M).padStart(2, '0')}`;
    }
  }

  const match = raw.replace(/\s+/g, '').match(/^(\d{1,2})(?::|h|H)(\d{1,2})/);
  if (!match) return '';

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return '';
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getGrossHoursBetween(startTime: string, endTime: string) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null) return 0;

  const endWithRollover = end >= start ? end : end + 24 * 60;
  return Number(((endWithRollover - start) / 60).toFixed(2));
}

/**
 * A spreadsheet row whose hours are the raw Entrada→Saída span — i.e. without the 1h lunch break
 * every other path (manual entry, Porto import) nets out. Rows already netted, or shorter than the
 * break, don't count.
 */
function importRowMissingLunchBreak(row: { start_time: string; end_time: string; hours_worked: number }) {
  const gross = getGrossHoursBetween(row.start_time, row.end_time);
  return gross > scheduleRules.dailyBreakHours && Math.abs(row.hours_worked - gross) < 0.02;
}

function parseImportedHours(value: unknown, startTime: string, endTime: string) {
  const parsed = parseImportNumber(value);
  if (parsed !== null && parsed > 0 && parsed <= 24) {
    return Number(parsed.toFixed(2));
  }

  const calculated = getGrossHoursBetween(startTime, endTime);
  return calculated > 0 && calculated <= 24 ? calculated : null;
}

function getAttendanceWorksheetName(workbook: XLSX.WorkBook) {
  const preferred = workbook.SheetNames.find((sheetName) => normalizeText(sheetName) === 'banco de dados');
  if (preferred) return preferred;

  return workbook.SheetNames.find((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: false, blankrows: false });
    const firstRow = rows[0] ?? {};
    return Boolean(
      getImportValue(firstRow, attendanceImportColumnAliases.date) &&
      getImportValue(firstRow, attendanceImportColumnAliases.employee) &&
      getImportValue(firstRow, attendanceImportColumnAliases.startTime) &&
      getImportValue(firstRow, attendanceImportColumnAliases.endTime),
    );
  }) ?? workbook.SheetNames[0] ?? '';
}

function buildTechnicianMatchMap(technicians: Technician[]) {
  const matches = new Map<string, Technician | null>();

  technicians.forEach((technician) => {
    const keys = Array.from(new Set([
      technician.name,
      compactName(technician.name),
      technician.qra,
    ].map((value) => normalizeText(value)).filter(Boolean)));

    keys.forEach((key) => {
      matches.set(key, matches.has(key) ? null : technician);
    });
  });

  return matches;
}

function resolveImportedTechnician(importedName: string, technicians: Technician[], technicianMatches: Map<string, Technician | null>) {
  const normalizedName = normalizeText(importedName);
  const compactImportedName = normalizeText(compactName(importedName));
  const directMatch = technicianMatches.get(normalizedName) ?? technicianMatches.get(compactImportedName);

  if (directMatch) {
    return directMatch;
  }

  const importedTokens = normalizedName.split(/\s+/).filter((token) => token.length > 2);
  const fuzzyMatches = technicians.filter((technician) => {
    const technicianName = normalizeText(technician.name);
    if (!technicianName || !normalizedName) return false;
    if (technicianName.includes(normalizedName) || normalizedName.includes(technicianName)) return true;

    const technicianTokens = technicianName.split(/\s+/).filter((token) => token.length > 2);
    return importedTokens.length >= 2 && importedTokens.every((token) => technicianTokens.includes(token));
  });

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : null;
}

async function fetchSchedulePageData(): Promise<SchedulePageData> {
  const [scheduleRes, techniciansRes, workHoursRes, settingsRes] = await Promise.allSettled([
    fetch('/api/schedule'),
    fetch('/api/technicians'),
    fetch('/api/work-hours'),
    fetchOrganizationSettings(),
  ]);
  const errors: string[] = [];

  if (settingsRes.status === 'fulfilled') {
    applyScheduleRules(settingsRes.value);
  } else {
    errors.push('configurações da empresa');
  }
  let schedule: Schedule[] = [];
  let technicians: Technician[] = [];
  let workHours: WorkHours[] = [];

  if (workHoursRes.status === 'fulfilled' && workHoursRes.value.ok) {
    const data = await workHoursRes.value.json();
    workHours = Array.isArray(data.workHours) ? data.workHours : [];
  } else {
    errors.push('banco de horas');
  }

  if (scheduleRes.status === 'fulfilled' && scheduleRes.value.ok) {
    const data = await scheduleRes.value.json();
    schedule = Array.isArray(data.schedules) ? data.schedules : [];
  } else {
    errors.push('escala');
  }

  if (techniciansRes.status === 'fulfilled' && techniciansRes.value.ok) {
    const data = await techniciansRes.value.json();
    technicians = Array.isArray(data.technicians) ? data.technicians : [];
  } else {
    errors.push('técnicos');
  }

  return {
    schedule,
    technicians,
    workHours,
    error: errors.length ? `Não foi possível carregar dados reais de ${errors.join(', ')}.` : '',
  };
}

function TechnicianChecklist({ technicians, value, onToggle, emptyLabel }: TechnicianChecklistProps) {
  if (!technicians.length) {
    return <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-border bg-background p-2 sm:grid-cols-2 xl:grid-cols-3">
      {technicians.map((technician) => {
        const isSelected = value.includes(technician.id);

        return (
        <label key={technician.id} className={`flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 text-sm transition ${isSelected ? 'border-emerald-200 bg-emerald-50/70' : 'border-transparent hover:border-border hover:bg-secondary/50'}`}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggle(technician.id)} className="h-4 w-4 shrink-0 rounded border-border" />
          <span className="truncate font-medium text-foreground" title={technician.name}>{technician.name}</span>
        </label>
        );
      })}
    </div>
  );
}

function DayKeyChecklist({ value, onToggle }: DayKeyChecklistProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {dayRuleDefinitions.map((day) => (
        <label key={day.key} className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm">
          <input type="checkbox" checked={value.includes(day.key)} onChange={() => onToggle(day.key)} className="h-4 w-4 rounded border-border" />
          <span className="font-medium text-foreground">{day.label}</span>
        </label>
      ))}
    </div>
  );
}

function BuilderActionCard({ eyebrow, title, value, buttonLabel = 'Editar', onClick }: BuilderActionCardProps) {
  return (
    <section className="rounded-lg border border-border/70 bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
          <h4 className="mt-1 text-sm font-semibold text-foreground">{title}</h4>
          <p className="mt-1 truncate text-sm text-muted-foreground">{value}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClick}>
          {buttonLabel}
        </Button>
      </div>
    </section>
  );
}

function DayRuleEditor({ label, dayLabel, rule, technicians, selectionLabel, fallbackStartTime, fallbackEndTime, onModeChange, onCadenceChange, onStartTimeChange, onEndTimeChange, onSetTechnicians, onConfigureTechnicians, inputClassName }: DayRuleEditorProps) {
  const requiresSelection = rule.mode === 'selected' || rule.mode === 'rotation';
  const isSingleTechnicianCoverage = rule.mode === 'rotation';
  const usesCadence = rule.mode !== 'off';
  const technicianSelectionLabel = selectionLabel || (rule.technician_ids.length
    ? formatCount(rule.technician_ids.length, 'técnico escolhido', 'técnicos escolhidos')
    : isSingleTechnicianCoverage
      ? 'todo o escopo'
      : 'escolher grupo');
  const startTimeValue = rule.mode === 'off' ? '' : rule.start_time || fallbackStartTime;
  const endTimeValue = rule.mode === 'off' ? '' : rule.end_time || fallbackEndTime;

  return (
    <tr className="border-t border-border/70 align-middle">
      <td className="min-w-32 px-3 py-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <StatusBadge tone="neutral">{getDayRuleLabel(rule)}</StatusBadge>
        </div>
      </td>

      <td className="min-w-44 px-3 py-3">
        <label className="block text-sm">
          <span className="sr-only">Cobertura de {dayLabel}</span>
          <select value={rule.mode} onChange={(event) => onModeChange(event.target.value as WeekendCoverageMode)} className={inputClassName}>
            <option value="off">Todos Folgam</option>
            <option value="all">Todos trabalham</option>
            <option value="selected">Equipe selecionada</option>
            <option value="rotation">Técnico específico</option>
          </select>
        </label>
      </td>

      <td className="min-w-48 px-3 py-3">
        {usesCadence ? (
          <label className="block text-sm">
            <span className="sr-only">Frequência de {dayLabel}</span>
            <select value={rule.rotation_cadence ?? 'weekly'} onChange={(event) => onCadenceChange(event.target.value as WeekendRotationCadence)} className={inputClassName}>
              <option value="weekly">Toda ocorrência deste dia</option>
              <option value="alternating">Uma ocorrência sim, outra não</option>
            </select>
          </label>
        ) : (
          <span className="text-sm text-muted-foreground">Sem frequência</span>
        )}
      </td>

      <td className="min-w-44 px-3 py-3">
        {isSingleTechnicianCoverage ? (
          <label className="block text-sm">
            <span className="sr-only">Técnico de {dayLabel}</span>
            <select
              value={rule.technician_ids[0] || 'all'}
              onChange={(event) => onSetTechnicians(event.target.value === 'all' ? [] : [event.target.value])}
              className={inputClassName}
            >
              <option value="all">Todos</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>{technician.name}</option>
              ))}
            </select>
          </label>
        ) : rule.mode === 'selected' ? (
          <Button type="button" variant="outline" onClick={onConfigureTechnicians} className="w-full justify-between">
            <Users className="h-4 w-4" />
            <span className="truncate">{technicianSelectionLabel}</span>
          </Button>
        ) : rule.mode === 'all' ? (
          <span className="text-sm font-medium text-foreground">Todos</span>
        ) : (
          <span className="text-sm text-muted-foreground">Todos</span>
        )}
      </td>

      <td className="min-w-32 px-3 py-3">
        <input type="time" value={startTimeValue} disabled={rule.mode === 'off'} onChange={(event) => onStartTimeChange(event.target.value)} className={inputClassName} aria-label={`Entrada de ${dayLabel}`} />
      </td>

      <td className="min-w-32 px-3 py-3">
        <input type="time" value={endTimeValue} disabled={rule.mode === 'off'} onChange={(event) => onEndTimeChange(event.target.value)} className={inputClassName} aria-label={`Saída de ${dayLabel}`} />
      </td>
    </tr>
  );
}
/**
 * Mounts the page only once the Configurações rules are in, so every memoized hour-bank / attendance
 * calculation below starts from the real rules instead of caching values computed from the defaults.
 */
export function AdminScheduleBuilderPage() {
  const { settings, loading } = useOrganizationSettings();
  if (loading) return <LoadingShell role="admin" />;
  return <AdminScheduleBuilderContent organizationSettings={settings} />;
}

function AdminScheduleBuilderContent({ organizationSettings }: { organizationSettings: OrganizationSettings }) {
  const { user, loading } = useAppSession();
  applyScheduleRules(organizationSettings);
  const [schedule, setSchedule] = useState<Schedule[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [workHours, setWorkHours] = useState<WorkHours[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [query, setQuery] = useState('');
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [isCalendarDialogOpen, setIsCalendarDialogOpen] = useState(false);
  const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
  const [isHourBankDetailDialogOpen, setIsHourBankDetailDialogOpen] = useState(false);
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>('day');
  const [attendanceDate, setAttendanceDate] = useState(() => createDateInputValue(new Date()));
  const [attendanceMonth, setAttendanceMonth] = useState(() => createMonthInputValue(new Date()));
  const [attendanceDrafts, setAttendanceDrafts] = useState<AttendanceDraft[]>([]);
  const [monthlyAttendanceDrafts, setMonthlyAttendanceDrafts] = useState<AttendanceDraft[]>([]);
  const [attendanceImportFileName, setAttendanceImportFileName] = useState('');
  const [attendanceImportRows, setAttendanceImportRows] = useState<AttendanceImportRow[]>([]);
  const [attendanceImportErrors, setAttendanceImportErrors] = useState<AttendanceImportError[]>([]);
  const [showAllAttendanceImportErrors, setShowAllAttendanceImportErrors] = useState(false);
  const [isAttendanceImportParsing, setIsAttendanceImportParsing] = useState(false);
  // How many loaded spreadsheet rows lack the 1h lunch break — opens the "descontar almoço?" prompt.
  const [attendanceLunchPromptCount, setAttendanceLunchPromptCount] = useState(0);
  const [attendanceError, setAttendanceError] = useState('');
  const [attendanceMessage, setAttendanceMessage] = useState('');
  const [isAttendanceSubmitting, setIsAttendanceSubmitting] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarWeek, setCalendarWeek] = useState('all');
  const [hourBankPeriodMode, setHourBankPeriodMode] = useState<HourBankPeriodMode>('month');
  const [hourBankDate, setHourBankDate] = useState(() => createDateInputValue(new Date()));
  const [hourBankMonth, setHourBankMonth] = useState(() => createMonthInputValue(new Date()));
  const [hourBankYear, setHourBankYear] = useState(() => new Date().getFullYear());
  const [hourBankDetailTechnicianId, setHourBankDetailTechnicianId] = useState('all');
  const [builderDialog, setBuilderDialog] = useState<ScheduleBuilderDialog>(null);
  const [activeDayRuleKey, setActiveDayRuleKey] = useState<ScheduleDayRuleKey | null>(null);
  const [formData, setFormData] = useState<ScheduleBuilderForm>(createInitialBuilderForm);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      if (!user) return;

      setIsDataLoading(true);
      const result = await fetchSchedulePageData();

      if (!mounted) {
        return;
      }

      setSchedule(result.schedule);
      setTechnicians(result.technicians);
      setWorkHours(result.workHours);
      setDataError(result.error);
      setIsDataLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [user]);

  const activeTechnicians = useMemo(
    () => technicians.filter((technician) => technician.status === 'active'),
    [technicians],
  );
  const activeTechnicianIds = useMemo(
    () => new Set(activeTechnicians.map((technician) => technician.id)),
    [activeTechnicians],
  );
  const visibleSchedule = useMemo(
    () => schedule
      .filter((item) => activeTechnicianIds.has(item.technician_id))
      .sort((left, right) => normalizeDateKey(left.date).localeCompare(normalizeDateKey(right.date))),
    [activeTechnicianIds, schedule],
  );
  const visibleWorkHours = useMemo(
    () => workHours
      .filter((item) => activeTechnicianIds.has(item.technician_id))
      .sort((left, right) => normalizeDateKey(left.date).localeCompare(normalizeDateKey(right.date))),
    [activeTechnicianIds, workHours],
  );
  const sortedTechnicians = useMemo(
    () => [...activeTechnicians].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [activeTechnicians],
  );
  const technicianNameById = useMemo(
    () => new Map(technicians.map((technician) => [technician.id, technician.name])),
    [technicians],
  );
  const inputClassName = 'min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';
  const scheduleByDate = useMemo(() => {
    const grouped = new Map<string, Schedule[]>();

    visibleSchedule.forEach((item) => {
      const key = normalizeDateKey(item.date);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    return grouped;
  }, [visibleSchedule]);
  const workHoursByTechnicianDate = useMemo(() => {
    const grouped = new Map<string, WorkHours[]>();

    visibleWorkHours.forEach((item) => {
      const key = createAttendanceKey(item.technician_id, normalizeDateKey(item.date));
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    return grouped;
  }, [visibleWorkHours]);
  const selectedTechnicianIds = useMemo(
    () => (formData.technician_scope === 'all' ? sortedTechnicians.map((technician) => technician.id) : formData.technician_ids),
    [formData.technician_ids, formData.technician_scope, sortedTechnicians],
  );
  const ruleTechnicians = useMemo(() => {
    if (formData.technician_scope === 'selected' && formData.technician_ids.length) {
      return sortedTechnicians.filter((technician) => formData.technician_ids.includes(technician.id));
    }

    return sortedTechnicians;
  }, [formData.technician_ids, formData.technician_scope, sortedTechnicians]);

  useEffect(() => {
    const availableTechnicianIds = new Set(ruleTechnicians.map((technician) => technician.id));

    setFormData((current) => {
      let changed = false;
      const nextDayRules = { ...current.day_rules };

      dayRuleDefinitions.forEach(({ key }) => {
        const groupId = current.day_rule_group_ids[key];
        if (!groupId) {
          return;
        }

        const group = current.groups.find((item) => item.id === groupId);
        const nextTechnicianIds = group
          ? group.technician_ids.filter((technicianId) => availableTechnicianIds.has(technicianId))
          : [];
        const currentTechnicianIds = normalizeTechnicianIds(current.day_rules[key].technician_ids);

        if (currentTechnicianIds.join('|') !== normalizeTechnicianIds(nextTechnicianIds).join('|')) {
          nextDayRules[key] = {
            ...nextDayRules[key],
            technician_ids: nextTechnicianIds,
          };
          changed = true;
        }
      });

      return changed ? { ...current, day_rules: nextDayRules } : current;
    });
  }, [ruleTechnicians]);

  const generationPreview = useMemo(
    () => getScheduleGenerationPreview(formData.period_mode, formData.year, formData.period_mode === 'month' ? formData.month : undefined, selectedTechnicianIds, formData.date),
    [formData.date, formData.month, formData.period_mode, formData.year, selectedTechnicianIds],
  );

  function getEffectiveDayRules() {
    const nextRules: Record<ScheduleDayRuleKey, WeekendCoverageRule> = {
      monday: { ...formData.day_rules.monday, technician_ids: [...formData.day_rules.monday.technician_ids] },
      tuesday: { ...formData.day_rules.tuesday, technician_ids: [...formData.day_rules.tuesday.technician_ids] },
      wednesday: { ...formData.day_rules.wednesday, technician_ids: [...formData.day_rules.wednesday.technician_ids] },
      thursday: { ...formData.day_rules.thursday, technician_ids: [...formData.day_rules.thursday.technician_ids] },
      friday: { ...formData.day_rules.friday, technician_ids: [...formData.day_rules.friday.technician_ids] },
      saturday: { ...formData.day_rules.saturday, technician_ids: [...formData.day_rules.saturday.technician_ids] },
      sunday: { ...formData.day_rules.sunday, technician_ids: [...formData.day_rules.sunday.technician_ids] },
    };
    const rotationParticipantsByDay = new Map<ScheduleDayRuleKey, string[]>();

    formData.rotation_groups.forEach((group) => {
      const groupTechnicians = normalizeTechnicianIds(group.technician_ids).filter((technicianId) => selectedTechnicianIds.includes(technicianId));

      group.day_keys.forEach((dayKey) => {
        rotationParticipantsByDay.set(dayKey, normalizeTechnicianIds([...(rotationParticipantsByDay.get(dayKey) ?? []), ...groupTechnicians]));
      });
    });

    rotationParticipantsByDay.forEach((technicianIds, dayKey) => {
      if (!technicianIds.length) {
        return;
      }

      nextRules[dayKey] = {
        ...nextRules[dayKey],
        mode: 'all',
        technician_ids: [],
        rotation_cadence: 'weekly',
      };
    });

    return nextRules;
  }

  function buildSchedulePayload(): ScheduleGenerationInput {
    const dayRules = getEffectiveDayRules();

    return {
      period_mode: formData.period_mode,
      year: formData.period_mode === 'day' || formData.period_mode === 'week' ? getYearFromDateKey(formData.date, formData.year) : formData.year,
      month: formData.period_mode === 'month' ? formData.month : undefined,
      date: formData.period_mode === 'day' || formData.period_mode === 'week' ? formData.date : undefined,
      technician_scope: formData.technician_scope,
      technician_ids: formData.technician_scope === 'selected' ? formData.technician_ids : [],
      weekday_start_time: formData.weekday_start_time,
      weekday_end_time: formData.weekday_end_time,
      weekend_start_time: formData.weekend_start_time,
      weekend_end_time: formData.weekend_end_time,
      saturday_rule: dayRules.saturday,
      sunday_rule: dayRules.sunday,
      day_rules: dayRules,
      rotation_groups: formData.rotation_groups.map(({ label, day_keys, technician_ids, rotation_cadence }) => ({
        label,
        day_keys,
        technician_ids,
        rotation_cadence: rotation_cadence ?? 'weekly',
      })),
      recurring_rules: formData.recurring_rules.map(({ technician_id, day_keys, status, start_time, end_time, notes }) => ({
        technician_id,
        day_keys,
        status,
        start_time,
        end_time,
        notes,
      })),
      general_days_off: formData.general_days_off.map(({ date, notes }) => ({ date, notes })),
      overrides: formData.overrides.map(({ technician_id, date, status, start_time, end_time, notes }) => ({
        technician_id,
        date,
        status,
        start_time,
        end_time,
        notes,
      })),
    };
  }

  function getRotationPreviewRows(group: RotationGroupDraft): RotationPreviewRow[] {
    const availableTechnicianIds = ruleTechnicians.map((technician) => technician.id).filter((technicianId) => selectedTechnicianIds.includes(technicianId));
    const { firstTeam, nextTeam } = getRotationTeams(group.technician_ids, availableTechnicianIds);
    const namesById = new Map(ruleTechnicians.map((technician) => [technician.id, technician.name]));
    const occurrenceByDay = new Map<ScheduleDayRuleKey, number>();
    const previewDates = enumerateDateKeys(generationPreview.startDate, generationPreview.endDate)
      .filter((dateKey) => group.day_keys.includes(getDayKeyFromDateKey(dateKey)))
      .slice(0, 8);

    if (!firstTeam.length || !nextTeam.length) {
      return [];
    }

    return previewDates.map((date) => {
      const dayKey = getDayKeyFromDateKey(date);
      const occurrenceIndex = occurrenceByDay.get(dayKey) ?? 0;
      occurrenceByDay.set(dayKey, occurrenceIndex + 1);

      const workerIds = occurrenceIndex % 2 === 0 ? firstTeam : nextTeam;
      return {
        date,
        dayLabel: getDayLabelFromKey(dayKey),
        workerNames: workerIds.map((workerId) => namesById.get(workerId) || workerId),
      };
    });
  }

  useEffect(() => {
    if (!isAttendanceDialogOpen) {
      return;
    }

    const dayEntries = scheduleByDate.get(attendanceDate) ?? [];

    setAttendanceDrafts(sortedTechnicians.map((technician) => {
      const entry = getBestScheduleEntry(dayEntries.filter((item) => item.technician_id === technician.id));
      const workHour = getBestWorkHour(workHoursByTechnicianDate.get(createAttendanceKey(technician.id, attendanceDate)) ?? []);
      const manual = parseManualAttendanceNote(entry?.notes);
      const plannedTimes = getSchedulePlannedTimes(entry);
      const plannedStartTime = plannedTimes.startTime;
      const plannedEndTime = plannedTimes.endTime;
      const plannedHours = getSchedulePlannedHoursForDraft(entry, plannedStartTime, plannedEndTime);
      const attendanceStatus: AttendanceStatus = workHour ? 'worked' : getAttendanceStatusFromSchedule(entry);

      return {
        key: technician.id,
        date: attendanceDate,
        technician_id: technician.id,
        technician_name: technician.name,
        attendance_status: attendanceStatus,
        planned_start_time: plannedStartTime,
        planned_end_time: plannedEndTime,
        planned_hours: plannedHours,
        actual_start_time: workHour ? normalizeTimeInput(workHour.start_time, plannedStartTime) : attendanceHasHours(attendanceStatus) ? normalizeTimeInput(entry?.start_time, plannedStartTime) : plannedStartTime,
        actual_end_time: workHour ? normalizeTimeInput(workHour.end_time, plannedEndTime) : attendanceHasHours(attendanceStatus) ? normalizeTimeInput(entry?.end_time, plannedEndTime) : plannedEndTime,
        notes: manual.observation,
        schedule_status: entry?.status,
      };
    }));
  }, [attendanceDate, isAttendanceDialogOpen, scheduleByDate, sortedTechnicians, workHoursByTechnicianDate]);

  useEffect(() => {
    if (!isAttendanceDialogOpen) {
      return;
    }

    const [year, month] = attendanceMonth.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      setMonthlyAttendanceDrafts([]);
      return;
    }

    const { startDate, endDate } = getScheduleRange('month', year, month);
    const technicianNames = new Map(sortedTechnicians.map((technician) => [technician.id, technician.name]));
    const grouped = new Map<string, Schedule[]>();

    visibleSchedule.forEach((item) => {
      const dateKey = normalizeDateKey(item.date);
      if (dateKey < startDate || dateKey > endDate) {
        return;
      }

      const key = `${dateKey}::${item.technician_id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    });

    visibleWorkHours.forEach((item) => {
      const dateKey = normalizeDateKey(item.date);
      if (dateKey < startDate || dateKey > endDate) {
        return;
      }

      const key = `${dateKey}::${item.technician_id}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
    });

    const nextDrafts = Array.from(grouped.entries()).reduce<AttendanceDraft[]>((entries, [key, dayEntries]) => {
      const [dateFromKey, technicianIdFromKey] = key.split('::');
      const entry = getBestScheduleEntry(dayEntries);
      const date = normalizeDateKey(entry?.date || dateFromKey);
      const technicianId = entry?.technician_id || technicianIdFromKey;
      const workHour = getBestWorkHour(workHoursByTechnicianDate.get(createAttendanceKey(technicianId, date)) ?? []);

      if (!entry && !workHour) {
        return entries;
      }

      const manual = parseManualAttendanceNote(entry?.notes);
      const plannedTimes = getSchedulePlannedTimes(entry);
      const startTime = plannedTimes.startTime;
      const endTime = plannedTimes.endTime;
      const plannedHours = getSchedulePlannedHoursForDraft(entry, startTime, endTime);

      if (entry && entry.status !== 'cancelled' && plannedHours <= 0 && !workHour) {
        return entries;
      }

      const technicianName = entry?.technician_name || technicianNames.get(technicianId) || technicianId;
      const attendanceStatus: AttendanceStatus = workHour ? 'worked' : getAttendanceStatusFromSchedule(entry);

      entries.push({
        key,
        date,
        technician_id: technicianId,
        technician_name: technicianName,
        attendance_status: attendanceStatus,
        planned_start_time: startTime,
        planned_end_time: endTime,
        planned_hours: plannedHours,
        actual_start_time: workHour ? normalizeTimeInput(workHour.start_time, startTime) : attendanceHasHours(attendanceStatus) ? normalizeTimeInput(entry?.start_time, startTime) : startTime,
        actual_end_time: workHour ? normalizeTimeInput(workHour.end_time, endTime) : attendanceHasHours(attendanceStatus) ? normalizeTimeInput(entry?.end_time, endTime) : endTime,
        notes: manual.observation,
        schedule_status: entry?.status,
      });

      return entries;
    }, []).sort((left, right) => left.date.localeCompare(right.date) || left.technician_name.localeCompare(right.technician_name, 'pt-BR'));

    setMonthlyAttendanceDrafts(nextDrafts);
  }, [attendanceMonth, isAttendanceDialogOpen, sortedTechnicians, visibleSchedule, visibleWorkHours, workHoursByTechnicianDate]);

  const filteredSchedule = useMemo(() => {
    return visibleSchedule.filter((item) => {
      const haystack = normalizeText(`${item.technician_name || item.technician_id} ${item.notes || ''} ${item.status} ${normalizeDateKey(item.date)}`);
      return !query || haystack.includes(normalizeText(query));
    });
  }, [query, visibleSchedule]);
  const calendarWeeks = useMemo(() => getMonthWeeks(calendarYear, calendarMonth), [calendarMonth, calendarYear]);
  const displayedCalendarWeeks = calendarWeek === 'all' ? calendarWeeks : [calendarWeeks[Number(calendarWeek)] ?? calendarWeeks[0]].filter(Boolean);
  const calendarYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from(new Set([currentYear, currentYear + 1, ...visibleSchedule.map((item) => Number(normalizeDateKey(item.date).slice(0, 4)))]))
      .filter((year) => Number.isFinite(year))
      .sort((left, right) => left - right);
  }, [visibleSchedule]);
  const calendarMonthKey = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}`;
  const calendarScheduledEntries = useMemo(
    () => visibleSchedule.filter((item) => normalizeDateKey(item.date).startsWith(calendarMonthKey) && (item.status !== 'cancelled' || Boolean(parseManualAttendanceNote(item.notes).attendance_status))),
    [calendarMonthKey, visibleSchedule],
  );
  const hourBankRange = useMemo(() => {
    if (hourBankPeriodMode === 'month') {
      const parts = getYearMonthParts(hourBankMonth);
      return getScheduleRange('month', parts.year, parts.month);
    }
    if (hourBankPeriodMode === 'year') {
      return getScheduleRange('year', hourBankYear);
    }

    const year = Number(hourBankDate.slice(0, 4)) || new Date().getFullYear();
    return getScheduleRange(hourBankPeriodMode, year, undefined, hourBankDate);
  }, [hourBankDate, hourBankMonth, hourBankPeriodMode, hourBankYear]);
  const hourBankPeriodLabel = useMemo(
    () => getHourBankPeriodLabel(hourBankPeriodMode, hourBankRange.startDate, hourBankRange.endDate, hourBankMonth),
    [hourBankMonth, hourBankPeriodMode, hourBankRange.endDate, hourBankRange.startDate],
  );
  const hourBankSchedule = useMemo(
    () => visibleSchedule.filter((item) => {
      const dateKey = normalizeDateKey(item.date);
      return dateKey >= hourBankRange.startDate && dateKey <= hourBankRange.endDate;
    }),
    [hourBankRange.endDate, hourBankRange.startDate, visibleSchedule],
  );
  const hourBankWorkHours = useMemo(
    () => visibleWorkHours.filter((item) => {
      const dateKey = normalizeDateKey(item.date);
      return dateKey >= hourBankRange.startDate && dateKey <= hourBankRange.endDate;
    }),
    [hourBankRange.endDate, hourBankRange.startDate, visibleWorkHours],
  );
  const hourBankDetailRows = useMemo<HourBankDetailRow[]>(
    () => buildHourBankDetailRows(hourBankSchedule, hourBankWorkHours, technicianNameById),
    [hourBankSchedule, hourBankWorkHours, technicianNameById],
  );
  const hourBankDetailRowsFiltered = useMemo(
    () => (hourBankDetailTechnicianId === 'all' ? hourBankDetailRows : hourBankDetailRows.filter((row) => row.technician_id === hourBankDetailTechnicianId)),
    [hourBankDetailRows, hourBankDetailTechnicianId],
  );
  const hourBankDetailFilteredTotals = useMemo(() => {
    return hourBankDetailRowsFiltered.reduce(
      (totals, row) => ({
        planned: totals.planned + row.planned_hours,
        worked: totals.worked + row.worked_hours,
        balance: totals.balance + row.balance,
      }),
      { planned: 0, worked: 0, balance: 0 },
    );
  }, [hourBankDetailRowsFiltered]);
  const hourBankRows = useMemo<HourBankRow[]>(() => {
    const monthSchedule = hourBankSchedule;
    const monthWorkHours = hourBankWorkHours;
    const scheduleByTechnicianDate = new Map<string, Schedule[]>();
    const workHoursByTechnician = new Map<string, WorkHours[]>();

    monthSchedule.forEach((item) => {
      const key = `${item.technician_id}::${normalizeDateKey(item.date)}`;
      scheduleByTechnicianDate.set(key, [...(scheduleByTechnicianDate.get(key) ?? []), item]);
    });

    monthWorkHours.forEach((item) => {
      workHoursByTechnician.set(item.technician_id, [...(workHoursByTechnician.get(item.technician_id) ?? []), item]);
    });

    return sortedTechnicians.map((technician) => {
      const technicianWorkHours = workHoursByTechnician.get(technician.id) ?? [];
      const technicianScheduleDates = monthSchedule
        .filter((item) => item.technician_id === technician.id)
        .map((item) => normalizeDateKey(item.date));
      const technicianWorkDates = technicianWorkHours.map((item) => normalizeDateKey(item.date));
      const dateKeys = Array.from(new Set([...technicianScheduleDates, ...technicianWorkDates]));
      let plannedHours = 0;
      let dayOffDays = 0;
      let missedDays = 0;
      let justifiedDays = 0;
      let pendingDays = 0;

      dateKeys.forEach((dateKey) => {
        const entry = getBestScheduleEntry(scheduleByTechnicianDate.get(`${technician.id}::${dateKey}`) ?? []);
        if (!entry) return;

        const manualStatus = parseManualAttendanceNote(entry.notes).attendance_status;
        plannedHours += getSchedulePlannedHoursForBank(entry);

        if (manualStatus === 'missed') {
          missedDays += 1;
        } else if (manualStatus === 'justified') {
          justifiedDays += 1;
        } else if (manualStatus === 'day_off' || (entry.status === 'cancelled' && !manualStatus)) {
          dayOffDays += 1;
        } else if (entry.status === 'scheduled') {
          pendingDays += 1;
        }
      });

      const workedHours = technicianWorkHours.reduce((total, item) => total + Number(item.hours_worked || 0), 0);
      const workedDays = new Set(technicianWorkHours.filter((item) => Number(item.hours_worked || 0) > 0).map((item) => normalizeDateKey(item.date))).size;

      return {
        technician_id: technician.id,
        technician_name: technician.name,
        planned_hours: Number(plannedHours.toFixed(2)),
        worked_hours: Number(workedHours.toFixed(2)),
        balance: Number((workedHours - plannedHours).toFixed(2)),
        worked_days: workedDays,
        day_off_days: dayOffDays,
        missed_days: missedDays,
        justified_days: justifiedDays,
        pending_days: pendingDays,
      };
    });
  }, [hourBankSchedule, hourBankWorkHours, sortedTechnicians]);
  const hourBankTotals = useMemo(() => {
    return hourBankRows.reduce(
      (totals, row) => ({
        planned: totals.planned + row.planned_hours,
        worked: totals.worked + row.worked_hours,
        balance: totals.balance + row.balance,
        pending: totals.pending + row.pending_days,
        missed: totals.missed + row.missed_days,
      }),
      { planned: 0, worked: 0, balance: 0, pending: 0, missed: 0 },
    );
  }, [hourBankRows]);
  const hourBankVisibleRows = useMemo(
    () => hourBankRows.filter((row) => row.planned_hours || row.worked_hours || row.day_off_days || row.missed_days || row.justified_days || row.pending_days),
    [hourBankRows],
  );
  const weekDates = useMemo(() => getNextDateKeys(7), []);

  useEffect(() => {
    if (calendarWeek !== 'all' && Number(calendarWeek) >= calendarWeeks.length) {
      setCalendarWeek('all');
    }
  }, [calendarWeek, calendarWeeks.length]);

  function resetForm() {
    setFormData(createInitialBuilderForm());
    setFormError('');
  }

  function handleFormDialogChange(open: boolean) {
    setIsFormDialogOpen(open);

    if (!open) {
      setBuilderDialog(null);
      setActiveDayRuleKey(null);
      resetForm();
    }
  }

  function handleAttendanceDialogChange(open: boolean) {
    setIsAttendanceDialogOpen(open);
    setAttendanceError('');
    setAttendanceMessage('');

    if (open) {
      const now = new Date();
      setAttendanceMode('day');
      setAttendanceDate(createDateInputValue(now));
      setAttendanceMonth(createMonthInputValue(now));
      setAttendanceImportFileName('');
      setAttendanceImportRows([]);
      setAttendanceImportErrors([]);
      setShowAllAttendanceImportErrors(false);
    }
  }

  function openAttendanceForDate(dateKey: string) {
    setAttendanceMode('day');
    setAttendanceDate(dateKey);
    setAttendanceMonth(dateKey.slice(0, 7));
    setAttendanceError('');
    setAttendanceMessage('');
    setIsAttendanceDialogOpen(true);
  }

  function openAttendanceImportDialog() {
    setAttendanceMode('spreadsheet');
    setAttendanceError('');
    setAttendanceMessage('');
    resetAttendanceImport();
    setIsAttendanceDialogOpen(true);
  }

  function handleAttendanceModeChange(mode: AttendanceMode) {
    setAttendanceMode(mode);
    setAttendanceError('');
    setAttendanceMessage('');
  }

  function resetAttendanceImport() {
    setAttendanceImportFileName('');
    setAttendanceImportRows([]);
    setAttendanceImportErrors([]);
    setShowAllAttendanceImportErrors(false);
    setAttendanceLunchPromptCount(0);
  }

  function applyImportLunchBreak() {
    const count = attendanceImportRows.filter(importRowMissingLunchBreak).length;
    setAttendanceImportRows((rows) => rows.map((row) => (
      importRowMissingLunchBreak(row) ? { ...row, hours_worked: Number((row.hours_worked - scheduleRules.dailyBreakHours).toFixed(2)) } : row
    )));
    setAttendanceLunchPromptCount(0);
    setAttendanceMessage(`Desconto de ${formatBreakLabel(scheduleRules.dailyBreakMinutes)} de almoço aplicado em ${formatCount(count, 'apontamento', 'apontamentos')} da planilha.`);
  }

  function parseAttendanceWorkbook(workbook: XLSX.WorkBook, fileName: string) {
    const sheetName = getAttendanceWorksheetName(workbook);
    if (!sheetName) {
      return {
        rows: [],
        errors: [{
          key: 'workbook-empty',
          row_number: 0,
          sheet_name: '',
          message: 'A planilha não possui abas para importar.',
          details: ['Nenhuma aba foi encontrada no arquivo selecionado.'],
          suggestion: 'Baixe o modelo XLSX, preencha a aba Banco de Dados e tente novamente.',
          values: {
            date: '',
            employee: '',
            start_time: '',
            end_time: '',
            hours_worked: '',
            week_number: '',
            month: '',
            year: '',
          },
        }],
      };
    }

    const worksheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '', raw: false, blankrows: false });
    const technicianMatches = buildTechnicianMatchMap(sortedTechnicians);
    const seenKeys = new Set<string>();
    const rows: AttendanceImportRow[] = [];
    const errors: AttendanceImportError[] = [];

    rawRows.forEach((rawRow, index) => {
      const rowNumber = index + 2;
      const dateValue = getImportValue(rawRow, attendanceImportColumnAliases.date);
      const importedName = String(getImportValue(rawRow, attendanceImportColumnAliases.employee) ?? '').trim();
      const startTimeValue = getImportValue(rawRow, attendanceImportColumnAliases.startTime);
      const endTimeValue = getImportValue(rawRow, attendanceImportColumnAliases.endTime);
      const hoursValue = getImportValue(rawRow, attendanceImportColumnAliases.hoursWorked);
      const weekValue = getImportValue(rawRow, attendanceImportColumnAliases.weekNumber);
      const monthValue = getImportValue(rawRow, attendanceImportColumnAliases.month);
      const yearValue = getImportValue(rawRow, attendanceImportColumnAliases.year);
      const errorValues = {
        date: formatImportValue(dateValue),
        employee: importedName,
        start_time: formatImportValue(startTimeValue),
        end_time: formatImportValue(endTimeValue),
        hours_worked: formatImportValue(hoursValue),
        week_number: formatImportValue(weekValue),
        month: formatImportValue(monthValue),
        year: formatImportValue(yearValue),
      };

      if (!dateValue && !importedName && !startTimeValue && !endTimeValue && !hoursValue) {
        return;
      }

      const rowErrors: string[] = [];
      const rowDetails: string[] = [];
      const parsedDate = parseImportedDate(dateValue, monthValue, yearValue);
      const startTime = parseImportedTime(startTimeValue);
      const endTime = parseImportedTime(endTimeValue);
      const technician = resolveImportedTechnician(importedName, sortedTechnicians, technicianMatches);
      const hoursWorked = parseImportedHours(hoursValue, startTime, endTime);

      if (!parsedDate) {
        rowErrors.push('data inválida');
        rowDetails.push(`Data lida: "${errorValues.date || 'vazio'}". Use dd/mm/aaaa.`);
      }

      if (!importedName) {
        rowErrors.push('funcionário vazio');
        rowDetails.push('Funcionário veio vazio. Preencha com o nome de um técnico ativo.');
      }

      if (importedName && !technician) {
        rowErrors.push(`técnico não encontrado: ${importedName}`);
        rowDetails.push(`Funcionário lido: "${importedName}". O sistema não encontrou um técnico ativo com esse nome.`);
      }

      if (!startTime) {
        rowErrors.push('hora de início inválida');
        rowDetails.push(`Hora Início lida: "${errorValues.start_time || 'vazio'}". Use HH:mm, por exemplo 08:00.`);
      }

      if (!endTime) {
        rowErrors.push('hora final inválida');
        rowDetails.push(`Hora Final lida: "${errorValues.end_time || 'vazio'}". Use HH:mm, por exemplo 17:30.`);
      }

      if (hoursWorked === null) {
        rowErrors.push('horas trabalhadas inválidas');
        rowDetails.push(`Horas Trabalhadas lida: "${errorValues.hours_worked || 'vazio'}". Use decimal, por exemplo 9,65, ou preencha Entrada e Saída válidas.`);
      }

      if (parsedDate && parseImportInteger(monthValue) && parseImportInteger(monthValue) !== parsedDate.month) {
        rowErrors.push('mês da linha não confere com a data');
        rowDetails.push(`Mês lido: "${errorValues.month}". Pela Data, o mês esperado é ${parsedDate.month}.`);
      }

      if (parsedDate && parseImportInteger(yearValue) && parseImportInteger(yearValue) !== parsedDate.year) {
        rowErrors.push('ano da linha não confere com a data');
        rowDetails.push(`Ano lido: "${errorValues.year}". Pela Data, o ano esperado é ${parsedDate.year}.`);
      }

      if (rowErrors.length || !parsedDate || !technician || hoursWorked === null) {
        errors.push({
          key: `${sheetName}-${rowNumber}`,
          row_number: rowNumber,
          sheet_name: sheetName,
          message: rowErrors.join('; '),
          details: rowDetails,
          suggestion: getImportErrorSuggestion(rowErrors),
          values: errorValues,
        });
        return;
      }

      const duplicateKey = createAttendanceKey(technician.id, parsedDate.date);
      if (seenKeys.has(duplicateKey)) {
        errors.push({
          key: `${sheetName}-${rowNumber}`,
          row_number: rowNumber,
          sheet_name: sheetName,
          message: `apontamento duplicado para ${technician.name} em ${formatDate(parsedDate.date)}`,
          details: [
            `Funcionário lido: "${importedName}".`,
            `Data lida: "${errorValues.date}".`,
            'Ja existe outra linha valida para o mesmo tecnico e data nesta importacao.',
          ],
          suggestion: getImportErrorSuggestion(['duplicado']),
          values: errorValues,
        });
        return;
      }

      seenKeys.add(duplicateKey);

      const scheduleEntry = getBestScheduleEntry((scheduleByDate.get(parsedDate.date) ?? []).filter((item) => item.technician_id === technician.id));
      const plannedTimes = getSchedulePlannedTimes(scheduleEntry, startTime, endTime);
      const month = parseImportInteger(monthValue) ?? parsedDate.month;
      const year = parseImportInteger(yearValue) ?? parsedDate.year;
      const weekNumber = parseImportInteger(weekValue) ?? getIsoWeekNumber(parsedDate.date);

      rows.push({
        key: duplicateKey,
        row_number: rowNumber,
        sheet_name: sheetName,
        date: parsedDate.date,
        technician_id: technician.id,
        technician_name: technician.name,
        imported_name: importedName,
        start_time: startTime,
        end_time: endTime,
        planned_start_time: plannedTimes.startTime,
        planned_end_time: plannedTimes.endTime,
        hours_worked: hoursWorked,
        week_number: weekNumber,
        month,
        year,
        notes: `Importado via planilha ${fileName}; aba ${sheetName}; linha ${rowNumber}`,
      });
    });

    return {
      rows: rows.sort((left, right) => left.date.localeCompare(right.date) || left.technician_name.localeCompare(right.technician_name, 'pt-BR')),
      errors,
    };
  }

  async function handleAttendanceImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    setAttendanceError('');
    setAttendanceMessage('');
    resetAttendanceImport();

    if (!file) {
      return;
    }

    setIsAttendanceImportParsing(true);

    try {
      const buffer = await file.arrayBuffer();
      // Dates become dd/mm/aaaa text and a CSV is kept as text (lib/spreadsheet-import.ts): the
      // reader below takes the first number as the day.
      const workbook = applyBrazilianDateText(readSpreadsheet(buffer, file.name));
      const parsed = parseAttendanceWorkbook(workbook, file.name);

      setAttendanceImportFileName(file.name);
      setAttendanceImportRows(parsed.rows);
      setAttendanceImportErrors(parsed.errors);

      if (!parsed.rows.length) {
        setAttendanceError(parsed.errors.length ? 'Nenhuma linha válida foi encontrada na planilha.' : 'A planilha não possui linhas para importar.');
        return;
      }

      setAttendanceMessage(`${formatCount(parsed.rows.length, 'apontamento valido', 'apontamentos validos')} carregado(s) da planilha.`);
      setAttendanceLunchPromptCount(parsed.rows.filter(importRowMissingLunchBreak).length);
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : 'Não foi possível ler a planilha. Use XLSX, XLS ou CSV.');
    } finally {
      setIsAttendanceImportParsing(false);
    }
  }

  function updateAttendanceDraft(draftKey: string, changes: Partial<AttendanceDraft>) {
    setAttendanceDrafts((current) => current.map((draft) => (
      draft.key === draftKey ? { ...draft, ...changes } : draft
    )));
  }

  function updateMonthlyAttendanceDraft(draftKey: string, changes: Partial<AttendanceDraft>) {
    setMonthlyAttendanceDrafts((current) => current.map((draft) => (
      draft.key === draftKey ? { ...draft, ...changes } : draft
    )));
  }

  function markAttendanceAutomatically() {
    if (attendanceMode === 'month') {
      setMonthlyAttendanceDrafts((current) => current.map((draft) => ({
        ...draft,
        attendance_status: draft.schedule_status === 'cancelled'
          ? 'day_off'
          : draft.schedule_status
            ? 'worked'
            : 'not_marked',
        actual_start_time: draft.planned_start_time || scheduleRules.defaultStartTime,
        actual_end_time: draft.planned_end_time || scheduleRules.defaultEndTime,
      })));
      setAttendanceError('');
      setAttendanceMessage(monthlyAttendanceDrafts.length
        ? `${formatCount(monthlyAttendanceDrafts.length, 'apontamento marcado', 'apontamentos marcados')} para o mês.`
        : 'Não há escala ativa salva para apontar neste mês.');
      return;
    }

    setAttendanceDrafts((current) => current.map((draft) => ({
      ...draft,
      attendance_status: draft.schedule_status === 'cancelled'
        ? 'day_off'
        : draft.schedule_status
          ? 'worked'
          : 'not_marked',
      actual_start_time: draft.planned_start_time || scheduleRules.defaultStartTime,
      actual_end_time: draft.planned_end_time || scheduleRules.defaultEndTime,
    })));
  }

  async function handleAttendanceSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAttendanceError('');
    setAttendanceMessage('');

    if (attendanceMode === 'spreadsheet') {
      if (!attendanceImportRows.length) {
        setAttendanceError('Carregue uma planilha com apontamentos validos antes de salvar.');
        return;
      }

      setIsAttendanceSubmitting(true);

      const entries = attendanceImportRows.map((row) => ({
        technician_id: row.technician_id,
        date: row.date,
        start_time: row.start_time,
        end_time: row.end_time,
        planned_start_time: row.planned_start_time,
        planned_end_time: row.planned_end_time,
        hours_worked: row.hours_worked,
        week_number: row.week_number,
        month: row.month,
        year: row.year,
        attendance_status: 'worked',
        notes: row.notes,
      }));

      try {
        const response = await fetch('/api/work-hours', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entries }),
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || 'Não foi possível salvar os apontamentos da planilha.');
        }

        const refreshed = await fetchSchedulePageData();
        setSchedule(refreshed.schedule);
        setTechnicians(refreshed.technicians);
        setWorkHours(refreshed.workHours);
        setDataError(refreshed.error);
        setSaveMessage(`Banco de horas atualizado via planilha com ${formatCount(Number(data?.count ?? entries.length), 'apontamento', 'apontamentos')}.`);
        setIsAttendanceDialogOpen(false);
        setAttendanceDrafts([]);
        setMonthlyAttendanceDrafts([]);
        resetAttendanceImport();
        setAttendanceError('');
        setAttendanceMessage('');
      } catch (error) {
        setAttendanceError(error instanceof Error ? error.message : 'Não foi possível salvar os apontamentos da planilha.');
      } finally {
        setIsAttendanceSubmitting(false);
      }

      return;
    }

    const sourceDrafts = attendanceMode === 'day' ? attendanceDrafts : monthlyAttendanceDrafts;
    const selectedDrafts = sourceDrafts.filter(isAttendanceSelected);

    if (!selectedDrafts.length) {
      setAttendanceError(attendanceMode === 'month' ? 'Selecione ao menos um apontamento do mês.' : 'Selecione ao menos um técnico para lançar o apontamento.');
      return;
    }

    const invalidDraft = selectedDrafts.find((draft) => (
      draft.attendance_status === 'worked' && getHoursBetween(draft.actual_start_time, draft.actual_end_time) <= 0
    ));

    if (invalidDraft) {
      setAttendanceError(`Revise as horas de ${invalidDraft.technician_name} em ${formatDate(invalidDraft.date)}.`);
      return;
    }

    setIsAttendanceSubmitting(true);

    const entries = selectedDrafts.map((draft) => {
      const hoursWorked = getAttendanceWorkedHours(draft);
      const startTime = normalizeTimeInput(attendanceHasHours(draft.attendance_status) ? draft.actual_start_time : draft.planned_start_time, scheduleRules.defaultStartTime);
      const endTime = normalizeTimeInput(attendanceHasHours(draft.attendance_status) ? draft.actual_end_time : draft.planned_end_time, scheduleRules.defaultEndTime);
      const dateParts = draft.date.split('-').map(Number);

      return {
        technician_id: draft.technician_id,
        date: draft.date,
        start_time: startTime,
        end_time: endTime,
        planned_start_time: normalizeTimeInput(draft.planned_start_time, scheduleRules.defaultStartTime),
        planned_end_time: normalizeTimeInput(draft.planned_end_time, scheduleRules.defaultEndTime),
        hours_worked: hoursWorked,
        week_number: getIsoWeekNumber(draft.date),
        month: dateParts[1],
        year: dateParts[0],
        attendance_status: draft.attendance_status,
        notes: draft.notes,
      };
    });

    const payload = { entries };

    try {
      const response = await fetch('/api/work-hours', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível salvar o apontamento.');
      }

      const refreshed = await fetchSchedulePageData();
      setSchedule(refreshed.schedule);
      setTechnicians(refreshed.technicians);
      setWorkHours(refreshed.workHours);
      setDataError(refreshed.error);
      setSaveMessage(attendanceMode === 'month'
        ? `Banco de horas atualizado para ${attendanceMonth} com ${formatCount(entries.length, 'apontamento', 'apontamentos')}.`
        : `Banco de horas atualizado em ${formatDate(attendanceDate)} para ${formatCount(selectedDrafts.length, 'técnico', 'técnicos')}.`);
      setIsAttendanceDialogOpen(false);
      setAttendanceDrafts([]);
      setMonthlyAttendanceDrafts([]);
      setAttendanceError('');
      setAttendanceMessage('');
    } catch (error) {
      setAttendanceError(error instanceof Error ? error.message : 'Não foi possível salvar o apontamento.');
    } finally {
      setIsAttendanceSubmitting(false);
    }
  }

  function toggleTechnicianSelection(technicianId: string) {
    setFormData((current) => ({
      ...current,
      technician_ids: toggleStringValue(current.technician_ids, technicianId),
    }));
  }

  function syncDayRulesWithGroup(current: ScheduleBuilderForm, groupId: string, technicianIds: string[]) {
    const availableTechnicianIds = new Set(ruleTechnicians.map((technician) => technician.id));
    const scopedTechnicianIds = technicianIds.filter((technicianId) => availableTechnicianIds.has(technicianId));
    const nextDayRules = { ...current.day_rules };

    dayRuleDefinitions.forEach(({ key }) => {
      if (current.day_rule_group_ids[key] === groupId) {
        nextDayRules[key] = {
          ...nextDayRules[key],
          technician_ids: [...scopedTechnicianIds],
        };
      }
    });

    return nextDayRules;
  }

  function addGroup() {
    setFormData((current) => ({
      ...current,
      groups: [...current.groups, { id: createId(), name: '', technician_ids: [] }],
    }));
  }

  function updateGroupName(groupId: string, value: string) {
    setFormData((current) => ({
      ...current,
      groups: current.groups.map((group) => (group.id === groupId ? { ...group, name: value } : group)),
    }));
  }

  function toggleGroupTechnician(groupId: string, technicianId: string) {
    setFormData((current) => {
      let nextTechnicianIds: string[] = [];
      const nextGroups = current.groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }

        nextTechnicianIds = toggleStringValue(group.technician_ids, technicianId);
        return {
          ...group,
          technician_ids: nextTechnicianIds,
        };
      });

      return {
        ...current,
        groups: nextGroups,
        day_rules: syncDayRulesWithGroup(current, groupId, nextTechnicianIds),
      };
    });
  }

  function removeGroup(groupId: string) {
    setFormData((current) => {
      const nextDayRules = { ...current.day_rules };
      const nextDayRuleGroupIds = { ...current.day_rule_group_ids };

      dayRuleDefinitions.forEach(({ key }) => {
        if (current.day_rule_group_ids[key] === groupId) {
          nextDayRuleGroupIds[key] = '';
          nextDayRules[key] = {
            ...nextDayRules[key],
            technician_ids: [],
          };
        }
      });

      return {
        ...current,
        groups: current.groups.filter((group) => group.id !== groupId),
        day_rule_group_ids: nextDayRuleGroupIds,
        day_rules: nextDayRules,
      };
    });
  }

  function applyGroupToDayRule(ruleKey: ScheduleDayRuleKey, groupId: string) {
    setFormData((current) => {
      const selectedGroup = current.groups.find((group) => group.id === groupId);
      if (!selectedGroup) {
        return current;
      }

      const availableTechnicianIds = new Set(ruleTechnicians.map((technician) => technician.id));
      const scopedTechnicianIds = selectedGroup.technician_ids.filter((technicianId) => availableTechnicianIds.has(technicianId));

      return {
        ...current,
        day_rule_group_ids: {
          ...current.day_rule_group_ids,
          [ruleKey]: groupId,
        },
        day_rules: {
          ...current.day_rules,
          [ruleKey]: {
            ...current.day_rules[ruleKey],
            technician_ids: scopedTechnicianIds,
          },
        },
      };
    });
  }

  function toggleDayRuleTechnician(ruleKey: ScheduleDayRuleKey, technicianId: string) {
    setFormData((current) => ({
      ...current,
      day_rule_group_ids: {
        ...current.day_rule_group_ids,
        [ruleKey]: '',
      },
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          technician_ids: toggleStringValue(current.day_rules[ruleKey].technician_ids, technicianId),
        },
      },
    }));
  }

  function updateDayRuleMode(ruleKey: ScheduleDayRuleKey, mode: WeekendCoverageMode) {
    setFormData((current) => ({
      ...current,
      day_rule_group_ids: {
        ...current.day_rule_group_ids,
        [ruleKey]: mode === 'selected' ? current.day_rule_group_ids[ruleKey] : '',
      },
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          mode,
          technician_ids: mode === 'all' || mode === 'off'
            ? []
            : mode === 'rotation'
              ? current.day_rules[ruleKey].technician_ids.slice(0, 1)
              : current.day_rule_group_ids[ruleKey]
                ? current.day_rules[ruleKey].technician_ids
                : [],
        },
      },
    }));
  }

  function setDayRuleTechnicians(ruleKey: ScheduleDayRuleKey, technicianIds: string[]) {
    setFormData((current) => ({
      ...current,
      day_rule_group_ids: {
        ...current.day_rule_group_ids,
        [ruleKey]: '',
      },
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          technician_ids: technicianIds,
        },
      },
    }));
  }

  function updateDayRuleCadence(ruleKey: ScheduleDayRuleKey, rotationCadence: WeekendRotationCadence) {
    setFormData((current) => ({
      ...current,
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          rotation_cadence: rotationCadence,
        },
      },
    }));
  }

  function updateDayRuleTime(ruleKey: ScheduleDayRuleKey, field: 'start_time' | 'end_time', value: string) {
    setFormData((current) => ({
      ...current,
      day_rules: {
        ...current.day_rules,
        [ruleKey]: {
          ...current.day_rules[ruleKey],
          [field]: value,
          ...(value && field === 'start_time' && !current.day_rules[ruleKey].end_time
            ? { end_time: ruleKey === 'saturday' || ruleKey === 'sunday' ? current.weekend_end_time : current.weekday_end_time }
            : {}),
          ...(value && field === 'end_time' && !current.day_rules[ruleKey].start_time
            ? { start_time: ruleKey === 'saturday' || ruleKey === 'sunday' ? current.weekend_start_time : current.weekday_start_time }
            : {}),
        },
      },
    }));
  }

  function addRotationGroup() {
    setFormData((current) => ({
      ...current,
      rotation_groups: [
        ...current.rotation_groups,
        {
          id: createId(),
          label: '',
          day_keys: [],
          technician_ids: [],
          rotation_cadence: 'weekly',
        },
      ],
    }));
  }

  function toggleRotationGroupDay(groupId: string, dayKey: ScheduleDayRuleKey) {
    setFormData((current) => ({
      ...current,
      rotation_groups: current.rotation_groups.map((group) => (
        group.id === groupId
          ? { ...group, day_keys: toggleDayKeyValue(group.day_keys, dayKey) }
          : group
      )),
    }));
  }

  function toggleRotationGroupTechnician(groupId: string, technicianId: string) {
    setFormData((current) => ({
      ...current,
      rotation_groups: current.rotation_groups.map((group) => (
        group.id === groupId
          ? { ...group, technician_ids: toggleStringValue(group.technician_ids, technicianId) }
          : group
      )),
    }));
  }

  function removeRotationGroup(groupId: string) {
    setFormData((current) => ({
      ...current,
      rotation_groups: current.rotation_groups.filter((group) => group.id !== groupId),
    }));
  }

  function addRecurringRule() {
    setFormData((current) => ({
      ...current,
      recurring_rules: [
        ...current.recurring_rules,
        {
          id: createId(),
          technician_id: selectedTechnicianIds[0] || '',
          day_keys: ['monday'],
          status: 'cancelled',
          start_time: current.weekday_start_time,
          end_time: current.weekday_end_time,
          notes: '',
        },
      ],
    }));
  }

  function updateRecurringRule(ruleId: string, field: 'technician_id' | 'status' | 'start_time' | 'end_time' | 'notes', value: string) {
    setFormData((current) => ({
      ...current,
      recurring_rules: current.recurring_rules.map((rule) => (rule.id === ruleId ? { ...rule, [field]: value } : rule)),
    }));
  }

  function toggleRecurringRuleDay(ruleId: string, dayKey: ScheduleDayRuleKey) {
    setFormData((current) => ({
      ...current,
      recurring_rules: current.recurring_rules.map((rule) => (
        rule.id === ruleId
          ? { ...rule, day_keys: toggleDayKeyValue(rule.day_keys, dayKey) }
          : rule
      )),
    }));
  }

  function removeRecurringRule(ruleId: string) {
    setFormData((current) => ({
      ...current,
      recurring_rules: current.recurring_rules.filter((rule) => rule.id !== ruleId),
    }));
  }

  function addGeneralDayOff() {
    setFormData((current) => ({
      ...current,
      general_days_off: [...current.general_days_off, { id: createId(), date: generationPreview.startDate, notes: '' }],
    }));
  }

  function updateGeneralDayOff(dayOffId: string, field: 'date' | 'notes', value: string) {
    setFormData((current) => ({
      ...current,
      general_days_off: current.general_days_off.map((item) => (item.id === dayOffId ? { ...item, [field]: value } : item)),
    }));
  }

  function removeGeneralDayOff(dayOffId: string) {
    setFormData((current) => ({
      ...current,
      general_days_off: current.general_days_off.filter((item) => item.id !== dayOffId),
    }));
  }

  function addOverride() {
    setFormData((current) => ({
      ...current,
      overrides: [
        ...current.overrides,
        {
          id: createId(),
          technician_id: selectedTechnicianIds[0] || '',
          date: generationPreview.startDate,
          status: 'cancelled',
          start_time: current.weekday_start_time,
          end_time: current.weekday_end_time,
          notes: '',
        },
      ],
    }));
  }

  function updateOverride(overrideId: string, field: keyof OverrideDraft, value: string) {
    setFormData((current) => ({
      ...current,
      overrides: current.overrides.map((item) => (item.id === overrideId ? { ...item, [field]: value } : item)),
    }));
  }

  function removeOverride(overrideId: string) {
    setFormData((current) => ({
      ...current,
      overrides: current.overrides.filter((item) => item.id !== overrideId),
    }));
  }

  function validateForm() {
    if (!selectedTechnicianIds.length) {
      return 'Selecione ao menos um técnico para montar a escala.';
    }

    if ((formData.period_mode === 'day' || formData.period_mode === 'week') && !/^\d{4}-\d{2}-\d{2}$/.test(formData.date)) {
      return 'Selecione a data de referência do período.';
    }

    if (formData.weekday_start_time >= formData.weekday_end_time) {
      return 'O horário padrão dos dias úteis está inválido.';
    }

    if (formData.weekend_start_time >= formData.weekend_end_time) {
      return 'O horário padrão do fim de semana está inválido.';
    }

    for (const group of formData.groups) {
      if (!group.name.trim()) {
        return 'Cada grupo precisa de um nome.';
      }

      if (!group.technician_ids.length) {
        return `O grupo ${group.name.trim() || 'sem nome'} precisa de ao menos um técnico.`;
      }
    }

    for (const { key, dayLabel } of dayRuleDefinitions) {
      const rule = formData.day_rules[key];

      if ((rule.start_time && !rule.end_time) || (!rule.start_time && rule.end_time)) {
        return `Preencha entrada e saída de ${dayLabel} ou deixe os dois campos em branco.`;
      }

      if (rule.start_time && rule.end_time && rule.start_time >= rule.end_time) {
        return `O horário configurado para ${dayLabel} está inválido.`;
      }

      if (rule.mode === 'selected' && !formData.day_rule_group_ids[key]) {
        return `Selecione um grupo para ${dayLabel}.`;
      }

      if (rule.mode === 'selected' && !rule.technician_ids.length) {
        return `O grupo escolhido para ${dayLabel} não tem técnicos dentro do escopo atual.`;
      }
    }

    for (const group of formData.rotation_groups) {
      if (!group.day_keys.length) {
        return 'Cada regra de revezamento precisa de ao menos um dia selecionado.';
      }

      const availableRotationTechnicianIds = ruleTechnicians.map((technician) => technician.id);
      const { firstTeam, nextTeam } = getRotationTeams(group.technician_ids, availableRotationTechnicianIds);

      if (!firstTeam.length) {
        return 'Marque ao menos um técnico para trabalhar na primeira ocorrência do revezamento.';
      }

      if (!nextTeam.length) {
        return 'Deixe ao menos um técnico desmarcado para trabalhar na próxima ocorrência do revezamento.';
      }
    }

    for (const recurringRule of formData.recurring_rules) {
      if (!recurringRule.technician_id) {
        return 'Cada regra recorrente precisa de um técnico selecionado.';
      }

      if (!recurringRule.day_keys.length) {
        return 'Cada regra recorrente precisa de ao menos um dia selecionado.';
      }

      if (recurringRule.status !== 'cancelled') {
        if (!recurringRule.start_time || !recurringRule.end_time) {
          return 'Turnos recorrentes precisam de horário de entrada e saída.';
        }

        if (recurringRule.start_time >= recurringRule.end_time) {
          return 'Os horários das regras recorrentes precisam ter entrada antes da saída.';
        }
      }
    }

    for (const override of formData.overrides) {
      if (!override.technician_id) {
        return 'Toda exceção individual precisa ter um técnico selecionado.';
      }

      if ((override.status === 'scheduled' || override.status === 'completed') && override.start_time >= override.end_time) {
        return 'Os horários das exceções individuais precisam ter entrada antes da saída.';
      }
    }

    return '';
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');
    setSaveMessage('');

    const validationError = validateForm();
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setIsSubmitting(true);

    const payload = buildSchedulePayload();

    try {
      const response = await fetch('/api/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível salvar a escala.');
      }

      const refreshed = await fetchSchedulePageData();
      setSchedule(refreshed.schedule);
      setTechnicians(refreshed.technicians);
      setWorkHours(refreshed.workHours);
      setDataError(refreshed.error);
      setSaveMessage(data?.summary ? buildSuccessMessage(data.summary) : 'Escala salva com sucesso.');
      handleFormDialogChange(false);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível salvar a escala.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function buildScheduleExportRows() {
    return hourBankDetailRows.map((row) => ({
      Data: formatDate(row.date),
      Tecnico: row.technician_name,
      Situacao: row.status_label,
      Entrada_prevista: formatTime(row.planned_start_time),
      Saida_prevista: formatTime(row.planned_end_time),
      Entrada_real: row.actual_start_time ? formatTime(row.actual_start_time) : '-',
      Saida_real: row.actual_end_time ? formatTime(row.actual_end_time) : '-',
      Horas_previstas: row.planned_hours,
      Horas_realizadas: row.worked_hours,
      Saldo: row.balance,
      Observação: row.observation,
    }));
  }

  function handleExportHourBankDetail(scope: 'period' | 'all') {
    const sourceRows = scope === 'all'
      ? buildHourBankDetailRows(visibleSchedule, visibleWorkHours, technicianNameById)
      : hourBankDetailRowsFiltered;
    const filteredRows = scope === 'all' && hourBankDetailTechnicianId !== 'all'
      ? sourceRows.filter((row) => row.technician_id === hourBankDetailTechnicianId)
      : sourceRows;

    if (!filteredRows.length) {
      setSaveMessage('Nenhuma linha para exportar no filtro selecionado.');
      return;
    }

    const technicianLabel = hourBankDetailTechnicianId === 'all'
      ? 'todos-tecnicos'
      : slugify(sortedTechnicians.find((technician) => technician.id === hourBankDetailTechnicianId)?.name ?? 'tecnico');
    const periodLabel = scope === 'all' ? 'todos-periodos' : `${hourBankRange.startDate}_a_${hourBankRange.endDate}`;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(buildHourBankExportRows(filteredRows)), 'Banco de horas');
    XLSX.writeFile(workbook, `banco-horas-detalhado_${periodLabel}_${technicianLabel}.xlsx`);
    setSaveMessage(`Planilha exportada com ${formatCount(filteredRows.length, 'linha', 'linhas')}.`);
  }

  function handleExportSpreadsheet() {
    const bankRows = hourBankRows.map((row) => ({
      Tecnico: row.technician_name,
      Previsto: row.planned_hours,
      Realizado: row.worked_hours,
      Saldo: row.balance,
      Dias_trabalhados: row.worked_days,
      Folgas: row.day_off_days,
      Faltas: row.missed_days,
      Justificativas: row.justified_days,
      Pendentes: row.pending_days,
    }));
    const scheduleRows = buildScheduleExportRows();
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bankRows), 'Banco de horas');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(scheduleRows), 'Escala');
    XLSX.writeFile(workbook, `escala-banco-horas-${hourBankRange.startDate}-${hourBankRange.endDate}.xlsx`);
    setSaveMessage(`Planilha de ${hourBankPeriodLabel} gerada com ${formatCount(scheduleRows.length, 'linha', 'linhas')}.`);
  }

  function handleDownloadAttendanceImportTemplate() {
    const headers = ['Data', 'Funcionário', 'Hora Início', 'Hora Final', 'Horas Trabalhadas', 'Semana do Ano', 'Mês', 'Ano', 'Dia da semana'];
    const blankRows = Array.from({ length: 100 }, () => ['', '', '', '', '', '', '', '', '']);
    const templateSheet = XLSX.utils.aoa_to_sheet([headers, ...blankRows]);
    templateSheet['!cols'] = [
      { wch: 14 },
      { wch: 34 },
      { wch: 14 },
      { wch: 14 },
      { wch: 18 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 16 },
    ];

    const firstTechnicianName = sortedTechnicians[0]?.name || 'NOME DO TECNICO';
    const secondTechnicianName = sortedTechnicians[1]?.name || 'OUTRO TECNICO';
    const exampleSheet = XLSX.utils.aoa_to_sheet([
      headers,
      ['01/04/2026', firstTechnicianName, '08:00', '17:38', '9,65', 14, 4, 2026, 4],
      ['01/04/2026', secondTechnicianName, '08:01', '17:10', '9,16', 14, 4, 2026, 4],
    ]);
    exampleSheet['!cols'] = templateSheet['!cols'];

    const techniciansSheet = XLSX.utils.aoa_to_sheet([
      ['Técnicos ativos cadastrados'],
      ...sortedTechnicians.map((technician) => [technician.name]),
    ]);
    techniciansSheet['!cols'] = [{ wch: 42 }];

    const instructionsSheet = XLSX.utils.aoa_to_sheet([
      ['Como usar'],
      ['1. Preencha a aba Banco de Dados.'],
      ['2. Use uma linha para cada técnico em cada dia trabalhado.'],
      ['3. O nome do funcionário deve bater com um técnico ativo. Consulte a aba Técnicos ativos.'],
      ['4. Use Data no formato dd/mm/aaaa e horários no formato HH:mm.'],
      ['5. Horas Trabalhadas pode ser preenchida em decimal, como 9,65. Se ficar vazia, o sistema calcula pela entrada e saída.'],
      ['6. Depois salve a planilha e suba em Subir horas por planilha.'],
    ]);
    instructionsSheet['!cols'] = [{ wch: 92 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, templateSheet, 'Banco de Dados');
    XLSX.utils.book_append_sheet(workbook, exampleSheet, 'Exemplo');
    XLSX.utils.book_append_sheet(workbook, techniciansSheet, 'Técnicos ativos');
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instruções');
    XLSX.writeFile(workbook, 'modelo-importacao-horas.xlsx');
    setSaveMessage('Modelo XLSX de importacao de horas baixado.');
  }

  function handleDownloadAttendanceImportErrors() {
    if (!attendanceImportErrors.length) {
      setAttendanceMessage('Não há erros de importação para baixar.');
      return;
    }

    const rows = attendanceImportErrors.map((item) => ({
      Aba: item.sheet_name || '-',
      Linha: item.row_number || '-',
      Motivo: item.message,
      Detalhes: item.details.join(' | '),
      Sugestao: item.suggestion,
      Data: item.values.date,
      Funcionário: item.values.employee,
      Hora_Inicio: item.values.start_time,
      Hora_Final: item.values.end_time,
      Horas_Trabalhadas: item.values.hours_worked,
      Semana_do_Ano: item.values.week_number,
      Mes: item.values.month,
      Ano: item.values.year,
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet['!cols'] = [
      { wch: 18 },
      { wch: 10 },
      { wch: 48 },
      { wch: 100 },
      { wch: 72 },
      { wch: 18 },
      { wch: 36 },
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Erros');
    XLSX.writeFile(workbook, 'erros-importacao-horas.xlsx');
    setAttendanceMessage('Planilha de erros baixada.');
  }

  function handleExportPdf() {
    if (typeof window === 'undefined') return;

    const scheduleRows = buildScheduleExportRows();
    const printWindow = window.open('', '_blank', 'width=1100,height=900');

    if (!printWindow) {
      setSaveMessage('Não foi possível abrir a janela de PDF. Verifique o bloqueador de pop-ups.');
      return;
    }

    const bankRowsHtml = hourBankRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.technician_name)}</td>
        <td>${escapeHtml(formatHours(row.planned_hours))}</td>
        <td>${escapeHtml(formatHours(row.worked_hours))}</td>
        <td>${escapeHtml(formatHours(row.balance))}</td>
        <td>${escapeHtml(row.worked_days)}</td>
        <td>${escapeHtml(row.day_off_days)}</td>
        <td>${escapeHtml(row.missed_days)}</td>
        <td>${escapeHtml(row.pending_days)}</td>
      </tr>
    `).join('');
    const scheduleRowsHtml = scheduleRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.Data)}</td>
        <td>${escapeHtml(row.Tecnico)}</td>
        <td>${escapeHtml(row.Situacao)}</td>
          <td>${escapeHtml(row.Entrada_prevista)}</td>
          <td>${escapeHtml(row.Saida_prevista)}</td>
          <td>${escapeHtml(row.Entrada_real)}</td>
          <td>${escapeHtml(row.Saida_real)}</td>
          <td>${escapeHtml(formatHours(row.Horas_previstas))}</td>
          <td>${escapeHtml(formatHours(row.Horas_realizadas))}</td>
        <td>${escapeHtml(formatHours(row.Saldo))}</td>
        <td>${escapeHtml(row.Observação)}</td>
      </tr>
    `).join('');
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Escala e banco de horas - ${escapeHtml(hourBankPeriodLabel)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
            h1 { margin: 0 0 6px; font-size: 22px; }
            h2 { margin: 24px 0 10px; font-size: 16px; }
            .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; }
            .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; }
            .label { color: #64748b; font-size: 11px; text-transform: uppercase; }
            .value { margin-top: 4px; font-size: 18px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px; text-align: left; vertical-align: top; }
            th { background: #f1f5f9; color: #475569; text-transform: uppercase; font-size: 10px; }
            @media print { body { margin: 14mm; } .no-print { display: none; } }
          </style>
        </head>
        <body>
          <h1>Escala e banco de horas</h1>
          <div>${escapeHtml(hourBankPeriodLabel)}</div>
          <div class="summary">
            <div class="card"><div class="label">Previsto</div><div class="value">${escapeHtml(formatHours(hourBankTotals.planned))}</div></div>
            <div class="card"><div class="label">Realizado</div><div class="value">${escapeHtml(formatHours(hourBankTotals.worked))}</div></div>
            <div class="card"><div class="label">Saldo</div><div class="value">${escapeHtml(formatHours(hourBankTotals.balance))}</div></div>
            <div class="card"><div class="label">Pendencias</div><div class="value">${escapeHtml(hourBankTotals.pending)}</div></div>
          </div>
          <h2>Banco de horas por técnico</h2>
          <table>
            <thead><tr><th>Tecnico</th><th>Previsto</th><th>Realizado</th><th>Saldo</th><th>Dias</th><th>Folgas</th><th>Faltas</th><th>Pendentes</th></tr></thead>
            <tbody>${bankRowsHtml || '<tr><td colspan="8">Sem dados no periodo.</td></tr>'}</tbody>
          </table>
          <h2>Escala e apontamentos</h2>
          <table>
            <thead><tr><th>Data</th><th>Tecnico</th><th>Situacao</th><th>Entrada prev.</th><th>Saida prev.</th><th>Entrada real</th><th>Saida real</th><th>Horas prev.</th><th>Horas real.</th><th>Saldo</th><th>Obs.</th></tr></thead>
            <tbody>${scheduleRowsHtml || '<tr><td colspan="11">Sem dados no periodo.</td></tr>'}</tbody>
          </table>
          <script>
            window.onload = () => {
              window.focus();
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }

  function getCalendarDayScheduled(day: number) {
    const dateKey = createDateKey(calendarYear, calendarMonth, day);
    const dayEntries = scheduleByDate.get(dateKey) ?? [];
    const entriesByTechnician = new Map<string, Schedule[]>();

    dayEntries.forEach((entry) => {
      entriesByTechnician.set(entry.technician_id, [...(entriesByTechnician.get(entry.technician_id) ?? []), entry]);
    });

    return Array.from(entriesByTechnician.entries()).reduce(
      (scheduled, [technicianId, entries]) => {
        const entry = getBestScheduleEntry(entries);

        const manualStatus = parseManualAttendanceNote(entry?.notes).attendance_status;

        if (!entry || (entry.status === 'cancelled' && !manualStatus)) {
          return scheduled;
        }

        scheduled.push({
          name: entry.technician_name || technicianNameById.get(technicianId) || technicianId,
          entry,
        });
        return scheduled;
      },
      [] as Array<{ name: string; entry: Schedule }>,
    ).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }

  if (loading || isDataLoading || !user) {
    return <LoadingShell role="admin" />;
  }

  const todayKey = createDateInputValue(new Date());
  const todayEntries = scheduleByDate.get(todayKey) ?? [];
  const workingToday = sortedTechnicians.filter((technician) => {
    const entry = getBestScheduleEntry(todayEntries.filter((item) => item.technician_id === technician.id));
    return entry && entry.status !== 'cancelled';
  }).length;
  const dayOffToday = sortedTechnicians.filter((technician) => {
    const entry = getBestScheduleEntry(todayEntries.filter((item) => item.technician_id === technician.id));
    return entry?.status === 'cancelled';
  }).length;
  const coveredTechnicians = new Set(visibleSchedule.map((item) => item.technician_id)).size;
  const range = getScheduleRange(formData.period_mode, formData.year, formData.month, formData.date);
  const scopeSummary = formData.technician_scope === 'all'
    ? 'Todos os técnicos ativos'
    : formatCount(selectedTechnicianIds.length, 'técnico selecionado', 'técnicos selecionados');
  const optionalAdjustmentsCount = formData.recurring_rules.length + formData.rotation_groups.length + formData.general_days_off.length + formData.overrides.length;
  const activeDayDefinition = activeDayRuleKey ? getDayDefinition(activeDayRuleKey) : undefined;
  const activeDayRule = activeDayRuleKey ? formData.day_rules[activeDayRuleKey] : undefined;
  const activeDayGroupId = activeDayRuleKey ? formData.day_rule_group_ids[activeDayRuleKey] : '';
  const activeDayGroup = activeDayGroupId ? formData.groups.find((group) => group.id === activeDayGroupId) : undefined;
  const selectedAttendanceDrafts = attendanceDrafts.filter(isAttendanceSelected);
  const attendancePlannedTotal = selectedAttendanceDrafts.reduce((total, draft) => total + draft.planned_hours, 0);
  const attendanceWorkedTotal = selectedAttendanceDrafts.reduce((total, draft) => total + getAttendanceWorkedHours(draft), 0);
  const attendanceBalance = selectedAttendanceDrafts.reduce((total, draft) => total + getAttendanceBalance(draft), 0);
  const selectedMonthlyAttendanceDrafts = monthlyAttendanceDrafts.filter(isAttendanceSelected);
  const monthlyAttendancePlannedTotal = selectedMonthlyAttendanceDrafts.reduce((total, draft) => total + draft.planned_hours, 0);
  const monthlyAttendanceWorkedTotal = selectedMonthlyAttendanceDrafts.reduce((total, draft) => total + getAttendanceWorkedHours(draft), 0);
  const monthlyAttendanceBalance = selectedMonthlyAttendanceDrafts.reduce((total, draft) => total + getAttendanceBalance(draft), 0);
  const monthlyAttendanceDays = new Set(selectedMonthlyAttendanceDrafts.map((draft) => draft.date)).size;
  const attendanceImportWorkedTotal = attendanceImportRows.reduce((total, row) => total + row.hours_worked, 0);
  const attendanceImportTechnicianCount = new Set(attendanceImportRows.map((row) => row.technician_id)).size;
  const attendanceImportFirstDate = attendanceImportRows[0]?.date ?? '';
  const attendanceImportLastDate = attendanceImportRows[attendanceImportRows.length - 1]?.date ?? '';
  const attendanceImportPeriodLabel = attendanceImportFirstDate
    ? attendanceImportFirstDate === attendanceImportLastDate
      ? formatDate(attendanceImportFirstDate)
      : `${formatDate(attendanceImportFirstDate)} a ${formatDate(attendanceImportLastDate)}`
    : 'Sem periodo';
  const visibleAttendanceImportErrors = showAllAttendanceImportErrors ? attendanceImportErrors : attendanceImportErrors.slice(0, 8);
  const hiddenAttendanceImportErrorCount = Math.max(0, attendanceImportErrors.length - visibleAttendanceImportErrors.length);

  function renderBuilderDialogContent() {
    if (builderDialog === 'scope') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Escopo da escala</DialogTitle>
            <DialogDescription>Escolha quem entra nesta geração.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              <label className="text-sm md:max-w-sm">
                <span className="mb-1.5 block font-medium">Aplicar em</span>
                <select value={formData.technician_scope} onChange={(event) => setFormData((current) => ({ ...current, technician_scope: event.target.value as 'all' | 'selected' }))} className={inputClassName}>
                  <option value="all">Todos os técnicos ativos</option>
                  <option value="selected">Apenas técnicos selecionados</option>
                </select>
              </label>

              {formData.technician_scope === 'selected' ? (
                <TechnicianChecklist technicians={sortedTechnicians} value={formData.technician_ids} onToggle={toggleTechnicianSelection} emptyLabel="Não há técnicos ativos reais para selecionar." />
              ) : (
                <p className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">Todos os técnicos ativos serão incluídos.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'groups') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Grupos</DialogTitle>
            <DialogDescription>Crie grupos para usar na cobertura com equipe selecionada.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addGroup}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.groups.length ? (
                formData.groups.map((group, index) => (
                  <div key={group.id} className="rounded-lg border border-border/70 bg-background p-4">
                    <div className="mb-3 flex items-end justify-between gap-3">
                      <label className="min-w-0 flex-1 text-sm">
                        <span className="mb-1.5 block font-medium">Nome do grupo</span>
                        <input value={group.name} onChange={(event) => updateGroupName(group.id, event.target.value)} placeholder={`Ex.: Grupo ${index + 1}`} className={inputClassName} />
                      </label>

                      <Button type="button" variant="outline" onClick={() => removeGroup(group.id)}>
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>

                    <div>
                      <p className="mb-1.5 text-sm font-medium text-foreground">Quem participa</p>
                      <TechnicianChecklist technicians={ruleTechnicians} value={group.technician_ids} onToggle={(technicianId) => toggleGroupTechnician(group.id, technicianId)} emptyLabel="Selecione primeiro o escopo da escala para montar o grupo." />
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum grupo criado.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'recurring') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Recorrências</DialogTitle>
            <DialogDescription>Regras fixas por técnico e dia da semana.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addRecurringRule}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.recurring_rules.length ? (
                formData.recurring_rules.map((rule) => (
                  <div key={rule.id} className="rounded-lg border border-border/70 bg-background p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{sortedTechnicians.find((technician) => technician.id === rule.technician_id)?.name || 'Regra recorrente'}</p>
                        <p className="text-xs text-muted-foreground">{formatDayKeyList(rule.day_keys)}</p>
                      </div>
                      <StatusBadge tone={getStatusTone(rule.status)}>{getStatusLabel(rule.status)}</StatusBadge>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-sm xl:col-span-2">
                        <span className="mb-1.5 block font-medium">Técnico</span>
                        <select value={rule.technician_id} onChange={(event) => updateRecurringRule(rule.id, 'technician_id', event.target.value)} className={inputClassName}>
                          <option value="">Selecione</option>
                          {sortedTechnicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>{technician.name}</option>
                          ))}
                        </select>
                      </label>

                      <div className="flex items-end xl:justify-end">
                        <Button type="button" variant="outline" onClick={() => removeRecurringRule(rule.id)}>
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Tipo</span>
                        <select value={rule.status} onChange={(event) => updateRecurringRule(rule.id, 'status', event.target.value)} className={inputClassName}>
                          <option value="cancelled">Folga recorrente</option>
                          <option value="scheduled">Turno recorrente</option>
                          <option value="completed">Turno recorrente concluído</option>
                        </select>
                      </label>

                      {rule.status !== 'cancelled' ? (
                        <>
                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Entrada</span>
                            <input type="time" value={rule.start_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'start_time', event.target.value)} className={inputClassName} />
                          </label>

                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Saída</span>
                            <input type="time" value={rule.end_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'end_time', event.target.value)} className={inputClassName} />
                          </label>
                        </>
                      ) : null}

                      <label className="text-sm md:col-span-2 xl:col-span-3">
                        <span className="mb-1.5 block font-medium">Observação</span>
                        <input value={rule.notes || ''} onChange={(event) => updateRecurringRule(rule.id, 'notes', event.target.value)} placeholder="Ex.: folga fixa, plantão de fechamento" className={inputClassName} />
                      </label>

                      <div className="md:col-span-2 xl:col-span-3">
                        <p className="mb-1.5 text-sm font-medium text-foreground">Dias da semana</p>
                        <DayKeyChecklist value={rule.day_keys} onToggle={(dayKey) => toggleRecurringRuleDay(rule.id, dayKey)} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma regra fixa adicionada.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'rotation') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Revezamentos</DialogTitle>
            <DialogDescription>Selecione os dias e os técnicos do revezamento.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addRotationGroup}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.rotation_groups.length ? (
                formData.rotation_groups.map((group, index) => {
                  const previewRows = getRotationPreviewRows(group);
                  const availableTechnicians = ruleTechnicians.filter((technician) => selectedTechnicianIds.includes(technician.id));
                  const { firstTeam, nextTeam } = getRotationTeams(group.technician_ids, availableTechnicians.map((technician) => technician.id));
                  const firstTeamTechnicians = firstTeam
                    .map((technicianId) => availableTechnicians.find((technician) => technician.id === technicianId))
                    .filter((technician): technician is Technician => Boolean(technician));
                  const nextTeamTechnicians = nextTeam
                    .map((technicianId) => availableTechnicians.find((technician) => technician.id === technicianId))
                    .filter((technician): technician is Technician => Boolean(technician));

                  return (
                    <div key={group.id} className="rounded-lg border border-border/70 bg-background p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">Revezamento {index + 1}</p>
                        <Button type="button" variant="outline" onClick={() => removeRotationGroup(group.id)}>
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      <div className="grid gap-4">
                        <div>
                          <p className="mb-1.5 text-sm font-medium text-foreground">Dias</p>
                          <DayKeyChecklist value={group.day_keys} onToggle={(dayKey) => toggleRotationGroupDay(group.id, dayKey)} />
                        </div>

                        <div>
                          <p className="mb-1.5 text-sm font-medium text-foreground">Técnicos do revezamento</p>
                          <p className="mb-2 text-xs text-muted-foreground">Marque quem trabalha na primeira ocorrência. Na próxima, entram os que ficaram desmarcados.</p>
                          {firstTeamTechnicians.length ? (
                            <div className="mb-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground">Primeira ocorrência:</span>
                                {firstTeamTechnicians.map((technician) => (
                                  <StatusBadge key={technician.id} tone="success">{technician.name}</StatusBadge>
                                ))}
                              </div>
                              {nextTeamTechnicians.length ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-medium text-muted-foreground">Próxima ocorrência:</span>
                                  {nextTeamTechnicians.map((technician) => (
                                    <StatusBadge key={technician.id} tone="neutral">{technician.name}</StatusBadge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <TechnicianChecklist technicians={ruleTechnicians} value={group.technician_ids} onToggle={(technicianId) => toggleRotationGroupTechnician(group.id, technicianId)} emptyLabel="Selecione primeiro o escopo da escala para configurar o revezamento." />
                        </div>

                        <div className="rounded-lg border border-border/70 bg-card/60">
                          <div className="border-b border-border/70 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Próximas ocorrências</p>
                          </div>

                          {previewRows.length ? (
                            <div className="space-y-2 p-3">
                              {previewRows.map((row) => (
                                <div key={`${group.id}-${row.date}`} className="rounded-md border border-border/70 bg-background px-3 py-2">
                                  <p className="text-sm font-medium text-foreground">{formatDate(row.date)} • {row.dayLabel}</p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {row.workerNames.map((workerName) => (
                                      <StatusBadge key={`${row.date}-${workerName}`} tone="success">{workerName}</StatusBadge>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {previewRows.length ? null : (
                            <p className="px-3 py-4 text-sm text-muted-foreground">
                              Marque ao menos 1 técnico, deixe ao menos 1 desmarcado e escolha 1 dia para ver o revezamento.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  Nenhum revezamento criado.
                </p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'general-days-off') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Folga geral</DialogTitle>
            <DialogDescription>Datas sem expediente para todo o escopo.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addGeneralDayOff}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.general_days_off.length ? (
                formData.general_days_off.map((item) => (
                  <div key={item.id} className="grid gap-3 rounded-lg border border-border/70 bg-background p-4 md:grid-cols-[0.9fr_1.3fr_auto]">
                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Data</span>
                      <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateGeneralDayOff(item.id, 'date', event.target.value)} className={inputClassName} />
                    </label>

                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Observação</span>
                      <input value={item.notes} onChange={(event) => updateGeneralDayOff(item.id, 'notes', event.target.value)} placeholder="Ex.: feriado, recesso" className={inputClassName} />
                    </label>

                    <div className="flex items-end">
                      <Button type="button" variant="outline" onClick={() => removeGeneralDayOff(item.id)}>
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma folga geral adicional.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    if (builderDialog === 'overrides') {
      return (
        <div className="flex max-h-[88vh] min-h-0 flex-col">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle>Ajustes individuais</DialogTitle>
            <DialogDescription>Folgas ou turnos pontuais por técnico.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex justify-end">
              <Button type="button" variant="outline" onClick={addOverride}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>

            <div className="space-y-3">
              {formData.overrides.length ? (
                formData.overrides.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border/70 bg-background p-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="text-sm xl:col-span-3">
                        <span className="mb-1.5 block font-medium">Técnico</span>
                        <select value={item.technician_id} onChange={(event) => updateOverride(item.id, 'technician_id', event.target.value)} className={inputClassName}>
                          <option value="">Selecione</option>
                          {sortedTechnicians.map((technician) => (
                            <option key={technician.id} value={technician.id}>{technician.name}</option>
                          ))}
                        </select>
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Data</span>
                        <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateOverride(item.id, 'date', event.target.value)} className={inputClassName} />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Tipo</span>
                        <select value={item.status} onChange={(event) => updateOverride(item.id, 'status', event.target.value)} className={inputClassName}>
                          <option value="cancelled">Folga individual</option>
                          <option value="scheduled">Turno individual</option>
                          <option value="completed">Turno concluído</option>
                        </select>
                      </label>

                      <div className="flex items-end xl:justify-end">
                        <Button type="button" variant="outline" onClick={() => removeOverride(item.id)}>
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      {item.status !== 'cancelled' ? (
                        <>
                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Entrada</span>
                            <input type="time" value={item.start_time} onChange={(event) => updateOverride(item.id, 'start_time', event.target.value)} className={inputClassName} />
                          </label>

                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Saída</span>
                            <input type="time" value={item.end_time} onChange={(event) => updateOverride(item.id, 'end_time', event.target.value)} className={inputClassName} />
                          </label>
                        </>
                      ) : null}

                      <label className="text-sm md:col-span-2 xl:col-span-3">
                        <span className="mb-1.5 block font-medium">Observação</span>
                        <input value={item.notes} onChange={(event) => updateOverride(item.id, 'notes', event.target.value)} placeholder="Ex.: plantão especial, folga compensatória" className={inputClassName} />
                      </label>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum ajuste individual.</p>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border/70 px-5 py-4">
            <Button type="button" onClick={() => setBuilderDialog(null)}>Concluir</Button>
          </DialogFooter>
        </div>
      );
    }

    return null;
  }

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Planejamento"
        title="Montagem da escala"
        description="Monte a escala diária, semanal, mensal ou anual com regras por dia, horários específicos, revezamentos, recorrências fixas, folgas gerais e ajustes individuais por técnico."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => handleAttendanceDialogChange(true)}>
            <Clock3 className="h-4 w-4" />
            Apontar horas
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                <Upload className="h-4 w-4" />
                Importar horas
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={openAttendanceImportDialog}>
                <Upload className="h-4 w-4" />
                Subir horas por planilha
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleDownloadAttendanceImportTemplate}>
                <Download className="h-4 w-4" />
                Baixar modelo XLSX
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline">
                <Download className="h-4 w-4" />
                Exportar
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleExportSpreadsheet}>
                <Download className="h-4 w-4" />
                Planilha
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportPdf}>
                <FileText className="h-4 w-4" />
                PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button type="button" onClick={() => setIsFormDialogOpen(true)}>
            <WandSparkles className="h-4 w-4" />
            Montar escala
          </Button>

          <PortoRunWizard />
        </div>
      </PageHeader>

      {dataError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{dataError}</div> : null}
      {saveMessage ? <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{saveMessage}</div> : null}

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard title="Trabalham hoje" value={workingToday} hint="Com escala real salva para hoje" icon={CalendarDays} />
        <MetricCard title="Folgas hoje" value={dayOffToday} hint="Cancelamentos reais para hoje" icon={CalendarDays} tone="warning" />
        <MetricCard title="Linhas salvas" value={visibleSchedule.length} hint="Linhas da escala gravadas" icon={Clock3} tone="success" />
        <MetricCard title="Técnicos cobertos" value={coveredTechnicians} hint="Com escala gravada em algum período" icon={Users} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Banco de horas"
          description={`Previsto, realizado e saldo em ${hourBankPeriodLabel}.`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-11 items-center rounded-md border border-border bg-background p-1">
                {hourBankPeriodOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setHourBankPeriodMode(option.value)}
                    className={`h-8 rounded px-3 text-sm font-medium transition ${hourBankPeriodMode === option.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="hidden">
                <span className="mb-1 block">Filtro</span>
                <select value={hourBankPeriodMode} onChange={(event) => setHourBankPeriodMode(event.target.value as HourBankPeriodMode)} className="min-h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none">
                  <option value="day">Diário</option>
                  <option value="week">Semanal</option>
                  <option value="month">Mensal</option>
                </select>
              </label>

              {hourBankPeriodMode === 'month' ? (
                <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                  <span className="sr-only">Mês</span>
                  <input type="month" value={hourBankMonth} onChange={(event) => setHourBankMonth(event.target.value)} className="h-9 bg-transparent text-sm text-foreground outline-none" />
                </label>
              ) : hourBankPeriodMode === 'year' ? (
                <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                  <span className="sr-only">Ano</span>
                  <input type="number" value={hourBankYear} onChange={(event) => setHourBankYear(Number(event.target.value) || new Date().getFullYear())} className="h-9 w-20 bg-transparent text-sm text-foreground outline-none" />
                </label>
              ) : (
                <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                  <span className="sr-only">{hourBankPeriodMode === 'day' ? 'Data' : 'Semana de referência'}</span>
                  <input type="date" value={hourBankDate} onChange={(event) => setHourBankDate(event.target.value)} className="h-9 bg-transparent text-sm text-foreground outline-none" />
                </label>
              )}
            </div>
          }
        >
          <div className="hidden">
            <span className="rounded-md bg-secondary px-3 py-2">Período: {formatDate(hourBankRange.startDate)} a {formatDate(hourBankRange.endDate)}</span>
            <span className="rounded-md bg-secondary px-3 py-2">Previsto: {formatHours(hourBankTotals.planned)}</span>
            <span className="rounded-md bg-secondary px-3 py-2">Realizado: {formatHours(hourBankTotals.worked)}</span>
            <span className="rounded-md bg-secondary px-3 py-2">Saldo: {formatHours(hourBankTotals.balance)}</span>
            <span className="rounded-md bg-secondary px-3 py-2">Pendentes: {hourBankTotals.pending}</span>
          </div>

          <div className="grid overflow-hidden rounded-md border border-border md:grid-cols-5">
            <div className="border-b border-border bg-secondary/30 px-3 py-3 md:border-b-0 md:border-r">
              <p className="text-xs font-medium uppercase text-muted-foreground">Período</p>
              <p className="mt-1 text-sm font-semibold text-foreground">{formatDate(hourBankRange.startDate)} a {formatDate(hourBankRange.endDate)}</p>
            </div>
            <div className="border-b border-border px-3 py-3 md:border-b-0 md:border-r">
              <p className="text-xs font-medium uppercase text-muted-foreground">Previsto</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatHours(hourBankTotals.planned)}</p>
            </div>
            <div className="border-b border-border px-3 py-3 md:border-b-0 md:border-r">
              <p className="text-xs font-medium uppercase text-muted-foreground">Realizado</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatHours(hourBankTotals.worked)}</p>
            </div>
            <div className="border-b border-border px-3 py-3 md:border-b-0 md:border-r">
              <p className="text-xs font-medium uppercase text-muted-foreground">Saldo</p>
              <p className={`mt-1 text-lg font-semibold tabular-nums ${hourBankTotals.balance < 0 ? 'text-rose-700' : hourBankTotals.balance > 0 ? 'text-emerald-700' : 'text-foreground'}`}>{formatHours(hourBankTotals.balance)}</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-xs font-medium uppercase text-muted-foreground">Pendências</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{hourBankTotals.pending}</p>
            </div>
          </div>

          <div className="mt-3 flex justify-end">
            <Button type="button" variant="outline" onClick={() => setIsHourBankDetailDialogOpen(true)}>
              <Clock3 className="h-4 w-4" />
              Ver banco de horas detalhado
            </Button>
          </div>

          <div className="mt-4">
            <section className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Resumo por técnico</h3>
                <span className="text-xs text-muted-foreground">{formatCount(hourBankVisibleRows.length, 'técnico', 'técnicos')}</span>
              </div>

              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40">
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Técnico</th>
                      <th className="px-3 py-2 font-medium">Horas</th>
                      <th className="px-3 py-2 font-medium">Saldo</th>
                      <th className="px-3 py-2 font-medium">Ocorr.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourBankVisibleRows.length ? hourBankVisibleRows.map((row) => (
                      <tr key={row.technician_id} className="border-b border-border last:border-0">
                        <td className="px-3 py-3">
                          <p className="font-medium text-foreground">{row.technician_name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{row.worked_days} dia(s) trabalhado(s)</p>
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          <p className="font-medium text-foreground">{formatHours(row.worked_hours)}</p>
                          <p className="text-xs text-muted-foreground">de {formatHours(row.planned_hours)}</p>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={row.balance < 0 ? 'danger' : row.balance > 0 ? 'success' : 'neutral'}>
                            {formatHours(row.balance)}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted-foreground">
                          <span>{row.day_off_days} folga</span>
                          <span className="mx-1">·</span>
                          <span>{row.missed_days} falta</span>
                          <span className="mx-1">·</span>
                          <span>{row.pending_days} pend.</span>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">Sem técnicos com movimento no período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="hidden">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Extrato do período</h3>
                <span className="text-xs text-muted-foreground">{formatCount(hourBankDetailRows.length, 'linha', 'linhas')}</span>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[940px] text-sm">
                  <thead className="bg-secondary/40">
                    <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Técnico</th>
                      <th className="px-3 py-2 font-medium">Situação</th>
                      <th className="px-3 py-2 font-medium">Previsto</th>
                      <th className="px-3 py-2 font-medium">Real</th>
                      <th className="px-3 py-2 font-medium">Horas</th>
                      <th className="px-3 py-2 font-medium">Saldo</th>
                      <th className="px-3 py-2 font-medium">Obs.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourBankDetailRows.length ? hourBankDetailRows.map((row) => (
                      <tr key={row.key} className="border-b border-border last:border-0">
                        <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-3 py-3 font-medium text-foreground">{row.technician_name}</td>
                        <td className="px-3 py-3">{row.status_label}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{formatTimeRange(row.planned_start_time, row.planned_end_time)}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{row.actual_start_time ? formatTimeRange(row.actual_start_time, row.actual_end_time) : '-'}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{formatHours(row.worked_hours)} / {formatHours(row.planned_hours)}</td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={row.balance < 0 ? 'danger' : row.balance > 0 ? 'success' : 'neutral'}>
                            {formatHours(row.balance)}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-3 max-w-56 truncate text-muted-foreground" title={row.observation}>{row.observation}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">Nenhum apontamento ou escala no período selecionado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="hidden">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-3 pr-4 font-medium">Técnico</th>
                  <th className="py-3 pr-4 font-medium">Previsto</th>
                  <th className="py-3 pr-4 font-medium">Realizado</th>
                  <th className="py-3 pr-4 font-medium">Saldo</th>
                  <th className="py-3 pr-4 font-medium">Dias</th>
                  <th className="py-3 pr-4 font-medium">Folgas</th>
                  <th className="py-3 pr-4 font-medium">Faltas</th>
                  <th className="py-3 pr-4 font-medium">Justif.</th>
                  <th className="py-3 font-medium">Pend.</th>
                </tr>
              </thead>
              <tbody>
                {hourBankRows.map((row) => (
                  <tr key={row.technician_id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 font-medium text-foreground">{row.technician_name}</td>
                    <td className="py-3 pr-4">{formatHours(row.planned_hours)}</td>
                    <td className="py-3 pr-4">{formatHours(row.worked_hours)}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge tone={row.balance < 0 ? 'danger' : row.balance > 0 ? 'success' : 'neutral'}>
                        {formatHours(row.balance)}
                      </StatusBadge>
                    </td>
                    <td className="py-3 pr-4">{row.worked_days}</td>
                    <td className="py-3 pr-4">{row.day_off_days}</td>
                    <td className="py-3 pr-4">{row.missed_days}</td>
                    <td className="py-3 pr-4">{row.justified_days}</td>
                    <td className="py-3">{row.pending_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="hidden">
            <table className="w-full min-w-[1180px] text-sm">
              <thead className="bg-secondary/50">
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Data</th>
                  <th className="px-3 py-3 font-medium">Técnico</th>
                  <th className="px-3 py-3 font-medium">Situação</th>
                  <th className="px-3 py-3 font-medium">Entrada prevista</th>
                  <th className="px-3 py-3 font-medium">Saída prevista</th>
                  <th className="px-3 py-3 font-medium">Entrada real</th>
                  <th className="px-3 py-3 font-medium">Saída real</th>
                  <th className="px-3 py-3 font-medium">Horas</th>
                  <th className="px-3 py-3 font-medium">Saldo</th>
                  <th className="px-3 py-3 font-medium">Obs.</th>
                </tr>
              </thead>
              <tbody>
                {hourBankDetailRows.length ? hourBankDetailRows.map((row) => (
                  <tr key={row.key} className="border-b border-border last:border-0">
                    <td className="px-3 py-3">{formatDate(row.date)}</td>
                    <td className="px-3 py-3 font-medium text-foreground">{row.technician_name}</td>
                    <td className="px-3 py-3">{row.status_label}</td>
                    <td className="px-3 py-3">{formatTime(row.planned_start_time)}</td>
                    <td className="px-3 py-3">{formatTime(row.planned_end_time)}</td>
                    <td className="px-3 py-3">{row.actual_start_time ? formatTime(row.actual_start_time) : '-'}</td>
                    <td className="px-3 py-3">{row.actual_end_time ? formatTime(row.actual_end_time) : '-'}</td>
                    <td className="px-3 py-3">{formatHours(row.worked_hours)} / {formatHours(row.planned_hours)}</td>
                    <td className="px-3 py-3">
                      <StatusBadge tone={row.balance < 0 ? 'danger' : row.balance > 0 ? 'success' : 'neutral'}>
                        {formatHours(row.balance)}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{row.observation}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">Nenhum apontamento ou escala no período selecionado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </div>

      <Dialog open={isHourBankDetailDialogOpen} onOpenChange={setIsHourBankDetailDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-7xl">
          <div className="flex max-h-[90vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Banco de horas detalhado</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Somente visualização — situação, escala prevista, entrada e saída reais e saldo por técnico e dia.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-border/70 bg-card/70 p-4">
                <div className="flex h-11 items-center rounded-md border border-border bg-background p-1">
                  {hourBankPeriodOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setHourBankPeriodMode(option.value)}
                      className={`h-8 rounded px-3 text-sm font-medium transition ${hourBankPeriodMode === option.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {hourBankPeriodMode === 'month' ? (
                  <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                    <span className="sr-only">Mês</span>
                    <input type="month" value={hourBankMonth} onChange={(event) => setHourBankMonth(event.target.value)} className="h-9 bg-transparent text-sm text-foreground outline-none" />
                  </label>
                ) : hourBankPeriodMode === 'year' ? (
                  <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                    <span className="sr-only">Ano</span>
                    <input type="number" value={hourBankYear} onChange={(event) => setHourBankYear(Number(event.target.value) || new Date().getFullYear())} className="h-9 w-20 bg-transparent text-sm text-foreground outline-none" />
                  </label>
                ) : (
                  <>
                    <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                      <span className="sr-only">{hourBankPeriodMode === 'day' ? 'Data' : 'Semana de referência'}</span>
                      <input type="date" value={hourBankDate} onChange={(event) => setHourBankDate(event.target.value)} className="h-9 bg-transparent text-sm text-foreground outline-none" />
                    </label>
                    {hourBankPeriodMode === 'day' ? (
                      <Button type="button" variant="outline" onClick={() => setHourBankDate(createDateInputValue(new Date()))}>
                        Hoje
                      </Button>
                    ) : null}
                  </>
                )}

                <label className="flex h-11 items-center rounded-md border border-input bg-background px-3">
                  <span className="sr-only">Técnico</span>
                  <select
                    value={hourBankDetailTechnicianId}
                    onChange={(event) => setHourBankDetailTechnicianId(event.target.value)}
                    className="h-9 min-w-40 bg-transparent text-sm text-foreground outline-none"
                  >
                    <option value="all">Todos os técnicos</option>
                    {sortedTechnicians.map((technician) => (
                      <option key={technician.id} value={technician.id}>{technician.name}</option>
                    ))}
                  </select>
                </label>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700">
                      <Download className="h-4 w-4" />
                      Exportar
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => handleExportHourBankDetail('period')}>
                      Período selecionado ({hourBankPeriodLabel})
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleExportHourBankDetail('all')}>
                      Todos os períodos
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <span className="ml-auto text-sm text-muted-foreground">{hourBankPeriodLabel}</span>
              </div>

              <div className="mb-4 grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Período</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{formatDate(hourBankRange.startDate)} a {formatDate(hourBankRange.endDate)}</p>
                </div>
                <div className="rounded-md border border-border px-3 py-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Previsto</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatHours(hourBankDetailFilteredTotals.planned)}</p>
                </div>
                <div className="rounded-md border border-border px-3 py-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Realizado</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{formatHours(hourBankDetailFilteredTotals.worked)}</p>
                </div>
                <div className="rounded-md border border-border px-3 py-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Saldo</p>
                  <p className={`mt-1 text-lg font-semibold tabular-nums ${hourBankDetailFilteredTotals.balance < 0 ? 'text-rose-700' : hourBankDetailFilteredTotals.balance > 0 ? 'text-emerald-700' : 'text-foreground'}`}>{formatHours(hourBankDetailFilteredTotals.balance)}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
                <table className="w-full min-w-[1160px] text-sm">
                  <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3">Data</th>
                      <th className="px-3 py-3">Situação</th>
                      <th className="px-3 py-3">Técnico</th>
                      <th className="px-3 py-3">Escala</th>
                      <th className="px-3 py-3">Previsto</th>
                      <th className="px-3 py-3">Entrada</th>
                      <th className="px-3 py-3">Saída</th>
                      <th className="px-3 py-3">Observação</th>
                      <th className="px-3 py-3">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourBankDetailRowsFiltered.length ? hourBankDetailRowsFiltered.map((row) => (
                      <tr key={row.key} className="border-t border-border/70">
                        <td className="px-3 py-3 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{row.status_label}</td>
                        <td className="px-3 py-3 font-medium text-foreground">{row.technician_name}</td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={row.schedule_status === 'cancelled' ? 'warning' : row.schedule_status === 'completed' ? 'success' : row.schedule_status === 'scheduled' ? 'info' : 'neutral'}>
                            {row.schedule_status ? getStatusLabel(row.schedule_status) : 'Sem escala'}
                          </StatusBadge>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                          {row.planned_hours > 0 ? `${formatTimeRange(row.planned_start_time, row.planned_end_time)} • ${formatHours(row.planned_hours)}` : 'Sem expediente previsto'}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">{row.actual_start_time ? formatTime(row.actual_start_time) : '-'}</td>
                        <td className="px-3 py-3 whitespace-nowrap">{row.actual_end_time ? formatTime(row.actual_end_time) : '-'}</td>
                        <td className="px-3 py-3 max-w-64 truncate text-muted-foreground" title={row.observation}>{row.observation}</td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={row.balance < 0 ? 'danger' : row.balance > 0 ? 'success' : 'neutral'}>
                            {formatHours(row.balance)}
                          </StatusBadge>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nenhum apontamento ou escala no período selecionado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => setIsHourBankDetailDialogOpen(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFormDialogOpen} onOpenChange={handleFormDialogChange}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-6xl">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Montar escala</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Defina período, equipe e regra semanal. Ao salvar, a escala aberta do período é substituída e os dias já concluídos são preservados.
              </DialogDescription>
            </DialogHeader>

            <form id="schedule-builder-form" onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-7">
              {formError ? <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{formError}</div> : null}

              <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
                <section className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                  <div className="mb-4 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Período</p>
                    <h3 className="text-base font-semibold text-foreground">Competência da escala</h3>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="text-sm">
                      <span className="mb-1.5 block font-medium">Modo</span>
                      <select value={formData.period_mode} onChange={(event) => setFormData((current) => ({ ...current, period_mode: event.target.value as SchedulePeriodMode }))} className={inputClassName}>
                        <option value="day">Diário</option>
                        <option value="week">Semanal</option>
                        <option value="month">Mensal</option>
                        <option value="year">Anual</option>
                      </select>
                    </label>

                    {formData.period_mode === 'day' || formData.period_mode === 'week' ? (
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">{formData.period_mode === 'day' ? 'Data' : 'Semana de referência'}</span>
                        <input type="date" value={formData.date} onChange={(event) => setFormData((current) => ({ ...current, date: event.target.value }))} className={inputClassName} />
                      </label>
                    ) : null}

                    {formData.period_mode === 'month' ? (
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Mês</span>
                        <select value={formData.month} onChange={(event) => setFormData((current) => ({ ...current, month: Number(event.target.value) }))} className={inputClassName}>
                          {monthNames.map((month, index) => (
                            <option key={month} value={index + 1}>{month}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {formData.period_mode === 'month' || formData.period_mode === 'year' ? (
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Ano</span>
                        <select value={formData.year} onChange={(event) => setFormData((current) => ({ ...current, year: Number(event.target.value) }))} className={inputClassName}>
                          {Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - 1 + index).map((year) => (
                            <option key={year} value={year}>{year}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                    {formatDate(range.startDate)} até {formatDate(range.endDate)}
                  </div>
                </section>

                <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">Resumo</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-emerald-950">
                    <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{scopeSummary}</span>
                    <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(generationPreview.totalRows, 'linha prevista', 'linhas previstas')}</span>
                    <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{optionalAdjustmentsCount} ajustes</span>
                  </div>
                </section>
              </div>

              <section className="mt-4 rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Configurações</p>
                    <h3 className="text-base font-semibold text-foreground">Escopo e ajustes</h3>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <BuilderActionCard eyebrow="Escopo" title="Quem entra" value={scopeSummary} onClick={() => setBuilderDialog('scope')} />
                  <BuilderActionCard eyebrow="Grupo" title="Coberturas" value={formatCount(formData.groups.length, 'grupo', 'grupos')} onClick={() => setBuilderDialog('groups')} />
                  <BuilderActionCard eyebrow="Recorrências" title="Regras fixas" value={formatCount(formData.recurring_rules.length, 'regra', 'regras')} onClick={() => setBuilderDialog('recurring')} />
                  <BuilderActionCard eyebrow="Revezamento" title="Regras" value={formatCount(formData.rotation_groups.length, 'regra', 'regras')} onClick={() => setBuilderDialog('rotation')} />
                  <BuilderActionCard eyebrow="Folga geral" title="Datas sem expediente" value={formatCount(formData.general_days_off.length, 'data', 'datas')} onClick={() => setBuilderDialog('general-days-off')} />
                  <BuilderActionCard eyebrow="Individual" title="Exceções por técnico" value={formatCount(formData.overrides.length, 'ajuste', 'ajustes')} onClick={() => setBuilderDialog('overrides')} />
                </div>
              </section>

              <div className="hidden">
                <div className="space-y-4">
                  <section className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                    <div className="mb-4 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Período</p>
                      <h3 className="text-base font-semibold text-foreground">Competência da escala</h3>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Modo</span>
                        <select value={formData.period_mode} onChange={(event) => setFormData((current) => ({ ...current, period_mode: event.target.value as SchedulePeriodMode }))} className={inputClassName}>
                          <option value="day">Diário</option>
                          <option value="week">Semanal</option>
                          <option value="month">Mensal</option>
                          <option value="year">Anual</option>
                        </select>
                      </label>

                      {formData.period_mode === 'month' ? (
                        <label className="text-sm">
                          <span className="mb-1.5 block font-medium">Mês</span>
                          <select value={formData.month} onChange={(event) => setFormData((current) => ({ ...current, month: Number(event.target.value) }))} className={inputClassName}>
                            {monthNames.map((month, index) => (
                              <option key={month} value={index + 1}>
                                {month}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Ano</span>
                        <select value={formData.year} onChange={(event) => setFormData((current) => ({ ...current, year: Number(event.target.value) }))} className={inputClassName}>
                          {Array.from({ length: 6 }, (_, index) => new Date().getFullYear() - 1 + index).map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
                      {formatDate(range.startDate)} até {formatDate(range.endDate)}
                    </div>
                  </section>

                  <section className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                    <div className="mb-4 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Escopo</p>
                      <h3 className="text-base font-semibold text-foreground">Quem entra na escala</h3>
                    </div>

                    <div className="grid gap-4">
                      <label className="text-sm md:max-w-sm">
                        <span className="mb-1.5 block font-medium">Aplicar em</span>
                        <select value={formData.technician_scope} onChange={(event) => setFormData((current) => ({ ...current, technician_scope: event.target.value as 'all' | 'selected' }))} className={inputClassName}>
                          <option value="all">Todos os técnicos ativos</option>
                          <option value="selected">Apenas técnicos selecionados</option>
                        </select>
                      </label>

                      {formData.technician_scope === 'selected' ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Selecione os técnicos</p>
                          <TechnicianChecklist technicians={sortedTechnicians} value={formData.technician_ids} onToggle={toggleTechnicianSelection} emptyLabel="Não há técnicos ativos reais para selecionar." />
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                          Todos os técnicos ativos serão incluídos.
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                <div className="space-y-4">
                  <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-emerald-950">
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2 font-semibold">{formatDate(generationPreview.startDate)} até {formatDate(generationPreview.endDate)}</span>
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(generationPreview.technicianCount, 'técnico', 'técnicos')}</span>
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(generationPreview.totalRows, 'linha prevista', 'linhas previstas')}</span>
                      <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formData.recurring_rules.length + formData.rotation_groups.length + formData.general_days_off.length + formData.overrides.length} ajustes</span>
                    </div>
                    <p className="mt-3 text-xs text-emerald-900">Regras semanais vêm primeiro; exceções pontuais ajustam o resultado.</p>
                  </section>

                  <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Recorrências</span>
                        <span className="text-sm font-semibold text-foreground">Regras fixas por técnico</span>
                      </span>
                      <StatusBadge tone="neutral">{formData.recurring_rules.length}</StatusBadge>
                    </summary>

                    <div className="border-t border-border/70 p-4">
                      <div className="mb-3 flex justify-end">
                        <Button type="button" variant="outline" onClick={addRecurringRule}>
                          <Plus className="h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>

                      <div className="space-y-3">
                      {formData.recurring_rules.length ? (
                        formData.recurring_rules.map((rule) => (
                          <div key={rule.id} className="rounded-2xl border border-border/70 bg-background p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{sortedTechnicians.find((technician) => technician.id === rule.technician_id)?.name || 'Regra recorrente'}</p>
                                <p className="text-xs text-muted-foreground">{formatDayKeyList(rule.day_keys)}</p>
                              </div>
                              <StatusBadge tone={getStatusTone(rule.status)}>{getStatusLabel(rule.status)}</StatusBadge>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              <label className="text-sm xl:col-span-2">
                                <span className="mb-1.5 block font-medium">Técnico</span>
                                <select value={rule.technician_id} onChange={(event) => updateRecurringRule(rule.id, 'technician_id', event.target.value)} className={inputClassName}>
                                  <option value="">Selecione</option>
                                  {sortedTechnicians.map((technician) => (
                                    <option key={technician.id} value={technician.id}>
                                      {technician.name}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <div className="flex items-end xl:justify-end">
                                <Button type="button" variant="outline" onClick={() => removeRecurringRule(rule.id)}>
                                  <Trash2 className="h-4 w-4" />
                                  Remover
                                </Button>
                              </div>

                              <label className="text-sm">
                                <span className="mb-1.5 block font-medium">Tipo</span>
                                <select value={rule.status} onChange={(event) => updateRecurringRule(rule.id, 'status', event.target.value)} className={inputClassName}>
                                  <option value="cancelled">Folga recorrente</option>
                                  <option value="scheduled">Turno recorrente</option>
                                  <option value="completed">Turno recorrente concluído</option>
                                </select>
                              </label>

                              {rule.status !== 'cancelled' ? (
                                <>
                                  <label className="text-sm">
                                    <span className="mb-1.5 block font-medium">Entrada</span>
                                    <input type="time" value={rule.start_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'start_time', event.target.value)} className={inputClassName} />
                                  </label>

                                  <label className="text-sm">
                                    <span className="mb-1.5 block font-medium">Saída</span>
                                    <input type="time" value={rule.end_time || ''} onChange={(event) => updateRecurringRule(rule.id, 'end_time', event.target.value)} className={inputClassName} />
                                  </label>
                                </>
                              ) : (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
                                  Use esta regra para tirar um técnico sempre dos mesmos dias da semana.
                                </div>
                              )}

                              <label className="text-sm md:col-span-2 xl:col-span-3">
                                <span className="mb-1.5 block font-medium">Observação</span>
                                <input value={rule.notes || ''} onChange={(event) => updateRecurringRule(rule.id, 'notes', event.target.value)} placeholder="Ex.: folga fixa, plantão de fechamento, turno reduzido" className={inputClassName} />
                              </label>

                              <div className="md:col-span-2 xl:col-span-3">
                                <p className="mb-1.5 text-sm font-medium text-foreground">Dias da semana</p>
                                <DayKeyChecklist value={rule.day_keys} onToggle={(dayKey) => toggleRecurringRuleDay(rule.id, dayKey)} />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma regra fixa adicionada.</p>
                      )}
                      </div>
                    </div>
                  </details>

                  <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                      <span>
                        <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Revezamento</span>
                        <span className="text-sm font-semibold text-foreground">Regras de revezamento</span>
                      </span>
                      <StatusBadge tone="neutral">{formData.rotation_groups.length}</StatusBadge>
                    </summary>

                    <div className="border-t border-border/70 p-4">
                      <div className="mb-3 flex justify-end">
                        <Button type="button" variant="outline" onClick={addRotationGroup}>
                          <Plus className="h-4 w-4" />
                          Adicionar
                        </Button>
                      </div>

                      <div className="space-y-3">
                      {formData.rotation_groups.length ? (
                        formData.rotation_groups.map((group, index) => (
                          <div key={group.id} className="rounded-2xl border border-border/70 bg-background p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-foreground">Revezamento {index + 1}</p>
                              <Button type="button" variant="outline" onClick={() => removeRotationGroup(group.id)}>
                                <Trash2 className="h-4 w-4" />
                                Remover
                              </Button>
                            </div>

                            <div className="grid gap-3">
                              <div>
                                <p className="mb-1.5 text-sm font-medium text-foreground">Dias</p>
                                <DayKeyChecklist value={group.day_keys} onToggle={(dayKey) => toggleRotationGroupDay(group.id, dayKey)} />
                              </div>

                              <div>
                                <p className="mb-1.5 text-sm font-medium text-foreground">Técnicos</p>
                                <TechnicianChecklist technicians={ruleTechnicians} value={group.technician_ids} onToggle={(technicianId) => toggleRotationGroupTechnician(group.id, technicianId)} emptyLabel="Selecione primeiro o escopo da escala para configurar o revezamento." />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum revezamento criado.</p>
                      )}
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              <div className="hidden">
                <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Folga geral</span>
                      <span className="text-sm font-semibold text-foreground">Datas sem expediente</span>
                    </span>
                    <StatusBadge tone="neutral">{formData.general_days_off.length}</StatusBadge>
                  </summary>

                  <div className="border-t border-border/70 p-4">
                    <div className="mb-3 flex justify-end">
                      <Button type="button" variant="outline" onClick={addGeneralDayOff}>
                        <Plus className="h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>

                    <div className="space-y-3">
                    {formData.general_days_off.length ? (
                      formData.general_days_off.map((item) => (
                        <div key={item.id} className="grid gap-3 rounded-lg border border-border/70 bg-background p-4 md:grid-cols-[0.9fr_1.3fr_auto]">
                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Data</span>
                            <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateGeneralDayOff(item.id, 'date', event.target.value)} className={inputClassName} />
                          </label>

                          <label className="text-sm">
                            <span className="mb-1.5 block font-medium">Observação</span>
                            <input value={item.notes} onChange={(event) => updateGeneralDayOff(item.id, 'notes', event.target.value)} placeholder="Ex.: feriado, confraternização, recesso" className={inputClassName} />
                          </label>

                          <div className="flex items-end">
                            <Button type="button" variant="outline" onClick={() => removeGeneralDayOff(item.id)}>
                              <Trash2 className="h-4 w-4" />
                              Remover
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhuma folga geral adicional.</p>
                    )}
                    </div>
                  </div>
                </details>

                <details className="rounded-lg border border-border/70 bg-card/70 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Ajuste individual</span>
                      <span className="text-sm font-semibold text-foreground">Folga ou turno por técnico</span>
                    </span>
                    <StatusBadge tone="neutral">{formData.overrides.length}</StatusBadge>
                  </summary>

                  <div className="border-t border-border/70 p-4">
                    <div className="mb-3 flex justify-end">
                      <Button type="button" variant="outline" onClick={addOverride}>
                        <Plus className="h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>

                    <div className="space-y-3">
                    {formData.overrides.length ? (
                      formData.overrides.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border/70 bg-background p-4">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            <label className="text-sm xl:col-span-3">
                              <span className="mb-1.5 block font-medium">Técnico</span>
                              <select value={item.technician_id} onChange={(event) => updateOverride(item.id, 'technician_id', event.target.value)} className={inputClassName}>
                                <option value="">Selecione</option>
                                {sortedTechnicians.map((technician) => (
                                  <option key={technician.id} value={technician.id}>
                                    {technician.name}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="text-sm">
                              <span className="mb-1.5 block font-medium">Data</span>
                              <input type="date" value={item.date} min={generationPreview.startDate} max={generationPreview.endDate} onChange={(event) => updateOverride(item.id, 'date', event.target.value)} className={inputClassName} />
                            </label>

                            <label className="text-sm">
                              <span className="mb-1.5 block font-medium">Tipo</span>
                              <select value={item.status} onChange={(event) => updateOverride(item.id, 'status', event.target.value)} className={inputClassName}>
                                <option value="cancelled">Folga individual</option>
                                <option value="scheduled">Turno individual</option>
                                <option value="completed">Turno concluído</option>
                              </select>
                            </label>

                            <div className="flex items-end xl:justify-end">
                              <Button type="button" variant="outline" onClick={() => removeOverride(item.id)}>
                                <Trash2 className="h-4 w-4" />
                                Remover
                              </Button>
                            </div>

                            {item.status !== 'cancelled' ? (
                              <>
                                <label className="text-sm">
                                  <span className="mb-1.5 block font-medium">Entrada</span>
                                  <input type="time" value={item.start_time} onChange={(event) => updateOverride(item.id, 'start_time', event.target.value)} className={inputClassName} />
                                </label>

                                <label className="text-sm">
                                  <span className="mb-1.5 block font-medium">Saída</span>
                                  <input type="time" value={item.end_time} onChange={(event) => updateOverride(item.id, 'end_time', event.target.value)} className={inputClassName} />
                                </label>
                              </>
                            ) : (
                              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:col-span-2">
                                Esta folga individual será gravada como cancelamento do dia.
                              </div>
                            )}

                            <label className="text-sm md:col-span-2 xl:col-span-3">
                              <span className="mb-1.5 block font-medium">Observação</span>
                              <input value={item.notes} onChange={(event) => updateOverride(item.id, 'notes', event.target.value)} placeholder="Ex.: plantão especial, folga compensatória" className={inputClassName} />
                            </label>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum ajuste individual.</p>
                    )}
                    </div>
                  </div>
                </details>
              </div>

              <section className="mt-4 rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
                <div className="mb-4 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Grade semanal</p>
                  <h3 className="text-base font-semibold text-foreground">Horário padrão e regras por dia</h3>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-background p-3">
                    <p className="text-sm font-semibold text-foreground">Dias úteis</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Entrada</span>
                        <input type="time" value={formData.weekday_start_time} onChange={(event) => setFormData((current) => ({ ...current, weekday_start_time: event.target.value }))} className={inputClassName} />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Saída</span>
                        <input type="time" value={formData.weekday_end_time} onChange={(event) => setFormData((current) => ({ ...current, weekday_end_time: event.target.value }))} className={inputClassName} />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/70 bg-background p-3">
                    <p className="text-sm font-semibold text-foreground">Fim de semana</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Entrada</span>
                        <input type="time" value={formData.weekend_start_time} onChange={(event) => setFormData((current) => ({ ...current, weekend_start_time: event.target.value }))} className={inputClassName} />
                      </label>

                      <label className="text-sm">
                        <span className="mb-1.5 block font-medium">Saída</span>
                        <input type="time" value={formData.weekend_end_time} onChange={(event) => setFormData((current) => ({ ...current, weekend_end_time: event.target.value }))} className={inputClassName} />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-lg border border-border/70 bg-background">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3">Dia da semana</th>
                        <th className="px-3 py-3">Cobertura</th>
                        <th className="px-3 py-3">Frequência</th>
                        <th className="px-3 py-3">Técnicos</th>
                        <th className="px-3 py-3">Entrada</th>
                        <th className="px-3 py-3">Saída</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayRuleDefinitions.map(({ key, label, dayLabel }) => (
                        <DayRuleEditor
                          key={key}
                          label={label}
                          dayLabel={dayLabel}
                          rule={formData.day_rules[key]}
                          technicians={ruleTechnicians}
                          selectionLabel={formData.day_rule_group_ids[key] ? formData.groups.find((group) => group.id === formData.day_rule_group_ids[key])?.name || 'Grupo sem nome' : undefined}
                          fallbackStartTime={key === 'saturday' || key === 'sunday' ? formData.weekend_start_time : formData.weekday_start_time}
                          fallbackEndTime={key === 'saturday' || key === 'sunday' ? formData.weekend_end_time : formData.weekday_end_time}
                          onModeChange={(mode) => updateDayRuleMode(key, mode)}
                          onCadenceChange={(cadence) => updateDayRuleCadence(key, cadence)}
                          onStartTimeChange={(value) => updateDayRuleTime(key, 'start_time', value)}
                          onEndTimeChange={(value) => updateDayRuleTime(key, 'end_time', value)}
                          onSetTechnicians={(technicianIds) => setDayRuleTechnicians(key, technicianIds)}
                          onConfigureTechnicians={() => setActiveDayRuleKey(key)}
                          inputClassName={inputClassName}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </form>

            <DialogFooter className="border-t border-border/70 bg-background/95 px-6 py-4 sm:px-7">
              <Button type="button" variant="outline" onClick={() => handleFormDialogChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="schedule-builder-form" disabled={isSubmitting} className="min-w-44">
                {isSubmitting ? 'Salvando...' : `Salvar ${formatCount(generationPreview.totalRows, 'linha', 'linhas')}`}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isAttendanceDialogOpen} onOpenChange={handleAttendanceDialogChange}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-[96vw]">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Apontar horas</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Lance um dia específico, feche o mês inteiro ou importe os apontamentos por planilha.
              </DialogDescription>
            </DialogHeader>

            <form id="attendance-form" onSubmit={handleAttendanceSubmit} className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              {attendanceError ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{attendanceError}</div> : null}
              {attendanceMessage ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{attendanceMessage}</div> : null}

              <div className="mb-4 grid gap-3 lg:grid-cols-[16rem_1fr]">
                <section className="rounded-lg border border-border/70 bg-card/70 p-4">
                  <label className="text-sm">
                    <span className="mb-1.5 block font-medium">Modo</span>
                    <select value={attendanceMode} onChange={(event) => handleAttendanceModeChange(event.target.value as AttendanceMode)} className={inputClassName}>
                      <option value="day">Diário</option>
                      <option value="month">Mensal</option>
                      <option value="spreadsheet">Horas por planilha</option>
                    </select>
                  </label>

                  {attendanceMode === 'spreadsheet' ? (
                    <div className="mt-3">
                      <label className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium transition hover:bg-secondary">
                        <Upload className="h-4 w-4" />
                        {isAttendanceImportParsing ? 'Lendo planilha...' : 'Selecionar planilha de horas'}
                        <input type="file" accept=".xlsx,.xls,.csv" onChange={handleAttendanceImportFile} className="sr-only" />
                      </label>
                      <Button type="button" variant="outline" onClick={handleDownloadAttendanceImportTemplate} className="mt-2 w-full">
                        <Download className="h-4 w-4" />
                        Baixar modelo XLSX
                      </Button>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {attendanceImportFileName || 'Use a aba Banco de Dados com Data, Funcionário, Hora Início, Hora Final e Horas Trabalhadas.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <label className="mt-3 block text-sm">
                        <span className="mb-1.5 block font-medium">{attendanceMode === 'day' ? 'Data do apontamento' : 'Mês do apontamento'}</span>
                        {attendanceMode === 'day' ? (
                          <input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} className={inputClassName} />
                        ) : (
                          <input type="month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)} className={inputClassName} />
                        )}
                      </label>
                      <Button type="button" variant="outline" onClick={markAttendanceAutomatically} className="mt-3 w-full">
                        <Clock3 className="h-4 w-4" />
                        Marcar automático
                      </Button>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {attendanceMode === 'day'
                          ? 'Automático marca todos com o horário previsto.'
                          : 'Automático marca todos os apontamentos do mês com o horário previsto.'}
                      </p>
                    </>
                  )}
                </section>

                <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">{attendanceMode === 'day' ? 'Resumo do dia' : attendanceMode === 'month' ? 'Resumo do mês' : 'Resumo da importação'}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-emerald-950">
                    {attendanceMode === 'day' ? (
                      <>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(selectedAttendanceDrafts.length, 'técnico', 'técnicos')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Previsto: {formatHours(attendancePlannedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Realizado: {formatHours(attendanceWorkedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Saldo: {formatHours(attendanceBalance)}</span>
                      </>
                    ) : attendanceMode === 'month' ? (
                      <>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(selectedMonthlyAttendanceDrafts.length, 'apontamento', 'apontamentos')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(monthlyAttendanceDays, 'dia escalado', 'dias escalados')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Previsto: {formatHours(monthlyAttendancePlannedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Realizado: {formatHours(monthlyAttendanceWorkedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Saldo: {formatHours(monthlyAttendanceBalance)}</span>
                      </>
                    ) : (
                      <>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(attendanceImportRows.length, 'linha válida', 'linhas válidas')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">{formatCount(attendanceImportTechnicianCount, 'técnico', 'técnicos')}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Período: {attendanceImportPeriodLabel}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Horas: {formatHours(attendanceImportWorkedTotal)}</span>
                        <span className="rounded-md border border-emerald-200 bg-white/80 px-3 py-2">Erros: {attendanceImportErrors.length}</span>
                      </>
                    )}
                  </div>
                </section>
              </div>

              {attendanceMode === 'day' ? (
              <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
                <table className="w-full min-w-[1160px] text-sm">
                  <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3">Situação</th>
                      <th className="px-3 py-3">Técnico</th>
                      <th className="px-3 py-3">Escala</th>
                      <th className="px-3 py-3">Previsto</th>
                      <th className="px-3 py-3">Entrada</th>
                      <th className="px-3 py-3">Saída</th>
                      <th className="px-3 py-3">Observação</th>
                      <th className="px-3 py-3">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceDrafts.map((draft) => {
                      const hoursWorked = getAttendanceWorkedHours(draft);
                      const balance = getAttendanceBalance(draft);
                      const balanceTone = balance > 0 ? 'success' : balance < 0 ? 'danger' : 'neutral';
                      const plannedLabel = draft.planned_hours > 0
                        ? `${formatTimeRange(draft.planned_start_time, draft.planned_end_time)} • ${formatHours(draft.planned_hours)}`
                        : 'Sem expediente previsto';

                      return (
                        <tr key={draft.key} className="border-t border-border/70">
                          <td className="px-3 py-3">
                            <select
                              value={draft.attendance_status}
                              onChange={(event) => {
                                const status = event.target.value as AttendanceStatus;
                                updateAttendanceDraft(draft.key, {
                                  attendance_status: status,
                                  actual_start_time: draft.actual_start_time || draft.planned_start_time || scheduleRules.defaultStartTime,
                                  actual_end_time: draft.actual_end_time || draft.planned_end_time || scheduleRules.defaultEndTime,
                                });
                              }}
                              className="min-h-10 w-44 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                            >
                              <option value="not_marked">Não lançar</option>
                              <option value="worked">Trabalhou</option>
                              <option value="day_off">Folgou</option>
                              <option value="missed">Faltou</option>
                              <option value="justified">Justificou</option>
                              <option value="cancelled_service">Serviço cancelado</option>
                            </select>
                          </td>
                          <td className="px-3 py-3 font-medium text-foreground">{draft.technician_name}</td>
                          <td className="px-3 py-3">
                            <StatusBadge tone={draft.schedule_status === 'cancelled' ? 'warning' : draft.schedule_status === 'completed' ? 'success' : draft.schedule_status === 'scheduled' ? 'info' : 'neutral'}>
                              {draft.schedule_status ? getStatusLabel(draft.schedule_status) : 'Sem escala'}
                            </StatusBadge>
                          </td>
                          <td className="px-3 py-3 text-muted-foreground">{plannedLabel}</td>
                          <td className="px-3 py-3">
                            <input
                              type="time"
                              disabled={!attendanceHasHours(draft.attendance_status)}
                              value={draft.actual_start_time}
                              onChange={(event) => updateAttendanceDraft(draft.key, { actual_start_time: event.target.value })}
                              className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="time"
                              disabled={!attendanceHasHours(draft.attendance_status)}
                              value={draft.actual_end_time}
                              onChange={(event) => updateAttendanceDraft(draft.key, { actual_end_time: event.target.value })}
                              className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              value={draft.notes}
                              onChange={(event) => updateAttendanceDraft(draft.key, { notes: event.target.value })}
                              placeholder="Ex.: troca, curso, atestado"
                              className="min-h-10 w-52 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                            />
                          </td>
                          <td className="px-3 py-3">
                            {isAttendanceSelected(draft) ? (
                              <div className="space-y-1">
                                <StatusBadge tone={balanceTone}>{balance >= 0 ? `+${formatHours(balance)}` : `-${formatHours(Math.abs(balance))}`}</StatusBadge>
                                <p className="text-xs text-muted-foreground">{getAttendanceResultLabel(draft, hoursWorked)}</p>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              ) : attendanceMode === 'month' ? (
                <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
                  <table className="w-full min-w-[1320px] text-sm">
                    <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3">Data</th>
                        <th className="px-3 py-3">Situação</th>
                        <th className="px-3 py-3">Técnico</th>
                        <th className="px-3 py-3">Escala</th>
                        <th className="px-3 py-3">Previsto</th>
                        <th className="px-3 py-3">Entrada</th>
                        <th className="px-3 py-3">Saída</th>
                        <th className="px-3 py-3">Observação</th>
                        <th className="px-3 py-3">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyAttendanceDrafts.length ? monthlyAttendanceDrafts.map((draft) => {
                        const hoursWorked = getAttendanceWorkedHours(draft);
                        const balance = getAttendanceBalance(draft);
                        const balanceTone = balance > 0 ? 'success' : balance < 0 ? 'danger' : 'neutral';
                        const plannedLabel = draft.planned_hours > 0
                          ? `${formatTimeRange(draft.planned_start_time, draft.planned_end_time)} • ${formatHours(draft.planned_hours)}`
                          : 'Sem expediente previsto';

                        return (
                          <tr key={draft.key} className="border-t border-border/70">
                            <td className="px-3 py-3 text-muted-foreground">{formatDate(draft.date)}</td>
                            <td className="px-3 py-3">
                              <select
                                value={draft.attendance_status}
                                onChange={(event) => {
                                  const status = event.target.value as AttendanceStatus;
                                  updateMonthlyAttendanceDraft(draft.key, {
                                    attendance_status: status,
                                    actual_start_time: draft.actual_start_time || draft.planned_start_time || scheduleRules.defaultStartTime,
                                    actual_end_time: draft.actual_end_time || draft.planned_end_time || scheduleRules.defaultEndTime,
                                  });
                                }}
                                className="min-h-10 w-44 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                              >
                                <option value="not_marked">Não lançar</option>
                                <option value="worked">Trabalhou</option>
                                <option value="day_off">Folgou</option>
                                <option value="missed">Faltou</option>
                                <option value="justified">Justificou</option>
                              <option value="cancelled_service">Serviço cancelado</option>
                              </select>
                            </td>
                            <td className="px-3 py-3 font-medium text-foreground">{draft.technician_name}</td>
                            <td className="px-3 py-3">
                              <StatusBadge tone={draft.schedule_status === 'cancelled' ? 'warning' : draft.schedule_status === 'completed' ? 'success' : draft.schedule_status === 'scheduled' ? 'info' : 'neutral'}>
                                {draft.schedule_status ? getStatusLabel(draft.schedule_status) : 'Sem escala'}
                              </StatusBadge>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">{plannedLabel}</td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                disabled={!attendanceHasHours(draft.attendance_status)}
                                value={draft.actual_start_time}
                                onChange={(event) => updateMonthlyAttendanceDraft(draft.key, { actual_start_time: event.target.value })}
                                className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                type="time"
                                disabled={!attendanceHasHours(draft.attendance_status)}
                                value={draft.actual_end_time}
                                onChange={(event) => updateMonthlyAttendanceDraft(draft.key, { actual_end_time: event.target.value })}
                                className="min-h-10 w-28 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring disabled:opacity-60"
                              />
                            </td>
                            <td className="px-3 py-3">
                              <input
                                value={draft.notes}
                                onChange={(event) => updateMonthlyAttendanceDraft(draft.key, { notes: event.target.value })}
                                placeholder="Ex.: troca, curso, atestado"
                                className="min-h-10 w-52 rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring"
                              />
                            </td>
                            <td className="px-3 py-3">
                              {isAttendanceSelected(draft) ? (
                                <div className="space-y-1">
                                  <StatusBadge tone={balanceTone}>{balance >= 0 ? `+${formatHours(balance)}` : `-${formatHours(Math.abs(balance))}`}</StatusBadge>
                                  <p className="text-xs text-muted-foreground">{getAttendanceResultLabel(draft, hoursWorked)}</p>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">Nenhuma escala ativa salva para este mês.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-4">
                  {attendanceImportErrors.length ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{formatCount(attendanceImportErrors.length, 'linha com erro', 'linhas com erro')}</p>
                          <p className="mt-1 text-xs text-amber-800">Corrija as linhas abaixo na planilha e suba o arquivo novamente.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {attendanceImportErrors.length > 8 ? (
                            <Button type="button" variant="outline" size="sm" onClick={() => setShowAllAttendanceImportErrors((current) => !current)}>
                              {showAllAttendanceImportErrors ? 'Ver menos' : `Ver todos (${attendanceImportErrors.length})`}
                            </Button>
                          ) : null}
                          <Button type="button" variant="outline" size="sm" onClick={handleDownloadAttendanceImportErrors}>
                            <Download className="h-4 w-4" />
                            Baixar erros XLSX
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-2">
                        {visibleAttendanceImportErrors.map((item) => (
                          <div key={item.key} className="rounded-md border border-amber-200 bg-white/80 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">Linha {item.row_number || '-'}</span>
                              {item.sheet_name ? <span className="text-xs text-amber-700">Aba {item.sheet_name}</span> : null}
                            </div>
                            <p className="mt-1 font-medium text-amber-950">{item.message}</p>
                            <div className="mt-2 grid gap-1 text-xs text-amber-900 md:grid-cols-2 xl:grid-cols-5">
                              <span>Data: {item.values.date || '-'}</span>
                              <span>Funcionário: {item.values.employee || '-'}</span>
                              <span>Entrada: {item.values.start_time || '-'}</span>
                              <span>Saída: {item.values.end_time || '-'}</span>
                              <span>Horas: {item.values.hours_worked || '-'}</span>
                            </div>
                            {item.details.length ? (
                              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                                {item.details.map((detail) => (
                                  <li key={`${item.key}-${detail}`}>{detail}</li>
                                ))}
                              </ul>
                            ) : null}
                            <p className="mt-2 text-xs font-medium text-amber-950">Como corrigir: {item.suggestion}</p>
                          </div>
                        ))}
                      </div>
                      {hiddenAttendanceImportErrorCount ? <p className="mt-2 text-xs">Exibindo 8 primeiros erros. Ainda há {hiddenAttendanceImportErrorCount} linha(s) ocultas.</p> : null}
                    </div>
                  ) : null}

                  <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
                    <table className="w-full min-w-[1120px] text-sm">
                      <thead className="bg-secondary/60 text-left text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-3">Linha</th>
                          <th className="px-3 py-3">Data</th>
                          <th className="px-3 py-3">Técnico</th>
                          <th className="px-3 py-3">Nome na planilha</th>
                          <th className="px-3 py-3">Entrada</th>
                          <th className="px-3 py-3">Saída</th>
                          <th className="px-3 py-3">Horas</th>
                          <th className="px-3 py-3">Previsto</th>
                          <th className="px-3 py-3">Semana</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attendanceImportRows.length ? attendanceImportRows.slice(0, 160).map((row) => (
                          <tr key={`${row.key}-${row.row_number}`} className="border-t border-border/70">
                            <td className="px-3 py-3 text-muted-foreground">{row.row_number}</td>
                            <td className="px-3 py-3">{formatDate(row.date)}</td>
                            <td className="px-3 py-3 font-medium text-foreground">{row.technician_name}</td>
                            <td className="px-3 py-3 text-muted-foreground">{row.imported_name}</td>
                            <td className="px-3 py-3">{formatTime(row.start_time)}</td>
                            <td className="px-3 py-3">{formatTime(row.end_time)}</td>
                            <td className="px-3 py-3">{formatHours(row.hours_worked)}</td>
                            <td className="px-3 py-3 text-muted-foreground">{formatTimeRange(row.planned_start_time, row.planned_end_time)}</td>
                            <td className="px-3 py-3 text-muted-foreground">{row.week_number || '-'}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                              Carregue uma planilha XLSX, XLS ou CSV para validar os apontamentos antes de salvar.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  {attendanceImportRows.length > 160 ? (
                    <p className="text-xs text-muted-foreground">Exibindo as 160 primeiras linhas válidas. Todas as {attendanceImportRows.length} linhas válidas serão salvas.</p>
                  ) : null}
                </div>
              )}
            </form>

            <DialogFooter className="items-center border-t border-border/70 bg-background/95 px-6 py-4 sm:justify-between sm:px-7">
              <div className="min-h-5 flex-1 text-sm">
                {attendanceError ? <span className="text-rose-700">{attendanceError}</span> : null}
                {attendanceMessage ? <span className="text-emerald-700">{attendanceMessage}</span> : null}
                {isAttendanceSubmitting ? (
                  <span className="text-muted-foreground">
                    {attendanceMode === 'spreadsheet' ? 'Salvando horas importadas...' : attendanceMode === 'month' ? 'Salvando apontamentos do mês...' : 'Salvando apontamento...'}
                  </span>
                ) : null}
                {isAttendanceImportParsing ? <span className="text-muted-foreground">Lendo planilha...</span> : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => handleAttendanceDialogChange(false)}>
                  Cancelar
                </Button>
                <Button type="submit" form="attendance-form" disabled={isAttendanceSubmitting || isAttendanceImportParsing || (attendanceMode === 'spreadsheet' && !attendanceImportRows.length)} className="min-w-44">
                  {isAttendanceSubmitting ? 'Salvando...' : attendanceMode === 'spreadsheet' ? `Salvar horas importadas (${attendanceImportRows.length})` : attendanceMode === 'month' ? 'Salvar mês automático' : 'Salvar apontamento'}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={attendanceLunchPromptCount > 0} onOpenChange={(open) => {
        if (!open) setAttendanceLunchPromptCount(0);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Desconto de almoço</DialogTitle>
            <DialogDescription>
              {formatCount(attendanceLunchPromptCount, 'apontamento da planilha está', 'apontamentos da planilha estão')} com as horas sem o desconto de {formatBreakLabel(scheduleRules.dailyBreakMinutes)} de almoço (saída menos entrada).
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium text-foreground">Deseja adicionar o desconto de {formatBreakLabel(scheduleRules.dailyBreakMinutes)} de almoço para todos os técnicos?</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAttendanceLunchPromptCount(0)}>
              Não, manter como está
            </Button>
            <Button type="button" onClick={applyImportLunchBreak}>
              Sim, descontar {formatBreakLabel(scheduleRules.dailyBreakMinutes)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={builderDialog !== null} onOpenChange={(open) => {
        if (!open) setBuilderDialog(null);
      }}>
        <DialogContent className={`max-h-[90vh] overflow-hidden p-0 ${builderDialog === 'rotation' || builderDialog === 'groups' ? 'sm:max-w-6xl' : 'sm:max-w-4xl'}`}>
          {renderBuilderDialogContent()}
        </DialogContent>
      </Dialog>

      <Dialog open={activeDayRuleKey !== null} onOpenChange={(open) => {
        if (!open) setActiveDayRuleKey(null);
      }}>
        {activeDayDefinition && activeDayRule && activeDayRuleKey ? (
          <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-3xl">
            <div className="flex max-h-[88vh] min-h-0 flex-col">
              <DialogHeader className="border-b border-border/70 px-5 py-4">
                <DialogTitle>Cobertura de {activeDayDefinition.label}</DialogTitle>
                <DialogDescription>
                  {activeDayRule.mode === 'rotation' ? 'Escolha o técnico específico deste dia.' : 'Escolha um grupo para a equipe selecionada deste dia.'}
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {activeDayRule.mode === 'selected' ? (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Button type="button" variant="outline" onClick={() => {
                        setActiveDayRuleKey(null);
                        setBuilderDialog('groups');
                      }}>
                        Gerenciar grupos
                      </Button>
                    </div>

                    {formData.groups.length ? (
                      formData.groups.map((group) => {
                        const participantNames = group.technician_ids
                          .map((technicianId) => ruleTechnicians.find((technician) => technician.id === technicianId)?.name)
                          .filter((name): name is string => Boolean(name));
                        const isSelected = activeDayGroupId === group.id;

                        return (
                          <button
                            key={group.id}
                            type="button"
                            onClick={() => applyGroupToDayRule(activeDayRuleKey, group.id)}
                            className={`w-full rounded-lg border px-4 py-3 text-left transition ${isSelected ? 'border-emerald-300 bg-emerald-50/70' : 'border-border bg-background hover:border-emerald-200 hover:bg-secondary/40'}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">{group.name || 'Grupo sem nome'}</p>
                                <p className="text-xs text-muted-foreground">{formatCount(participantNames.length, 'participante no escopo', 'participantes no escopo')}</p>
                              </div>
                              {isSelected ? <StatusBadge tone="success">Selecionado</StatusBadge> : null}
                            </div>
                            {participantNames.length ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {participantNames.map((name) => (
                                  <StatusBadge key={`${group.id}-${name}`} tone="neutral">{name}</StatusBadge>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-muted-foreground">Nenhum participante deste grupo está no escopo atual.</p>
                            )}
                          </button>
                        );
                      })
                    ) : (
                      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Nenhum grupo criado. Crie um grupo para usar em equipe selecionada.</p>
                    )}

                    {activeDayGroup ? <p className="text-xs text-muted-foreground">Grupo atual: {activeDayGroup.name}</p> : null}
                  </div>
                ) : (
                  <TechnicianChecklist
                    technicians={ruleTechnicians}
                    value={activeDayRule.technician_ids}
                    onToggle={(technicianId) => toggleDayRuleTechnician(activeDayRuleKey, technicianId)}
                    emptyLabel={`Selecione primeiro o escopo da escala para escolher quem cobre ${activeDayDefinition.dayLabel}.`}
                  />
                )}
                {activeDayRule.mode === 'rotation' ? (
                  <p className="mt-3 text-xs text-muted-foreground">Sem marcação, a cobertura usa todos os técnicos do escopo.</p>
                ) : null}
              </div>

              <DialogFooter className="border-t border-border/70 px-5 py-4">
                <Button type="button" onClick={() => setActiveDayRuleKey(null)}>Concluir</Button>
              </DialogFooter>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={isCalendarDialogOpen} onOpenChange={setIsCalendarDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-hidden p-0 sm:max-w-375">
          <div className="flex max-h-[92vh] min-h-0 flex-col">
            <DialogHeader className="border-b border-border/70 px-6 py-5 sm:px-7">
              <DialogTitle className="text-xl">Calendário da escala</DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6 text-muted-foreground">
                Visualize por dia quem realmente está escalado no banco.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-7">
              <div className="mb-5 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Semana</span>
                  <select value={calendarWeek} onChange={(event) => setCalendarWeek(event.target.value)} className={inputClassName}>
                    <option value="all">Todas</option>
                    {calendarWeeks.map((_, index) => (
                      <option key={index} value={index}>
                        Semana {index + 1}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Mês</span>
                  <select value={calendarMonth} onChange={(event) => setCalendarMonth(Number(event.target.value))} className={inputClassName}>
                    {monthNames.map((month, index) => (
                      <option key={month} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm">
                  <span className="mb-1.5 block font-medium">Ano</span>
                  <select value={calendarYear} onChange={(event) => setCalendarYear(Number(event.target.value))} className={inputClassName}>
                    {calendarYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="flex items-end">
                  <div className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm">
                    <p className="font-semibold text-foreground">{formatCount(calendarScheduledEntries.length, 'registro escalado', 'registros escalados')}</p>
                    <p className="text-xs text-muted-foreground">no mês selecionado</p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <div className="min-w-295">
                  <div className="grid grid-cols-7 border-b border-border bg-slate-100 text-center text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                    {weekdayLabels.map((day) => (
                      <div key={day} className="px-3 py-3">
                        {day}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {displayedCalendarWeeks.flatMap((week, weekIndex) =>
                      week.map((day, dayIndex) => {
                        if (!day) {
                          return <div key={`empty-${weekIndex}-${dayIndex}`} className="min-h-64 border-b border-r border-border bg-muted/20 last:border-r-0" />;
                        }

                        const dateKey = createDateKey(calendarYear, calendarMonth, day);
                        const isToday = dateKey === todayKey;
                        const scheduledForDay = getCalendarDayScheduled(day);

                        return (
                          <div
                            key={`${calendarYear}-${calendarMonth}-${day}`}
                            className={`min-h-64 border-b border-r p-3 last:border-r-0 ${
                              isToday
                                ? 'border-primary bg-primary/5 ring-2 ring-inset ring-primary'
                                : 'border-border bg-card'
                            }`}
                          >
                            <div className="mb-3 flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="text-lg font-black text-foreground">{day}</p>
                                  {isToday ? <StatusBadge tone="info">Hoje</StatusBadge> : null}
                                </div>
                                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                  {formatCount(scheduledForDay.length, 'escalado', 'escalados')}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => openAttendanceForDate(dateKey)}>
                                  Ajustar
                                </Button>
                                <span className={`rounded-full px-2 py-1 text-[11px] font-black ${isToday ? 'bg-primary text-primary-foreground' : 'bg-emerald-50 text-emerald-700'}`}>
                                  {scheduledForDay.length}
                                </span>
                              </div>
                            </div>

                            <div className="max-h-52 overflow-y-auto pr-1">
                              {scheduledForDay.length ? (
                                <div className="space-y-1">
                                  {scheduledForDay.map(({ name, entry }) => (
                                    <div key={entry.id} className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1">
                                      <div className="flex items-start justify-between gap-2">
                                        <p className="min-w-0 truncate text-xs font-semibold text-emerald-950">{name}</p>
                                        <StatusBadge tone={getScheduleDisplayTone(entry)}>{getScheduleDisplayLabel(entry)}</StatusBadge>
                                      </div>
                                      <p className="mt-1 text-[11px] text-emerald-700">{getScheduleTimeLabel(entry)}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">Ninguém escalado.</p>
                              )}
                            </div>
                          </div>
                        );
                      }),
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mt-5">
        <DataPanel
          title="Visão geral da escala"
          description="Os próximos 7 dias, técnico por técnico. Se um dia aparecer como “Sem escala”, é porque ele ainda não foi gravado para aquele técnico."
          action={
            <Button type="button" variant="outline" onClick={() => setIsCalendarDialogOpen(true)}>
              <CalendarDays className="h-4 w-4" />
              Ver calendário
            </Button>
          }
        >
          {sortedTechnicians.length ? (
            <div className="overflow-x-auto">
              <div className="min-w-225">
                <div className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border text-xs font-medium text-muted-foreground">
                  <div className="py-2 pr-3">Técnico</div>
                  {weekDates.map((date) => (
                    <div key={date} className="py-2 pr-3">
                      <p className="font-semibold text-foreground">{formatDate(date)}</p>
                      <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{getDayLabelFromKey(getDayKeyFromDateKey(date))}</p>
                    </div>
                  ))}
                </div>

                {sortedTechnicians.map((technician) => {
                  const entriesByDate = new Map<string, Schedule[]>();

                  visibleSchedule
                    .filter((item) => item.technician_id === technician.id)
                    .forEach((item) => {
                      const dateKey = normalizeDateKey(item.date);
                      entriesByDate.set(dateKey, [...(entriesByDate.get(dateKey) ?? []), item]);
                    });

                  return (
                    <div key={technician.id} className="grid grid-cols-[220px_repeat(7,1fr)] border-b border-border last:border-0">
                      <div className="py-3 pr-3 text-sm font-medium">{technician.name}</div>
                      {weekDates.map((date) => {
                        const entry = getBestScheduleEntry(entriesByDate.get(date) ?? []);

                        return (
                          <div key={date} className="py-2 pr-3">
                            <div className="min-h-20 rounded-md border border-border bg-background p-2 text-xs">
                              {entry ? (
                                <>
                                  <StatusBadge tone={getScheduleDisplayTone(entry)}>{getScheduleDisplayLabel(entry)}</StatusBadge>
                                  <p className="mt-2 font-medium">{getScheduleTimeLabel(entry)}</p>
                                </>
                              ) : (
                                <>
                                  <StatusBadge tone="neutral">Sem escala</StatusBadge>
                                  <p className="mt-2 font-medium text-muted-foreground">Não gravado</p>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState icon={Users} title="Nenhum técnico ativo" description="Não há técnicos ativos reais para montar a escala." />
          )}
        </DataPanel>
      </div>

      <div className="mt-5">
        <DataPanel
          title="Registros da escala"
          description={`${formatCount(filteredSchedule.length, 'registro da escala gravado', 'registros da escala gravados')}.`}
          action={
            <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por técnico, data, status ou observação" className="w-72 bg-transparent text-sm outline-none" />
            </div>
          }
        >
          {filteredSchedule.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 pr-4 font-medium">Técnico</th>
                    <th className="py-3 pr-4 font-medium">Horário</th>
                    <th className="py-3 pr-4 font-medium">Status</th>
                    <th className="py-3 font-medium">Obs.</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSchedule.slice(0, 120).map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">{formatDate(item.date)}</td>
                      <td className="py-3 pr-4">{item.technician_name || item.technician_id}</td>
                      <td className="py-3 pr-4">{getScheduleTimeLabel(item)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={getScheduleDisplayTone(item)}>{getScheduleDisplayLabel(item)}</StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{getScheduleObservation(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Sem escala gravada" description="Ainda não há uma grade salva para exibir. Monte a escala para um mês ou ano e os registros vão aparecer aqui." />
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
