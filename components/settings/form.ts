'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppSession } from '@/hooks/use-app-session';
import { resetOrganizationSettingsCache } from '@/hooks/use-organization-settings';
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  normalizeOrganizationSettings,
  overtimeMultiplierFromPercent,
  overtimePercentFromMultiplier,
  type BenefitPayment,
  type CommissionMode,
  type OrganizationSettings,
} from '@/lib/organization-settings';
import { parseCutDays, type CompetenceSource } from '@/lib/pay-calendar';

/** The settings screens are split by subject; each one saves only the fields it shows (the API keeps the rest). */
export type PeriodMode = 'monthly' | 'fortnightly' | 'custom';

export type SettingsGroup = 'payment' | 'hours' | 'porto' | 'finance';

type NumericKey =
  | 'commissionPercentage'
  | 'commissionRate'
  | 'commissionMinimum'
  | 'commissionMaximum'
  | 'baseSalary'
  | 'vaAllowance'
  | 'vrAllowance'
  | 'settlePreviousMonthUntilDay'
  | 'monthClosingDay'
  | 'monthlyHours'
  | 'overtimePercent'
  | 'dailyBreakMinutes'
  | 'monthlyHoursWarningFloor'
  | 'periodCutDay'
  | 'portoReprocessDays'
  | 'portoMaxShiftHours'
  | 'portoNextMonthLookaheadDays'
  | 'portoFullDayOffPercent'
  | 'portoLaudoGraceHours'
  | 'financeDueSoonDays';

type TimeKey = 'defaultShiftStart' | 'defaultShiftEnd' | 'portoHoursImportTime' | 'portoScheduleImportTime';
type BooleanKey = 'vaDeductsFromCommission' | 'vrDeductsFromCommission' | 'chargeCancelledServicePlanned' | 'portoUseLaudoConclusion' | 'portoWarningEnabled' | 'portoRecordCancelledDays';

export type FormState = Record<NumericKey, string> &
  Record<TimeKey, string> &
  Record<BooleanKey, boolean> & {
    commissionMode: CommissionMode;
    competenceSource: CompetenceSource;
    /** How the month is cut into payment periods: not at all, in two fortnights (one cut day) or at a list of days. */
    periodMode: PeriodMode;
    /** The text of the custom list ("10, 20"). */
    periodCutList: string;
    vaPayment: BenefitPayment;
    vrPayment: BenefitPayment;
    portoWarningText: string;
    portoAlertPhone: string;
    tiers: Array<{ id: number; minServices: string; amount: string }>;
    financeCategories: string[];
  };

let nextTierId = 1;

/** Shows numbers the Brazilian way (comma decimals) without trailing zeros. */
function formatNumber(value: number) {
  return String(Number(value.toFixed(2))).replace('.', ',');
}

/** Accepts "1.234,56", "1234,56" or "1234.56". Returns NaN for anything else. */
export function parseNumber(value: string) {
  const trimmed = value.trim().replace(/\s/g, '');
  if (!trimmed) return Number.NaN;
  const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
  return Number(normalized);
}

export function toForm(settings: OrganizationSettings): FormState {
  return {
    commissionMode: settings.commissionMode,
    commissionPercentage: formatNumber(settings.commissionPercentage),
    commissionRate: formatNumber(settings.commissionRate),
    commissionMinimum: formatNumber(settings.commissionMinimum),
    commissionMaximum: formatNumber(settings.commissionMaximum),
    baseSalary: formatNumber(settings.baseSalary),
    vaAllowance: formatNumber(settings.vaAllowance),
    vrAllowance: formatNumber(settings.vrAllowance),
    vaDeductsFromCommission: settings.vaDeductsFromCommission,
    vrDeductsFromCommission: settings.vrDeductsFromCommission,
    vaPayment: settings.vaPayment,
    vrPayment: settings.vrPayment,
    competenceSource: settings.competenceSource,
    settlePreviousMonthUntilDay: String(settings.settlePreviousMonthUntilDay),
    monthClosingDay: String(settings.monthClosingDay),
    monthlyHours: formatNumber(settings.monthlyHours),
    overtimePercent: formatNumber(overtimePercentFromMultiplier(settings.overtimeMultiplier)),
    dailyBreakMinutes: String(settings.dailyBreakMinutes),
    monthlyHoursWarningFloor: formatNumber(settings.monthlyHoursWarningFloor),
    periodMode: settings.periodCutDays.length === 0 ? 'monthly' : settings.periodCutDays.length === 1 ? 'fortnightly' : 'custom',
    periodCutDay: String(settings.periodCutDays[0] ?? 15),
    periodCutList: settings.periodCutDays.join(', '),
    portoReprocessDays: String(settings.portoReprocessDays),
    portoMaxShiftHours: formatNumber(settings.portoMaxShiftHours),
    portoNextMonthLookaheadDays: String(settings.portoNextMonthLookaheadDays),
    portoFullDayOffPercent: formatNumber(settings.portoFullDayOffPercent),
    portoLaudoGraceHours: formatNumber(settings.portoLaudoGraceHours),
    financeDueSoonDays: String(settings.financeDueSoonDays),
    defaultShiftStart: settings.defaultShiftStart,
    defaultShiftEnd: settings.defaultShiftEnd,
    portoHoursImportTime: settings.portoHoursImportTime,
    portoScheduleImportTime: settings.portoScheduleImportTime,
    chargeCancelledServicePlanned: settings.chargeCancelledServicePlanned,
    portoUseLaudoConclusion: settings.portoUseLaudoConclusion,
    portoWarningEnabled: settings.portoWarningEnabled,
    portoRecordCancelledDays: settings.portoRecordCancelledDays,
    portoWarningText: settings.portoWarningText,
    portoAlertPhone: settings.portoAlertPhone,
    tiers: settings.serviceAwardTiers.map((tier) => ({ id: nextTierId++, minServices: String(tier.minServices), amount: formatNumber(tier.amount) })),
    financeCategories: [...settings.financeCategories],
  };
}

