// Per-organization business rules, edited by the organization's admin in /admin/configuracoes (and
// by the platform owner). Dependency-free on purpose: imported by client screens, API routes and the
// VPS worker (worker/tsconfig.json) alike. Relative imports only. Storage: organization-settings-store.ts.

export type ServiceAwardTier = {
  /** Number of OS (services) in the month that reaches this tier. */
  minServices: number;
  /** Award paid on the payroll, in R$. */
  amount: number;
};

export type OrganizationSettings = {
  // Technician defaults — used when a technician has no value of their own, and as a new one's start.
  /** % of the month's OS total that forms the commission base. */
  commissionPercentage: number;
  baseSalary: number;
  vaAllowance: number;
  vrAllowance: number;

  // Workday and hours
  /** Monthly hours target: hour-bank goal and divisor of the hourly rate. */
  monthlyHours: number;
  /** Overtime hour = multiplier × normal hour (1.5 = +50%). */
  overtimeMultiplier: number;
  /** Break netted out of each day's hours, only when the day's span exceeds it. */
  dailyBreakMinutes: number;
  /** Shift used when nothing else says otherwise (new schedules, attendance defaults, Porto fallback). */
  defaultShiftStart: string;
  defaultShiftEnd: string;
  /** Below this many hours in the month the technician's hours card turns red (warning between it and the target). */
  monthlyHoursWarningFloor: number;
  /** Last day of Q1 when a service has no fortnight set (Q2 = the rest of the month). */
  fortnightSplitDay: number;
  /** Whether a "Serviço cancelado" day charges its planned hours on the hour bank. */
  chargeCancelledServicePlanned: boolean;

  // Production award
  /** Sorted by minServices ascending. Also the OS goals shown to technicians. */
  serviceAwardTiers: ServiceAwardTier[];

  // Porto automation (VPS worker)
  /** "HH:MM", Brasília time. */
  portoHoursImportTime: string;
  portoScheduleImportTime: string;
  /** Days before today that every run recomputes (1 = yesterday and today). */
  portoReprocessDays: number;
  /** A computed day above this many hours is rejected as implausible. */
  portoMaxShiftHours: number;
  /** In the month's last N days the next month's escala is imported too (0 = never). */
  portoNextMonthLookaheadDays: number;
  /** % of the shift an indisponibilidade must cover to count as a full day off. */
  portoFullDayOffPercent: number;
  /** Without a laudo signature, use the laudo's "Data de conclusão" before falling back to "Concluído". */
  portoUseLaudoConclusion: boolean;
  /** Flag the day when the last service's laudo wasn't filled in. */
  portoWarningEnabled: boolean;
  /** Text after the fixed "ADVERTÊNCIA:" marker. `{servico}` = the service code. */
  portoWarningText: string;
  /** Record days whose services were all cancelled as "Serviço cancelado". */
  portoRecordCancelledDays: boolean;
  /** WhatsApp number warned when an automatic Porto run fails or looks wrong ('' = no alerts). */
  portoAlertPhone: string;

  // Finance
  /** Bills due within this many days are flagged "vence em breve". */
  financeDueSoonDays: number;
  /** Expense categories offered on the finance screen. */
  financeCategories: string[];
};

/** Fixed marker the hours job and the "never recompute a warned day" rule look for. Never editable. */
export const PORTO_WARNING_MARKER = 'ADVERTÊNCIA:';

/**
 * A new organization's starting values. Salary, VA, VR and the award tiers start empty: they are the
 * organization's own numbers (never the original client's), set by its admin.
 */
