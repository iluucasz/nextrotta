// Relative imports only: this module is also compiled into the VPS worker (worker/tsconfig.json),
// which has no `@/` path alias.
import { sql } from './db';
import { DEFAULT_ORGANIZATION_SETTINGS, normalizeOrganizationSettings, type OrganizationSettings } from './organization-settings';

// Payroll previews and the worker read the settings many times in a burst; a short in-process
// cache per organization keeps that to one query. Saving clears it in this process; other
// processes (other Vercel instances, the worker) pick the change up within CACHE_TTL_MS.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { settings: OrganizationSettings; at: number }>();

/** The organization's settings, or the defaults when it has no row yet. Columns are snake_case. */
export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.settings;

  const rows = await sql`SELECT * FROM organization_settings WHERE organization_id = ${organizationId}`;
  const settings = rows[0] ? normalizeOrganizationSettings(rows[0]) : { ...DEFAULT_ORGANIZATION_SETTINGS };
  cache.set(organizationId, { settings, at: Date.now() });
  return settings;
}

export async function getOrganizationSettingsMeta(organizationId: string): Promise<{ updatedAt: string | null; updatedBy: string | null }> {
  const rows = await sql`SELECT updated_at, updated_by FROM organization_settings WHERE organization_id = ${organizationId}`;
  return {
    updatedAt: rows[0]?.updated_at ? new Date(rows[0].updated_at as string).toISOString() : null,
    updatedBy: rows[0]?.updated_by ? String(rows[0].updated_by) : null,
  };
}

/** Upserts the (already validated) settings and returns what was stored. */
export async function saveOrganizationSettings(organizationId: string, settings: OrganizationSettings, updatedBy: string): Promise<OrganizationSettings> {
  const s = settings;
  const rows = await sql`
    INSERT INTO organization_settings (
      organization_id, commission_percentage, base_salary, va_allowance, vr_allowance,
      monthly_hours, overtime_multiplier, daily_break_minutes, default_shift_start, default_shift_end,
      monthly_hours_warning_floor, fortnight_split_day, charge_cancelled_service_planned, service_award_tiers,
      porto_hours_import_time, porto_schedule_import_time, porto_reprocess_days, porto_max_shift_hours,
      porto_next_month_lookahead_days, porto_full_day_off_percent, porto_use_laudo_conclusion,
      porto_warning_enabled, porto_warning_text, porto_record_cancelled_days, porto_alert_phone,
      finance_due_soon_days, finance_categories, updated_at, updated_by
    )
    VALUES (
      ${organizationId}, ${s.commissionPercentage}, ${s.baseSalary}, ${s.vaAllowance}, ${s.vrAllowance},
      ${s.monthlyHours}, ${s.overtimeMultiplier}, ${s.dailyBreakMinutes}, ${s.defaultShiftStart}, ${s.defaultShiftEnd},
      ${s.monthlyHoursWarningFloor}, ${s.fortnightSplitDay}, ${s.chargeCancelledServicePlanned}, ${JSON.stringify(s.serviceAwardTiers)}::jsonb,
      ${s.portoHoursImportTime}, ${s.portoScheduleImportTime}, ${s.portoReprocessDays}, ${s.portoMaxShiftHours},
      ${s.portoNextMonthLookaheadDays}, ${s.portoFullDayOffPercent}, ${s.portoUseLaudoConclusion},
      ${s.portoWarningEnabled}, ${s.portoWarningText}, ${s.portoRecordCancelledDays}, ${s.portoAlertPhone},
      ${s.financeDueSoonDays}, ${JSON.stringify(s.financeCategories)}::jsonb, NOW(), ${updatedBy}
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET commission_percentage = EXCLUDED.commission_percentage,
        base_salary = EXCLUDED.base_salary,
        va_allowance = EXCLUDED.va_allowance,
        vr_allowance = EXCLUDED.vr_allowance,
        monthly_hours = EXCLUDED.monthly_hours,
        overtime_multiplier = EXCLUDED.overtime_multiplier,
        daily_break_minutes = EXCLUDED.daily_break_minutes,
        default_shift_start = EXCLUDED.default_shift_start,
        default_shift_end = EXCLUDED.default_shift_end,
        monthly_hours_warning_floor = EXCLUDED.monthly_hours_warning_floor,
        fortnight_split_day = EXCLUDED.fortnight_split_day,
        charge_cancelled_service_planned = EXCLUDED.charge_cancelled_service_planned,
        service_award_tiers = EXCLUDED.service_award_tiers,
        porto_hours_import_time = EXCLUDED.porto_hours_import_time,
        porto_schedule_import_time = EXCLUDED.porto_schedule_import_time,
        porto_reprocess_days = EXCLUDED.porto_reprocess_days,
        porto_max_shift_hours = EXCLUDED.porto_max_shift_hours,
        porto_next_month_lookahead_days = EXCLUDED.porto_next_month_lookahead_days,
        porto_full_day_off_percent = EXCLUDED.porto_full_day_off_percent,
        porto_use_laudo_conclusion = EXCLUDED.porto_use_laudo_conclusion,
        porto_warning_enabled = EXCLUDED.porto_warning_enabled,
        porto_warning_text = EXCLUDED.porto_warning_text,
        porto_record_cancelled_days = EXCLUDED.porto_record_cancelled_days,
        porto_alert_phone = EXCLUDED.porto_alert_phone,
        finance_due_soon_days = EXCLUDED.finance_due_soon_days,
        finance_categories = EXCLUDED.finance_categories,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
    RETURNING *
  `;

  const saved = normalizeOrganizationSettings(rows[0]);
  cache.set(organizationId, { settings: saved, at: Date.now() });
  return saved;
}