/** Only the fields of one screen: the API keeps everything that is left out. */
export function toPayload(form: FormState, group: SettingsGroup) {
  const number = (key: NumericKey) => parseNumber(form[key]);
  switch (group) {
    case 'payment':
      return {
        commissionMode: form.commissionMode,
        commissionPercentage: number('commissionPercentage'),
        commissionRate: number('commissionRate'),
        commissionMinimum: number('commissionMinimum'),
        commissionMaximum: number('commissionMaximum'),
        baseSalary: number('baseSalary'),
        vaAllowance: number('vaAllowance'),
        vrAllowance: number('vrAllowance'),
        vaDeductsFromCommission: form.vaDeductsFromCommission,
        vrDeductsFromCommission: form.vrDeductsFromCommission,
        vaPayment: form.vaPayment,
        vrPayment: form.vrPayment,
        periodCutDays: periodCutDaysOf(form),
        competenceSource: form.competenceSource,
        settlePreviousMonthUntilDay: number('settlePreviousMonthUntilDay'),
        monthClosingDay: number('monthClosingDay'),
        serviceAwardTiers: form.tiers.map((tier) => ({ minServices: parseNumber(tier.minServices), amount: parseNumber(tier.amount) })),
      };
    case 'hours':
      return {
        monthlyHours: number('monthlyHours'),
        overtimeMultiplier: Number.isFinite(number('overtimePercent')) ? overtimeMultiplierFromPercent(number('overtimePercent')) : Number.NaN,
        dailyBreakMinutes: number('dailyBreakMinutes'),
        monthlyHoursWarningFloor: number('monthlyHoursWarningFloor'),
        defaultShiftStart: form.defaultShiftStart,
        defaultShiftEnd: form.defaultShiftEnd,
        chargeCancelledServicePlanned: form.chargeCancelledServicePlanned,
      };
    case 'porto':
      return {
        portoHoursImportTime: form.portoHoursImportTime,
        portoScheduleImportTime: form.portoScheduleImportTime,
        portoReprocessDays: number('portoReprocessDays'),
        portoMaxShiftHours: number('portoMaxShiftHours'),
        portoNextMonthLookaheadDays: number('portoNextMonthLookaheadDays'),
        portoFullDayOffPercent: number('portoFullDayOffPercent'),
        portoLaudoGraceHours: number('portoLaudoGraceHours'),
        portoUseLaudoConclusion: form.portoUseLaudoConclusion,
        portoWarningEnabled: form.portoWarningEnabled,
        portoWarningText: form.portoWarningText,
        portoAlertPhone: form.portoAlertPhone,
        portoRecordCancelledDays: form.portoRecordCancelledDays,
      };
    case 'finance':
      return { financeDueSoonDays: number('financeDueSoonDays'), financeCategories: form.financeCategories };
  }
}

/** The cut days the form describes; a list the API will refuse (and say why) when the text is not a valid one. */
export function periodCutDaysOf(form: FormState): number[] {
  if (form.periodMode === 'monthly') return [];
  if (form.periodMode === 'fortnightly') return [parseNumber(form.periodCutDay)];
  return parseCutDays(form.periodCutList) ?? [Number.NaN];
}

export const newTier = () => ({ id: nextTierId++, minServices: '', amount: '' });

/** What every settings screen needs: load once, edit a form, know if something changed, save only its own fields. */
export function useSettingsForm(group: SettingsGroup) {
  const { user, loading: sessionLoading } = useAppSession();
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULT_ORGANIZATION_SETTINGS));
  const [saved, setSaved] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const snapshot = useCallback((state: FormState) => JSON.stringify(toPayload(state, group), (_key, value) => (typeof value === 'number' && Number.isNaN(value) ? 'NaN' : value)), [group]);

  useEffect(() => {
    if (sessionLoading || !user) return;
    let mounted = true;
    fetch('/api/organization-settings', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar as configurações.');
        if (!mounted) return;
        const next = toForm(normalizeOrganizationSettings(data?.settings));
        setForm(next);
        setSaved(snapshot(next));
        setUpdatedAt(data?.updatedAt ?? null);
      })
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as configurações.'))
      .finally(() => mounted && setLoaded(true));
    return () => {
      mounted = false;
    };
  }, [sessionLoading, user, snapshot]);

  const dirty = useMemo(() => loaded && snapshot(form) !== saved, [form, loaded, saved, snapshot]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setJustSaved(false);
    setSaveError('');
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError('');
    try {
      const response = await fetch('/api/organization-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: toPayload(form, group) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar as configurações.');
      const next = toForm(normalizeOrganizationSettings(data?.settings));
      setForm(next);
      setSaved(snapshot(next));
      setUpdatedAt(data?.updatedAt ?? null);
      setJustSaved(true);
      resetOrganizationSettingsCache();
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Não foi possível salvar as configurações.');
    } finally {
      setSaving(false);
    }
  }, [form, group, snapshot]);

  /** Throw away the edits and go back to what is saved. */
  const discard = useCallback(() => {
    setSaveError('');
    setJustSaved(false);
    setLoaded(false);
    fetch('/api/organization-settings', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        const next = toForm(normalizeOrganizationSettings(data?.settings));
        setForm(next);
        setSaved(snapshot(next));
      })
      .finally(() => setLoaded(true));
  }, [snapshot]);

  return { user, sessionLoading, form, setForm, update, loaded, error, dirty, saving, save, discard, saveError, justSaved, updatedAt };
}