export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  commissionPercentage: 25,
  baseSalary: 0,
  vaAllowance: 0,
  vrAllowance: 0,

  monthlyHours: 220,
  overtimeMultiplier: 1.5,
  dailyBreakMinutes: 60,
  defaultShiftStart: '08:00',
  defaultShiftEnd: '18:00',
  monthlyHoursWarningFloor: 200,
  fortnightSplitDay: 15,
  chargeCancelledServicePlanned: false,

  serviceAwardTiers: [],

  portoHoursImportTime: '23:00',
  portoScheduleImportTime: '03:00',
  portoReprocessDays: 1,
  portoMaxShiftHours: 16,
  portoNextMonthLookaheadDays: 7,
  portoFullDayOffPercent: 90,
  portoUseLaudoConclusion: true,
  portoWarningEnabled: true,
  portoWarningText: 'laudo digital não preenchido no serviço {servico} — fim de jornada pelo horário de Concluído.',
  portoRecordCancelledDays: true,
  portoAlertPhone: '',

  financeDueSoonDays: 7,
  financeCategories: [
    'Geral',
    'Cartão de crédito',
    'Financiamento',
    'Aluguel',
    'Energia',
    'Água',
    'Internet',
    'Telefone',
    'Impostos',
    'Fornecedores',
    'Manutenção',
    'Combustível',
    'Folha',
    'Marketing',
    'Reserva',
    'Investimentos',
    'Outros',
  ],
};

/** What a technician's own screens may read — salaries and commission never leave the admin side. */
export type TechnicianOrganizationSettings = Pick<
  OrganizationSettings,
  'monthlyHours' | 'dailyBreakMinutes' | 'serviceAwardTiers' | 'monthlyHoursWarningFloor' | 'fortnightSplitDay'
>;

export function pickTechnicianSettings(settings: OrganizationSettings): TechnicianOrganizationSettings {
  return {
    monthlyHours: settings.monthlyHours,
    dailyBreakMinutes: settings.dailyBreakMinutes,
    serviceAwardTiers: settings.serviceAwardTiers,
    monthlyHoursWarningFloor: settings.monthlyHoursWarningFloor,
    fortnightSplitDay: settings.fortnightSplitDay,
  };
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function toTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const time = `${match[1].padStart(2, '0')}:${match[2]}`;
  return TIME_PATTERN.test(time) ? time : null;
}

/** Accepts camelCase or snake_case keys, so a DB row or an API body both work. */
function pick(source: Record<string, unknown>, key: keyof OrganizationSettings): unknown {
  if (key in source) return source[key];
  const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return source[snake];
}

function normalizeTiers(value: unknown): ServiceAwardTier[] | null {
  if (!Array.isArray(value)) return null;
  const tiers: ServiceAwardTier[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const minServices = toNumber(record.minServices ?? record.min_services);
    const amount = toNumber(record.amount);
    if (minServices === null || amount === null) return null;
    tiers.push({ minServices, amount });
  }
  return tiers.sort((a, b) => a.minServices - b.minServices);
}

function normalizeCategories(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

/**
 * Lenient: every missing or invalid field falls back to its default, field by field. For reading
 * what's stored; input from the screen goes through parseOrganizationSettingsInput instead.
 */
export function normalizeOrganizationSettings(raw: unknown): OrganizationSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const parsed = parseFields(source);
  const keys = Object.keys(DEFAULT_ORGANIZATION_SETTINGS) as Array<keyof OrganizationSettings>;

  // Stored values over the defaults, then each one checked against that merged view (for the
  // cross-field rules) and dropped back to its default when invalid.
  const candidate = { ...DEFAULT_ORGANIZATION_SETTINGS } as Record<string, unknown>;
  for (const key of keys) {
    if (parsed[key] !== null && parsed[key] !== undefined) candidate[key] = parsed[key];
  }
  const result = { ...DEFAULT_ORGANIZATION_SETTINGS } as Record<string, unknown>;
  for (const key of keys) {
    if (validateField(key, candidate[key], candidate as OrganizationSettings) === null) result[key] = candidate[key];
  }
  const settings = result as OrganizationSettings;
  if (minutesOf(settings.defaultShiftEnd) <= minutesOf(settings.defaultShiftStart)) {
    settings.defaultShiftStart = DEFAULT_ORGANIZATION_SETTINGS.defaultShiftStart;
    settings.defaultShiftEnd = DEFAULT_ORGANIZATION_SETTINGS.defaultShiftEnd;
  }
  return settings;
}

type ParsedFields = { [K in keyof OrganizationSettings]: OrganizationSettings[K] | null };

