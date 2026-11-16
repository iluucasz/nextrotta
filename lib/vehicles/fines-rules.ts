// Rules of the fines (multas) of the Carros app. Dependency-free: read by the API, the screens and the tests.
import { dueState, type DueState } from './rules';

export const APPEAL_STATUSES = ['none', 'planned', 'filed', 'won', 'lost'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const APPEAL_LABELS: Record<AppealStatus, string> = {
  none: 'Sem recurso',
  planned: 'Vamos recorrer',
  filed: 'Recurso enviado',
  won: 'Recurso ganho',
  lost: 'Recurso negado',
};

export const DRIVER_STANCES = ['agrees', 'disputes'] as const;
export type DriverStance = (typeof DRIVER_STANCES)[number];

export const STANCE_LABELS: Record<DriverStance, string> = {
  agrees: 'Concorda',
  disputes: 'Não concorda',
};

/**
 * Days to name the driver, counted from the day the company got the notification. The notification itself states the
 * deadline (the law gives 30 days; some companies want an earlier internal one), so the screen lets it be changed.
 */
export const DEFAULT_INDICATION_DAYS = 30;

/** How many days before the deadline to name the driver the fine starts showing as urgent. */
export const INDICATION_WARNING_DAYS = 5;

/** Where a fine is in its life. The order is the order the work is done. */
export const FINE_STAGES = ['to_identify', 'to_notify', 'awaiting_ack', 'to_indicate', 'appeal', 'to_pay', 'resolved'] as const;
export type FineStage = (typeof FINE_STAGES)[number];

export const FINE_STAGE_LABELS: Record<FineStage, string> = {
  to_identify: 'Definir o condutor',
  to_notify: 'Avisar o prestador',
  awaiting_ack: 'Esperando o ciente',
  to_indicate: 'Indicar o condutor',
  appeal: 'Em recurso',
  to_pay: 'Pagar',
  resolved: 'Resolvida',
};

export type FineState = {
  technicianId: string | null;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  indicatedAt: string | null;
  appealStatus: AppealStatus;
  paidAt: string | null;
  indicationDeadline: string | null;
};

/** The next thing that has to happen to the fine, or "resolved" when nothing is left. */
export function fineStage(fine: FineState): FineStage {
  if (fine.appealStatus === 'won') return 'resolved';
  if (!fine.technicianId) return 'to_identify';
  if (!fine.notifiedAt) return 'to_notify';
  if (!fine.acknowledgedAt) return 'awaiting_ack';
  if (!fine.indicatedAt) return 'to_indicate';
  if (fine.appealStatus === 'planned' || fine.appealStatus === 'filed') return 'appeal';
  if (!fine.paidAt) return 'to_pay';
  return 'resolved';
}

/** Whether the deadline to name the driver is near or gone. Only a fine still waiting for the indication has one. */
export function indicationState(fine: FineState, today: string): DueState {
  if (fine.indicatedAt || fine.appealStatus === 'won') return 'none';
  return dueState(fine.indicationDeadline, today, INDICATION_WARNING_DAYS);
}

export function addDaysToKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The Monday of the week of a date (YYYY-MM-DD): the reminder to look up the fines comes once per week. */
export function weekStart(dateKey: string): string {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysToKey(dateKey, -((weekday + 6) % 7));
}

export type Stretch ={ technicianId: string; assignedAt: string; releasedAt: string | null };

/**
 * Who had the car at the moment of the infraction, from the car's history (a stretch opens when it goes to a technician
 * and closes when it leaves). Null when nobody had it then, so the admin picks the driver by hand.
 */
export function suggestDriver(stretches: Stretch[], infractionAt: string): string | null {
  const moment = Date.parse(infractionAt);
  if (Number.isNaN(moment)) return null;
  const match = stretches
    .filter((stretch) => Date.parse(stretch.assignedAt) <= moment && (!stretch.releasedAt || moment < Date.parse(stretch.releasedAt)))
    // A stretch opened later wins if two overlap (a hand-over on the same instant).
    .sort((a, b) => Date.parse(b.assignedAt) - Date.parse(a.assignedAt))[0];
  return match?.technicianId ?? null;
}

export type FineSummary = { open: number; urgent: number; toPay: number; toPayAmount: number };

export function summarizeFines(
  fines: Array<FineState & { amount: number }>,
  today: string,
): FineSummary {
  const summary: FineSummary = { open: 0, urgent: 0, toPay: 0, toPayAmount: 0 };
  for (const fine of fines) {
    const stage = fineStage(fine);
    if (stage === 'resolved') continue;
    summary.open += 1;
    const state = indicationState(fine, today);
    if (state === 'soon' || state === 'overdue') summary.urgent += 1;
    if (!fine.paidAt && fine.appealStatus !== 'won') {
      summary.toPay += 1;
      summary.toPayAmount += fine.amount;
    }
  }
  summary.toPayAmount = Math.round(summary.toPayAmount * 100) / 100;
  return summary;
}

export type FineInput = {
  vehicleId: string;
  technicianId: string | null;
  aitNumber: string | null;
  /** ISO instant (the form sends Brasília local time, converted here). */
  infractionAt: string;
  description: string;
  location: string | null;
  authority: string | null;
  amount: number;
  points: number | null;
  receivedOn: string | null;
  indicationDeadline: string | null;
  paymentDue: string | null;
  appealStatus: AppealStatus;
  notes: string | null;
  /** Progress the admin records by hand. */
  indicated: boolean;
  paid: boolean;
  paidOn: string | null;
  acknowledged: boolean;
};

const text = (value: unknown, max: number): string | null => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : null;
};

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** "2026-11-16T14:30" (what the form sends, Brasília time) or a full ISO instant -> ISO instant, or null when invalid. */
export function parseInfractionMoment(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const local = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(raw);
  const iso = local ? `${local[1]}T${local[2]}:00-03:00` : raw;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** "130,16", "1.234,56" or "130.16" -> 130.16; null when it is not a money amount. */
export function parseAmount(value: unknown): number | null {
  const raw = String(value ?? '').trim().replace(/^R\$\s*/i, '');
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100) / 100;
}

