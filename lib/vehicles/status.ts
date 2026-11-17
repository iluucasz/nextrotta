// What the Carros screen says first: where the fleet (or the fines) stands in a sentence, and each thing that needs a look with the
// move that fixes it. Dependency-free: read by the screen and the tests (the screen only draws).
import { fineStage, indicationState, type FineState } from './fines-rules';
import { dueState, formatPlate, type DueState } from './rules';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/** What a button on the status card or on a problem row does. */
export type StatusAction =
  | { kind: 'add-car' }
  | { kind: 'add-fine' }
  | { kind: 'car'; carId: string }
  | { kind: 'fine'; fineId: string }
  | { kind: 'fines' }
  | { kind: 'cars' };

export type Problem = { key: string; tone: 'warning' | 'danger'; title: string; actionLabel: string; action: StatusAction };

export type StatusCard = { tone: Tone; headline: string; detail: string; cta: { label: string; action: StatusAction } | null };

export type CarLite = {
  id: string;
  plate: string;
  technicianId: string | null;
  licensingDue: string | null;
  insuranceDue: string | null;
  finesCheckStatus: 'ok' | 'partial' | 'error' | 'missing_data' | null;
  finesCheckMessage: string | null;
};

export type FineLite = FineState & {
  id: string;
  plate: string;
  technicianName: string | null;
  driverStance: 'agrees' | 'disputes' | null;
  amount: number;
};

const brDay = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Everything that needs a look, the most serious first (a danger before a warning; inside each, in the order found). */
export function fleetProblems(input: { cars: CarLite[]; fines: FineLite[]; today: string; lookupEnabled: boolean }): Problem[] {
  const { cars, fines, today, lookupEnabled } = input;
  const found: Problem[] = [];

  for (const fine of fines) {
    if (fineStage(fine) === 'resolved') continue;
    const state = indicationState(fine, today);
    const plate = formatPlate(fine.plate);
    if (state === 'overdue') {
      found.push({ key: `indicate:${fine.id}`, tone: 'danger', title: `Prazo vencido para indicar o condutor da multa do ${plate}`, actionLabel: 'Abrir a multa', action: { kind: 'fine', fineId: fine.id } });
    } else if (state === 'soon') {
      found.push({ key: `indicate:${fine.id}`, tone: 'warning', title: `Indique o condutor da multa do ${plate} até ${brDay(fine.indicationDeadline as string)}`, actionLabel: 'Abrir a multa', action: { kind: 'fine', fineId: fine.id } });
    }
    if (fine.driverStance === 'disputes') {
      found.push({ key: `disputes:${fine.id}`, tone: 'warning', title: `${fine.technicianName ?? 'O prestador'} não concorda com a multa do ${plate}`, actionLabel: 'Ver o motivo', action: { kind: 'fine', fineId: fine.id } });
    }
  }

  for (const car of cars) {
    const plate = formatPlate(car.plate);
    for (const [label, due] of [['Licenciamento', car.licensingDue], ['Seguro', car.insuranceDue]] as const) {
      const state: DueState = dueState(due, today);
      if (state === 'overdue') found.push({ key: `due:${car.id}:${label}`, tone: 'danger', title: `${label} vencido: ${plate}`, actionLabel: 'Abrir o carro', action: { kind: 'car', carId: car.id } });
      else if (state === 'soon') found.push({ key: `due:${car.id}:${label}`, tone: 'warning', title: `${label} do ${plate} vence em ${brDay(due as string)}`, actionLabel: 'Abrir o carro', action: { kind: 'car', carId: car.id } });
    }
    if (lookupEnabled && (car.finesCheckStatus === 'missing_data' || car.finesCheckStatus === 'error')) {
      found.push({ key: `lookup:${car.id}`, tone: 'warning', title: `${plate}: ${car.finesCheckMessage ?? 'a consulta de multas não funcionou'}`, actionLabel: 'Completar', action: { kind: 'car', carId: car.id } });
    }
  }

  return [...found.filter((problem) => problem.tone === 'danger'), ...found.filter((problem) => problem.tone === 'warning')];
}

/** The status card of the Carros tab. */
export function carsStatus(cars: CarLite[], problems: Problem[]): StatusCard {
  if (cars.length === 0) {
    return { tone: 'neutral', headline: 'Nenhum carro cadastrado', detail: 'Cadastre o primeiro para saber quem está com cada carro.', cta: { label: 'Adicionar carro', action: { kind: 'add-car' } } };
  }
  if (problems.length) {
    const urgent = problems.filter((problem) => problem.tone === 'danger').length;
    const rest = problems.length - urgent;
    // The rows below carry each problem and its button; the card only sums them up.
    return {
      tone: urgent ? 'danger' : 'warning',
      headline: problems.length === 1 ? '1 coisa precisa de você' : `${problems.length} coisas precisam de você`,
      detail: [urgent ? `${urgent} ${plural(urgent, 'urgente', 'urgentes')}` : '', rest ? `${rest} para acompanhar` : ''].filter(Boolean).join(' e ') + '.',
      cta: null,
    };
  }
  const withTechnician = cars.filter((car) => car.technicianId).length;
  return {
    tone: 'success',
    headline: 'Frota em dia',
    detail: `${cars.length} ${plural(cars.length, 'carro', 'carros')}, ${withTechnician === cars.length ? 'todos com técnico' : `${withTechnician} com técnico`}. Nada vencendo.`,
    cta: null,
  };
}