function parseFields(source: Record<string, unknown>): ParsedFields {
  const number = (key: keyof OrganizationSettings) => toNumber(pick(source, key));
  const bool = (key: keyof OrganizationSettings) => toBoolean(pick(source, key));
  const time = (key: keyof OrganizationSettings) => toTime(pick(source, key));
  const text = (key: keyof OrganizationSettings) => {
    const value = pick(source, key);
    return typeof value === 'string' ? value.trim() : null;
  };

  return {
    commissionPercentage: number('commissionPercentage'),
    baseSalary: number('baseSalary'),
    vaAllowance: number('vaAllowance'),
    vrAllowance: number('vrAllowance'),
    monthlyHours: number('monthlyHours'),
    overtimeMultiplier: number('overtimeMultiplier'),
    dailyBreakMinutes: number('dailyBreakMinutes'),
    defaultShiftStart: time('defaultShiftStart'),
    defaultShiftEnd: time('defaultShiftEnd'),
    monthlyHoursWarningFloor: number('monthlyHoursWarningFloor'),
    fortnightSplitDay: number('fortnightSplitDay'),
    chargeCancelledServicePlanned: bool('chargeCancelledServicePlanned'),
    serviceAwardTiers: normalizeTiers(pick(source, 'serviceAwardTiers')),
    portoHoursImportTime: time('portoHoursImportTime'),
    portoScheduleImportTime: time('portoScheduleImportTime'),
    portoReprocessDays: number('portoReprocessDays'),
    portoMaxShiftHours: number('portoMaxShiftHours'),
    portoNextMonthLookaheadDays: number('portoNextMonthLookaheadDays'),
    portoFullDayOffPercent: number('portoFullDayOffPercent'),
    portoUseLaudoConclusion: bool('portoUseLaudoConclusion'),
    portoWarningEnabled: bool('portoWarningEnabled'),
    portoWarningText: text('portoWarningText'),
    portoRecordCancelledDays: bool('portoRecordCancelledDays'),
    portoAlertPhone: text('portoAlertPhone'),
    financeDueSoonDays: number('financeDueSoonDays'),
    financeCategories: normalizeCategories(pick(source, 'financeCategories')),
  };
}

