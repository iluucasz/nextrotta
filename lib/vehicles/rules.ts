// Rules of the Carros app. Dependency-free: read by the API, the screen and the tests.

export const VEHICLE_STATUSES = ['active', 'maintenance', 'inactive'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  active: 'Em uso',
  maintenance: 'Na oficina',
  inactive: 'Parado',
};

/** How many days before a due date (licensing, insurance) the car starts showing as "vence em breve". */
export const DUE_WARNING_DAYS = 30;

/** Upper case, letters and digits only: "abc-1d23" becomes "ABC1D23". */
export function normalizePlate(input: unknown): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Old (ABC1234) or Mercosul (ABC1D23). */
export function isValidPlate(plate: string): boolean {
  return /^[A-Z]{3}\d{4}$/.test(plate) || /^[A-Z]{3}\d[A-Z]\d{2}$/.test(plate);
}

/** "ABC1D23" -> "ABC-1D23" (the way it is read out loud and written on the paperwork). */
export function formatPlate(plate: string): string {
  return plate.length === 7 ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate;
}

export function normalizeRenavam(input: unknown): string {
  return String(input ?? '').replace(/\D/g, '');
}

/** Chassis (VIN): 17 characters, never I, O or Q. */
export function normalizeChassis(input: unknown): string {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export type DueState = 'none' | 'ok' | 'soon' | 'overdue';

/** Where a due date (YYYY-MM-DD) stands against today (YYYY-MM-DD, Brasília). */
export function dueState(due: string | null | undefined, today: string, warningDays = DUE_WARNING_DAYS): DueState {
  if (!due) return 'none';
  if (due < today) return 'overdue';
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + warningDays);
  return due <= limit.toISOString().slice(0, 10) ? 'soon' : 'ok';
}

export type VehicleInput = {
  plate: string;
  brand: string | null;
  model: string;
  year: number | null;
  color: string | null;
  renavam: string | null;
  chassis: string | null;
  fuel: string | null;
  odometer: number | null;
  licensingDue: string | null;
  insuranceDue: string | null;
  notes: string | null;
  status: VehicleStatus;
};

const text = (value: unknown, max: number): string | null => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : null;
};

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * Cleans what the form sent. `partial` (an edit) only checks the fields that came; a create needs plate and model.
 * Returns the first problem in plain language, or the cleaned values (only the fields present when partial).
 */
export function parseVehicleInput(body: Record<string, unknown>, partial = false): { value: Partial<VehicleInput> } | { error: string } {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const out: Partial<VehicleInput> = {};

  if (!partial || has('plate')) {
    const plate = normalizePlate(body.plate);
    if (!isValidPlate(plate)) return { error: 'Placa inválida. Use o formato ABC-1234 ou ABC-1D23.' };
    out.plate = plate;
  }
  if (!partial || has('model')) {
    const model = text(body.model, 80);
    if (!model) return { error: 'Informe o modelo do carro.' };
    out.model = model;
  }
  if (has('brand')) out.brand = text(body.brand, 60);
  if (has('color')) out.color = text(body.color, 40);
  if (has('fuel')) out.fuel = text(body.fuel, 30);
  if (has('notes')) out.notes = text(body.notes, 1000);

  if (has('year')) {
    const raw = String(body.year ?? '').trim();
    if (!raw) out.year = null;
    else {
      const year = Number(raw);
      if (!Number.isInteger(year) || year < 1950 || year > 2100) return { error: 'Ano inválido.' };
      out.year = year;
    }
  }
  if (has('odometer')) {
    const raw = String(body.odometer ?? '').trim();
    if (!raw) out.odometer = null;
    else {
      const km = Number(raw.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(km) || km < 0 || km > 5_000_000) return { error: 'Quilometragem inválida.' };
      out.odometer = Math.round(km);
    }
  }
  if (has('renavam')) {
    const renavam = normalizeRenavam(body.renavam);
    if (renavam && (renavam.length < 9 || renavam.length > 11)) return { error: 'Renavam inválido: são de 9 a 11 números.' };
    out.renavam = renavam || null;
  }
  if (has('chassis')) {
    const chassis = normalizeChassis(body.chassis);
    if (chassis && (chassis.length !== 17 || /[IOQ]/.test(chassis))) return { error: 'Chassi inválido: são 17 caracteres, sem as letras I, O e Q.' };
    out.chassis = chassis || null;
  }
  for (const [key, label] of [
    ['licensingDue', 'do licenciamento'],
    ['insuranceDue', 'do seguro'],
  ] as const) {
    if (has(key)) {
      const raw = String(body[key] ?? '').trim();
      if (raw && !isDate(raw)) return { error: `Data ${label} inválida.` };
      out[key] = raw || null;
    }
  }
  if (has('status')) {
    if (!VEHICLE_STATUSES.includes(body.status as VehicleStatus)) return { error: 'Situação inválida.' };
    out.status = body.status as VehicleStatus;
  }
  return { value: out };
}