/** The status card of the Multas tab. `fines` is what the company has, in any stage. */
export function finesStatus(fines: FineLite[], today: string, lookupEnabled: boolean): StatusCard {
  if (fines.length === 0) {
    return {
      tone: 'neutral',
      headline: 'Nenhuma multa registrada',
      detail: lookupEnabled ? 'O sistema consulta os carros toda semana e registra as multas novas.' : 'Registre cada multa que aparecer para acompanhar os prazos.',
      cta: { label: 'Registrar multa', action: { kind: 'add-fine' } },
    };
  }
  const open = fines.filter((fine) => fineStage(fine) !== 'resolved');
  if (open.length === 0) {
    return { tone: 'success', headline: 'Nenhuma multa em aberto', detail: `${fines.length} ${plural(fines.length, 'multa resolvida', 'multas resolvidas')}.`, cta: null };
  }
  const toPay = open.filter((fine) => !fine.paidAt && fine.appealStatus !== 'won');
  const owed = Math.round(toPay.reduce((sum, fine) => sum + fine.amount, 0) * 100) / 100;
  const detail = toPay.length ? `${money(owed)} a pagar em ${toPay.length} ${plural(toPay.length, 'multa', 'multas')}.` : 'Nada a pagar agora.';
  const urgent = open
    .filter((fine) => ['soon', 'overdue'].includes(indicationState(fine, today)))
    .sort((a, b) => String(a.indicationDeadline).localeCompare(String(b.indicationDeadline)));
  if (urgent.length) {
    const overdue = urgent.filter((fine) => indicationState(fine, today) === 'overdue').length;
    const soon = urgent.length - overdue;
    return {
      tone: 'danger',
      headline: overdue
        ? `${overdue} ${plural(overdue, 'multa passou', 'multas passaram')} do prazo de indicar o condutor`
        : `${soon} ${plural(soon, 'multa com prazo', 'multas com prazo')} para indicar o condutor acabando`,
      detail: [overdue && soon ? `${soon} ${plural(soon, 'está com o prazo acabando.', 'estão com o prazo acabando.')}` : '', detail].filter(Boolean).join(' '),
      cta: null,
    };
  }
  return { tone: 'warning', headline: `${open.length} ${plural(open.length, 'multa em aberto', 'multas em aberto')}`, detail, cta: null };
}

export type DueItem = { carId: string; plate: string; label: 'Licenciamento' | 'Seguro'; date: string; state: DueState };

/** The next papers to expire (or already expired), soonest first, for the side panel. */
export function nextDues(cars: CarLite[], today: string, limit = 6): DueItem[] {
  const items: DueItem[] = [];
  for (const car of cars) {
    for (const [label, date] of [['Licenciamento', car.licensingDue], ['Seguro', car.insuranceDue]] as const) {
      if (date) items.push({ carId: car.id, plate: car.plate, label, date, state: dueState(date, today) });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, limit);
}

export type RunLite = { kind: 'weekly' | 'manual'; status: 'running' | 'ok' | 'partial' | 'error'; startedAt: string; cars: number; created: number; failed: number; message: string | null };

/** "16/11 08:05" in Brasília time. */
export function shortDateTime(iso: string): string {
  const local = new Date(Date.parse(iso) - 3 * 3_600_000).toISOString();
  return `${local.slice(8, 10)}/${local.slice(5, 7)} ${local.slice(11, 16)}`;
}

/** One line of the history of lookups, in words: who started it, when, and what came of it. */
export function describeRun(run: RunLite): { title: string; detail: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  const title = `${run.kind === 'weekly' ? 'Automática (domingo)' : 'Manual'} · ${shortDateTime(run.startedAt)}`;
  if (run.status === 'running') return { title, detail: 'Consultando…', tone: 'neutral' };
  if (run.status === 'error') return { title, detail: run.message || 'Não foi possível consultar.', tone: 'danger' };
  if (run.cars === 0) return { title, detail: run.message || 'Nenhum carro para consultar.', tone: 'neutral' };
  const found = run.created ? `${run.created} ${plural(run.created, 'multa nova', 'multas novas')}` : 'nenhuma multa nova';
  const failed = run.failed ? ` · ${run.failed} sem resposta` : '';
  return { title, detail: `${run.cars} ${plural(run.cars, 'carro consultado', 'carros consultados')} · ${found}${failed}`, tone: run.status === 'partial' ? 'warning' : 'success' };
}

/** The latest time any car had its fines looked up, for "Última consulta". */
export function lastLookup(cars: Array<{ finesCheckedAt: string | null }>): string | null {
  return cars.reduce<string | null>((latest, car) => (car.finesCheckedAt && (!latest || car.finesCheckedAt > latest) ? car.finesCheckedAt : latest), null);
}