const isInteger = (value: number) => Number.isInteger(value);
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Returns the user-facing error for one field, or null when it's valid. `all` is for cross-field rules. */
function validateField(key: keyof OrganizationSettings, value: unknown, all: OrganizationSettings): string | null {
  const n = value as number;
  switch (key) {
    case 'commissionPercentage':
      return n >= 0 && n <= 100 ? null : 'O percentual de comissão deve estar entre 0 e 100.';
    case 'baseSalary':
    case 'vaAllowance':
    case 'vrAllowance':
      return n >= 0 ? null : 'Salário, VA e VR não podem ser negativos.';
    case 'monthlyHours':
      return n > 0 && n <= 744 ? null : 'A jornada mensal deve ser maior que zero (até 744 horas).';
    case 'overtimeMultiplier':
      return n >= 1 && n <= 5 ? null : 'O adicional de hora extra deve ficar entre 1 (sem adicional) e 5.';
    case 'dailyBreakMinutes':
      return isInteger(n) && n >= 0 && n <= 240 ? null : 'O intervalo diário deve ser um número inteiro de minutos entre 0 e 240.';
    case 'defaultShiftStart':
    case 'defaultShiftEnd':
      return typeof value === 'string' && TIME_PATTERN.test(value) ? null : 'O turno padrão precisa de início e fim no formato HH:MM.';
    case 'monthlyHoursWarningFloor':
      return n >= 0 && n <= all.monthlyHours ? null : 'O alerta de horas deve ficar entre 0 e a jornada mensal.';
    case 'fortnightSplitDay':
      return isInteger(n) && n >= 1 && n <= 27 ? null : 'O último dia da Q1 deve ser um dia entre 1 e 27.';
    case 'serviceAwardTiers': {
      const tiers = value as ServiceAwardTier[];
      if (tiers.some((tier) => !(tier.minServices > 0) || !(tier.amount > 0) || !isInteger(tier.minServices))) {
        return 'Cada faixa de prêmio precisa de quantidade de OS e valor maiores que zero.';
      }
      return new Set(tiers.map((tier) => tier.minServices)).size === tiers.length ? null : 'Duas faixas de prêmio não podem exigir a mesma quantidade de OS.';
    }
    case 'portoHoursImportTime':
    case 'portoScheduleImportTime':
      return typeof value === 'string' && TIME_PATTERN.test(value) ? null : 'Os horários do robô do Porto precisam estar no formato HH:MM.';
    case 'portoReprocessDays':
      return isInteger(n) && n >= 0 && n <= 7 ? null : 'Os dias reprocessados pelo robô devem ser um número inteiro entre 0 e 7.';
    case 'portoMaxShiftHours':
      return n >= 1 && n <= 24 ? null : 'O máximo de horas por dia deve ficar entre 1 e 24.';
    case 'portoNextMonthLookaheadDays':
      return isInteger(n) && n >= 0 && n <= 28 ? null : 'A antecedência da escala do mês seguinte deve ser um número inteiro de 0 a 28 dias.';
    case 'portoFullDayOffPercent':
      return n >= 50 && n <= 100 ? null : 'O percentual para contar folga integral deve ficar entre 50 e 100.';
    case 'portoWarningText':
      return typeof value === 'string' && (value.trim() || !all.portoWarningEnabled) ? null : 'Escreva o texto da advertência (ou desligue a advertência).';
    case 'portoAlertPhone': {
      const digits = String(value).replace(/\D/g, '');
      return !digits || (digits.length >= 10 && digits.length <= 13) ? null : 'O WhatsApp para alertas precisa de DDD e número (ou fica vazio).';
    }
    case 'financeDueSoonDays':
      return isInteger(n) && n >= 0 && n <= 60 ? null : 'O aviso de vencimento deve ser um número inteiro de 0 a 60 dias.';
    case 'financeCategories': {
      const categories = value as string[];
      if (!categories.length) return 'Informe ao menos uma categoria de despesa.';
      const normalized = categories.map((category) => category.toLocaleLowerCase('pt-BR'));
      return new Set(normalized).size === normalized.length ? null : 'Duas categorias de despesa não podem ter o mesmo nome.';
    }
    default:
      return null;
  }
}

/** Strict: for what the admin submits. Returns every field validated, or the first error message. */
export function parseOrganizationSettingsInput(body: unknown): { settings: OrganizationSettings; error?: undefined } | { error: string; settings?: undefined } {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const parsed = parseFields(source);
  const keys = Object.keys(DEFAULT_ORGANIZATION_SETTINGS) as Array<keyof OrganizationSettings>;

  const missing = keys.find((key) => parsed[key] === null || parsed[key] === undefined);
  if (missing) {
    return { error: MISSING_FIELD_MESSAGES[missing] };
  }

  const settings = parsed as OrganizationSettings;
  for (const key of keys) {
    const error = validateField(key, settings[key], settings);
    if (error) return { error };
  }

  if (minutesOf(settings.defaultShiftEnd) <= minutesOf(settings.defaultShiftStart)) {
    return { error: 'O fim do turno padrão deve ser depois do início.' };
  }

  return {
    settings: {
      ...settings,
      serviceAwardTiers: [...settings.serviceAwardTiers].sort((a, b) => a.minServices - b.minServices),
    },
  };
}