/**
 * Cleans what the form sent. `partial` (an edit or a progress step) only checks the fields that came; a create needs the
 * car, the moment, what the infraction was and the amount.
 */
export function parseFineInput(body: Record<string, unknown>, partial = false): { value: Partial<FineInput> } | { error: string } {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const out: Partial<FineInput> = {};

  if (!partial || has('vehicleId')) {
    const vehicleId = String(body.vehicleId ?? '').trim();
    if (!vehicleId) return { error: 'Escolha o carro.' };
    out.vehicleId = vehicleId;
  }
  if (!partial || has('infractionAt')) {
    const moment = parseInfractionMoment(body.infractionAt);
    if (!moment) return { error: 'Informe a data e a hora da infração.' };
    out.infractionAt = moment;
  }
  if (!partial || has('description')) {
    const description = text(body.description, 300);
    if (!description) return { error: 'Descreva a infração.' };
    out.description = description;
  }
  if (!partial || has('amount')) {
    const amount = parseAmount(body.amount);
    if (amount === null) return { error: 'Valor da multa inválido.' };
    out.amount = amount;
  }
  if (has('technicianId')) out.technicianId = text(body.technicianId, 64);
  if (has('aitNumber')) out.aitNumber = text(body.aitNumber, 40)?.toUpperCase() ?? null;
  if (has('location')) out.location = text(body.location, 200);
  if (has('authority')) out.authority = text(body.authority, 120);
  if (has('notes')) out.notes = text(body.notes, 1000);
  if (has('points')) {
    const raw = String(body.points ?? '').trim();
    if (!raw) out.points = null;
    else {
      const points = Number(raw);
      if (!Number.isInteger(points) || points < 0 || points > 20) return { error: 'Pontos inválidos (de 0 a 20).' };
      out.points = points;
    }
  }
  for (const [key, label] of [
    ['receivedOn', 'em que a empresa recebeu a notificação'],
    ['indicationDeadline', 'limite para indicar o condutor'],
    ['paymentDue', 'de vencimento da multa'],
    ['paidOn', 'do pagamento'],
  ] as const) {
    if (has(key)) {
      const raw = String(body[key] ?? '').trim();
      if (raw && !isDate(raw)) return { error: `Data ${label} inválida.` };
      out[key] = raw || null;
    }
  }
  if (has('appealStatus')) {
    if (!APPEAL_STATUSES.includes(body.appealStatus as AppealStatus)) return { error: 'Situação do recurso inválida.' };
    out.appealStatus = body.appealStatus as AppealStatus;
  }
  for (const key of ['indicated', 'paid', 'acknowledged'] as const) {
    if (has(key)) out[key] = body[key] === true;
  }

  // The deadline follows the day the notification arrived unless someone wrote a different one.
  if (!partial && out.receivedOn && !has('indicationDeadline')) {
    out.indicationDeadline = addDaysToKey(out.receivedOn, DEFAULT_INDICATION_DAYS);
  }
  return { value: out };
}

/** What a technician answers about a fine: agrees, or does not (and says why). */
export function parseDriverResponse(body: Record<string, unknown>): { value: { stance: DriverStance; note: string | null } } | { error: string } {
  const stance = body.stance;
  if (!DRIVER_STANCES.includes(stance as DriverStance)) return { error: 'Diga se concorda ou não com a multa.' };
  const note = text(body.note, 500);
  if (stance === 'disputes' && (!note || note.length < 3)) return { error: 'Conte por que você não concorda com a multa.' };
  return { value: { stance: stance as DriverStance, note } };
}
