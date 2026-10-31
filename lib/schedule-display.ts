import { formatTimeRange, normalizeText } from './formatters';
import type { Schedule } from './types';

/**
 * How a schedule row is read and shown (status, time range, observation), shared by the screen that
 * builds the escala and the one that lists its records. Pure functions: no organization settings here.
 */

export type ManualAttendanceStatus = 'worked' | 'day_off' | 'missed' | 'justified' | 'cancelled_service';
export type ScheduleTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const MANUAL_ATTENDANCE_PREFIX = 'Apontamento manual:';

/** Statuses with real hours (start/end times). "Serviço cancelado" records hours like "Trabalhou". */
export function attendanceHasHours(status: string | undefined) {
  return status === 'worked' || status === 'cancelled_service';
}

/** Reads the note written by a manual apontamento ("Apontamento manual: folga; previsto=08:00-18:00; obs=...") */
export function parseManualAttendanceNote(notes: string | null | undefined) {
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
  let attendance_status: ManualAttendanceStatus | undefined;

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

export function getAttendanceStatusLabel(status: string | undefined) {
  if (status === 'worked') return 'Trabalhou';
  if (status === 'day_off') return 'Folgou';
  if (status === 'missed') return 'Faltou';
  if (status === 'justified') return 'Justificou';
  if (status === 'cancelled_service') return 'Serviço cancelado';
  return 'Sem apontamento';
}

export function normalizeTimeInput(value: string | null | undefined, fallback = '') {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;

  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

export function getStatusLabel(status: Schedule['status']) {
  if (status === 'cancelled') return 'Folga';
  if (status === 'completed') return 'Concluído';
  return 'Escalado';
}

export function getStatusTone(status: Schedule['status']): ScheduleTone {
  if (status === 'cancelled') return 'warning';
  if (status === 'completed') return 'success';
  return 'info';
}

export function getScheduleDisplayLabel(entry: Schedule | undefined) {
  const manualStatus = parseManualAttendanceNote(entry?.notes).attendance_status;
  if (manualStatus) return getAttendanceStatusLabel(manualStatus);
  if (!entry) return 'Sem escala';

  return getStatusLabel(entry.status);
}

export function getScheduleDisplayTone(entry: Schedule | undefined): ScheduleTone {
  const manualStatus = parseManualAttendanceNote(entry?.notes).attendance_status;
  if (manualStatus === 'worked') return 'success';
  if (manualStatus === 'missed') return 'danger';
  if (manualStatus === 'day_off' || manualStatus === 'justified' || manualStatus === 'cancelled_service') return 'warning';
  if (!entry) return 'neutral';

  return getStatusTone(entry.status);
}

/** The planned start/end of a row: what the manual apontamento recorded, else the row's own times. */
export function getSchedulePlannedTimes(entry: Schedule | undefined, fallbackStartTime = '', fallbackEndTime = '') {
  const manual = parseManualAttendanceNote(entry?.notes);

  return {
    startTime: normalizeTimeInput(manual.planned_start_time || entry?.start_time, fallbackStartTime),
    endTime: normalizeTimeInput(manual.planned_end_time || entry?.end_time, fallbackEndTime),
  };
}

export function getScheduleTimeLabel(entry: Schedule, fallbackStartTime = '', fallbackEndTime = '') {
  const manualStatus = parseManualAttendanceNote(entry.notes).attendance_status;

  if (attendanceHasHours(manualStatus)) {
    const plannedTimes = getSchedulePlannedTimes(entry, fallbackStartTime, fallbackEndTime);
    return `${formatTimeRange(entry.start_time, entry.end_time)} (prev. ${formatTimeRange(plannedTimes.startTime, plannedTimes.endTime)})`;
  }

  if (manualStatus) {
    const plannedTimes = getSchedulePlannedTimes(entry, fallbackStartTime, fallbackEndTime);
    return formatTimeRange(plannedTimes.startTime, plannedTimes.endTime);
  }

  if (entry.status === 'cancelled') return entry.notes || 'Dia de folga';

  return formatTimeRange(entry.start_time, entry.end_time);
}

export function getScheduleObservation(entry: Schedule) {
  const manual = parseManualAttendanceNote(entry.notes);
  if (manual.attendance_status) return manual.observation || '-';

  return entry.notes || '-';
}