const MISSING_FIELD_MESSAGES: Record<keyof OrganizationSettings, string> = {
  commissionPercentage: 'O percentual de comissão deve estar entre 0 e 100.',
  baseSalary: 'Salário, VA e VR não podem ser negativos.',
  vaAllowance: 'Salário, VA e VR não podem ser negativos.',
  vrAllowance: 'Salário, VA e VR não podem ser negativos.',
  monthlyHours: 'A jornada mensal deve ser maior que zero (até 744 horas).',
  overtimeMultiplier: 'O adicional de hora extra deve ficar entre 1 (sem adicional) e 5.',
  dailyBreakMinutes: 'O intervalo diário deve ser um número inteiro de minutos entre 0 e 240.',
  defaultShiftStart: 'O turno padrão precisa de início e fim no formato HH:MM.',
  defaultShiftEnd: 'O turno padrão precisa de início e fim no formato HH:MM.',
  monthlyHoursWarningFloor: 'O alerta de horas deve ficar entre 0 e a jornada mensal.',
  fortnightSplitDay: 'O último dia da Q1 deve ser um dia entre 1 e 27.',
  chargeCancelledServicePlanned: 'Escolha se o dia de serviço cancelado cobra as horas previstas.',
  serviceAwardTiers: 'Cada faixa de prêmio precisa de quantidade de OS e valor maiores que zero.',
  portoHoursImportTime: 'Os horários do robô do Porto precisam estar no formato HH:MM.',
  portoScheduleImportTime: 'Os horários do robô do Porto precisam estar no formato HH:MM.',
  portoReprocessDays: 'Os dias reprocessados pelo robô devem ser um número inteiro entre 0 e 7.',
  portoMaxShiftHours: 'O máximo de horas por dia deve ficar entre 1 e 24.',
  portoNextMonthLookaheadDays: 'A antecedência da escala do mês seguinte deve ser um número inteiro de 0 a 28 dias.',
  portoFullDayOffPercent: 'O percentual para contar folga integral deve ficar entre 50 e 100.',
  portoUseLaudoConclusion: 'Escolha se a conclusão do laudo pode ser usada sem assinatura.',
  portoWarningEnabled: 'Escolha se a advertência fica ligada.',
  portoWarningText: 'Escreva o texto da advertência (ou desligue a advertência).',
  portoRecordCancelledDays: 'Escolha se os dias de serviço cancelado são registrados.',
  portoAlertPhone: 'O WhatsApp para alertas precisa de DDD e número (ou fica vazio).',
  financeDueSoonDays: 'O aviso de vencimento deve ser um número inteiro de 0 a 60 dias.',
  financeCategories: 'Informe ao menos uma categoria de despesa.',
};

/** The award of the highest tier reached in the month, or 0 when none was reached. */
export function calculateServiceAward(serviceCount: number, tiers: ServiceAwardTier[]): number {
  let award = 0;
  for (const tier of [...tiers].sort((a, b) => a.minServices - b.minServices)) {
    if (serviceCount >= tier.minServices) award = tier.amount;
  }
  return award;
}

/** The technician's own value when it's set (> 0), otherwise the organization default. */
export function valueOrDefault(technicianValue: unknown, fallback: number): number {
  const value = Number(technicianValue);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Hours worked net of the daily break — only taken when the day's span exceeds the break itself. */
export function netOfDailyBreak(grossHours: number, dailyBreakMinutes: number): number {
  const breakHours = dailyBreakMinutes / 60;
  return grossHours > breakHours ? grossHours - breakHours : grossHours;
}

/** Overtime value: hours over the monthly target × (base salary ÷ target) × multiplier. */
export function calculateOvertimeValue(totalHours: number, baseSalary: number, settings: Pick<OrganizationSettings, 'monthlyHours' | 'overtimeMultiplier'>): number {
  const extraHours = Math.max(0, totalHours - settings.monthlyHours);
  if (!extraHours || !(baseSalary > 0)) return 0;
  return Number((extraHours * (baseSalary / settings.monthlyHours) * settings.overtimeMultiplier).toFixed(2));
}

/** "Q1" or "Q2" for a day of the month, by the configured split day. */
export function fortnightForDay(dayOfMonth: number, fortnightSplitDay: number): 'Q1' | 'Q2' {
  return dayOfMonth <= fortnightSplitDay ? 'Q1' : 'Q2';
}

/** The full warning note sentence, with the fixed marker and the service code filled in. */
export function buildPortoWarningNote(text: string, serviceCode: string): string {
  return `${PORTO_WARNING_MARKER} ${text.split('{servico}').join(serviceCode)}`;
}

/** Overtime multiplier ↔ the percentage shown on screen (1.5 ↔ 50). */
export const overtimePercentFromMultiplier = (multiplier: number) => Number(((multiplier - 1) * 100).toFixed(2));
export const overtimeMultiplierFromPercent = (percent: number) => Number((1 + percent / 100).toFixed(4));
