// Starting points for how a company pays its technicians, chosen when the owner creates it. A preset
// only fills the same per-organization settings the admin edits later (Configurações → Pagamento);
// nothing here is read at calculation time. Pure, relative imports only.
import type { OrganizationSettings } from './organization-settings';

export type PayPreset = 'fortnightly' | 'monthly';

export const PAY_PRESETS: readonly PayPreset[] = ['fortnightly', 'monthly'];

export const PAY_PRESET_LABELS: Record<PayPreset, string> = {
  fortnightly: 'Quinzenal',
  monthly: 'Mensal',
};

export type PayPresetSettings = Pick<OrganizationSettings, 'periodCutDays' | 'competenceSource' | 'settlePreviousMonthUntilDay'>;

export function isPayPreset(value: unknown): value is PayPreset {
  return typeof value === 'string' && (PAY_PRESETS as readonly string[]).includes(value);
}

/**
 * - fortnightly: Q1 up to day 15 and Q2 after, OS in the month of the batch. It is what a new company
 *   already gets, so it changes nothing.
 * - monthly: no fortnights (the technician sees only the month) and each OS counts in the month of its
 *   own date, since monthly payers' spreadsheets usually mix services from more than one month.
 *   The settle day is left at 0: it depends on each client's routine.
 */
export function payPresetSettings(preset: PayPreset): PayPresetSettings {
  if (preset === 'monthly') return { periodCutDays: [], competenceSource: 'service_date', settlePreviousMonthUntilDay: 0 };
  return { periodCutDays: [15], competenceSource: 'batch', settlePreviousMonthUntilDay: 0 };
}

/** The settings with the preset's fields replaced; everything else stays as it is. */
export function applyPayPreset(settings: OrganizationSettings, preset: PayPreset): OrganizationSettings {
  return { ...settings, ...payPresetSettings(preset) };
}
