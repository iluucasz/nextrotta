// What the Carros screen says first: where the fleet (or the fines) stands in a sentence, and each thing that needs a look with the
// move that fixes it. Dependency-free: read by the screen and the tests (the screen only draws).
import { fineStage, indicationState, type FineState } from './fines-rules';
import { dueState, formatPlate, isValidRenavam, type DueState } from './rules';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

/** What a button on the status card or on a problem row does. */
export type StatusAction =
  | { kind: 'add-car' }
  | { kind: 'add-fine' }
  | { kind: 'car'; carId: string }
  | { kind: 'fine'; fineId: string }
  | { kind: 'fines' }
  | { kind: 'cars' }
  | { kind: 'alerts' };

/** What a problem is about: it decides the section of the Avisos tab. */
export type ProblemGroup = 'deadlines' | 'papers' | 'lookup';

export const PROBLEM_GROUP_LABEL: Record<ProblemGroup, string> = {
  deadlines: 'Multas e prazos',
  papers: 'Documentos dos carros',
  lookup: 'Consulta automática de multas',
};

export type Problem = {
  key: string;
  group: ProblemGroup;
  tone: 'warning' | 'danger';
  title: string;
  actionLabel: string;
  action: StatusAction;
  /** When one row speaks for several cars (the ones missing their Renavam), each of them, to open one by one. */
  cars?: Array<{ id: string; plate: string }>;
};

export type StatusCard = { tone: Tone; headline: string; detail: string; cta: { label: string; action: StatusAction } | null };

export type CarLite = {
  id: string;
  plate: string;
  technicianId: string | null;
  licensingDue: string | null;
  insuranceDue: string | null;
  finesCheckStatus: 'ok' | 'partial' | 'error' | 'missing_data' | 'refused' | null;
  finesCheckMessage: string | null;
  /** The data the lookup needs. When these keys are present, what is missing is read from them, never from an old lookup result. */
  renavam?: string | null;
  state?: string | null;
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
      found.push({ key: `indicate:${fine.id}`, group: 'deadlines', tone: 'danger', title: `Prazo vencido para indicar o condutor da multa do ${plate}`, actionLabel: 'Abrir a multa', action: { kind: 'fine', fineId: fine.id } });
    } else if (state === 'soon') {
      found.push({ key: `indicate:${fine.id}`, group: 'deadlines', tone: 'warning', title: `Indique o condutor da multa do ${plate} até ${brDay(fine.indicationDeadline as string)}`, actionLabel: 'Abrir a multa', action: { kind: 'fine', fineId: fine.id } });
    }
    if (fine.driverStance === 'disputes') {
      found.push({ key: `disputes:${fine.id}`, group: 'deadlines', tone: 'warning', title: `${fine.technicianName ?? 'O prestador'} não concorda com a multa do ${plate}`, actionLabel: 'Ver o motivo', action: { kind: 'fine', fineId: fine.id } });
    }
  }

  for (const car of cars) {
    const plate = formatPlate(car.plate);
    for (const [label, due] of [['Licenciamento', car.licensingDue], ['Seguro', car.insuranceDue]] as const) {
      const state: DueState = dueState(due, today);
      if (state === 'overdue') found.push({ key: `due:${car.id}:${label}`, group: 'papers', tone: 'danger', title: `${label} vencido: ${plate}`, actionLabel: 'Abrir o carro', action: { kind: 'car', carId: car.id } });
      else if (state === 'soon') found.push({ key: `due:${car.id}:${label}`, group: 'papers', tone: 'warning', title: `${label} do ${plate} vence em ${brDay(due as string)}`, actionLabel: 'Abrir o carro', action: { kind: 'car', carId: car.id } });
    }
  }

  if (lookupEnabled) {
    // What is missing is read from the car's data now, not from the result of the last lookup (which only changes at the next one).
    const knowsData = (car: CarLite) => 'renavam' in car || 'state' in car;
    const missing = cars.filter((car) => knowsData(car) && (!car.renavam || !car.state));
    const wrong = cars.filter((car) => knowsData(car) && car.renavam && car.state && (!isValidRenavam(car.renavam) || car.finesCheckStatus === 'refused'));
    const failed = cars.filter((car) => car.finesCheckStatus === 'error' && !missing.includes(car) && !wrong.includes(car));

    const group = (list: CarLite[], key: string, one: (plate: string) => string, many: (count: number) => string): Problem | null =>
      list.length
        ? {
            key,
            group: 'lookup',
            tone: 'warning',
            title: list.length === 1 ? one(formatPlate(list[0].plate)) : many(list.length),
            actionLabel: 'Completar',
            action: { kind: 'car', carId: list[0].id },
            cars: list.map((car) => ({ id: car.id, plate: car.plate })),
          }
        : null;

    const missingRow = group(missing, 'lookup:missing', (plate) => `${plate} está sem Renavam ou estado: a consulta automática não o alcança`, (count) => `${count} carros sem Renavam ou estado: a consulta automática não os alcança`);
    const wrongRow = group(wrong, 'lookup:wrong', (plate) => `A placa ou o Renavam de ${plate} parece errado: confira no documento do carro`, (count) => `${count} carros com placa ou Renavam que parece errado: confira nos documentos`);
    if (missingRow) found.push(missingRow);
    if (wrongRow) found.push(wrongRow);
    for (const car of failed) {
      found.push({
        key: `lookup:${car.id}`,
        group: 'lookup',
        tone: 'warning',
        title: `${formatPlate(car.plate)}: ${car.finesCheckMessage ?? 'a consulta de multas não funcionou'}`,
        actionLabel: 'Abrir o carro',
        action: { kind: 'car', carId: car.id },
      });
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

export const RUN_STATUS_LABEL = { running: 'Em andamento', ok: 'Concluída', partial: 'Com falhas', error: 'Falhou' } as const;

export type RunLite = { kind: 'weekly' | 'manual'; status: 'running' | 'ok' | 'partial' | 'error'; startedAt: string; cars: number; created: number; failed: number; message: string | null };

/**
 * What one agency said about one car in a lookup. `unavailable`: the query is not set up on the platform yet (never the company's
 * problem, so the screen leaves it out); `deferred`: not asked because this lookup ran out of time.
 */
export type RunSourceDetail = {
  label: string;
  result: 'ok' | 'failed' | 'unavailable' | 'deferred';
  /** Fines the agency listed for the car (already registered or not). */
  found: number;
  /** The ones that were new to the company: registered by this lookup. */
  created: Array<{ ait: string; description: string; amount: number }>;
  message: string | null;
};
export type RunCarDetail = { plate: string; sources: RunSourceDetail[] };
export type RunDetails = { cars: RunCarDetail[] };

/** One agency's answer in words, with the tone of its dot. */
export function describeSource(source: RunSourceDetail): { tone: Tone; text: string } {
  switch (source.result) {
    case 'ok': {
      if (source.found === 0) return { tone: 'success', text: 'Consultou: nenhuma multa.' };
      const news = source.created.length
        ? `${source.created.length} ${plural(source.created.length, 'nova', 'novas')}`
        : 'nenhuma nova (já estavam registradas)';
      return { tone: source.created.length ? 'warning' : 'success', text: `Consultou: ${source.found} ${plural(source.found, 'multa', 'multas')}, ${news}.` };
    }
    case 'failed':
      // The message already starts with the agency's name ("Detran-SP: ..."), and the line shows the name beside it.
      return { tone: 'danger', text: source.message ? source.message.replace(`${source.label}: `, '') : 'Não respondeu.' };
    case 'deferred':
      return { tone: 'neutral', text: 'Ficou para a próxima verificação (acabou o tempo desta).' };
    default:
      return { tone: 'neutral', text: 'Consulta ainda não disponível.' };
  }
}

/** The agencies worth showing the company: the ones not yet set up on the platform are left out. */
export const visibleSources = (car: RunCarDetail): RunSourceDetail[] => car.sources.filter((source) => source.result !== 'unavailable');

/** Cars that no agency could be asked about yet (all of them unavailable). */
export const carsWithoutLookup = (details: RunDetails): RunCarDetail[] => details.cars.filter((car) => visibleSources(car).length === 0);

/** How many cars in a lookup had something to look at: a new fine or an agency that failed. For the headline of the window. */
export function runHighlights(details: RunDetails): { withNewFines: number; withFailures: number } {
  const visible = details.cars.map(visibleSources);
  return {
    withNewFines: visible.filter((sources) => sources.some((source) => source.created.length > 0)).length,
    withFailures: visible.filter((sources) => sources.some((source) => source.result === 'failed')).length,
  };
}

/** Cars with a fine still open, by car id: what the list of cars flags so the company knows which one to open. */
export function openFinesByCar(fines: Array<FineState & { vehicleId: string }>, today: string): Map<string, { open: number; urgent: boolean }> {
  const byCar = new Map<string, { open: number; urgent: boolean }>();
  for (const fine of fines) {
    if (fineStage(fine) === 'resolved') continue;
    const entry = byCar.get(fine.vehicleId) ?? { open: 0, urgent: false };
    entry.open += 1;
    if (['soon', 'overdue'].includes(indicationState(fine, today))) entry.urgent = true;
    byCar.set(fine.vehicleId, entry);
  }
  return byCar;
}

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

export type LookupLite = { enabled: boolean; configured: boolean; nextAutomatic: string };

/** Where the weekly automatic lookup stands, in a sentence: not granted (the owner turns it on), not set up, or on. */
export function automationState(lookup: LookupLite): { tone: Tone; headline: string; detail: string } {
  if (!lookup.enabled) {
    return { tone: 'neutral', headline: 'Consulta automática desligada', detail: 'Peça ao suporte do NextRotta para ligar na sua empresa. Até lá, as multas são registradas à mão.' };
  }
  if (!lookup.configured) {
    return { tone: 'warning', headline: 'Consulta automática ainda não configurada', detail: 'O NextRotta ainda está preparando a conexão. Tente de novo mais tarde.' };
  }
  return { tone: 'success', headline: 'Verificação semanal ligada', detail: `Todo domingo, sozinha. Próxima: domingo, ${lookup.nextAutomatic.slice(8, 10)}/${lookup.nextAutomatic.slice(5, 7)}.` };
}

export type CarLookupLite = {
  finesCheckStatus: 'ok' | 'partial' | 'error' | 'missing_data' | 'refused' | null;
  finesCheckMessage: string | null;
  finesCheckedAt: string | null;
  renavam?: string | null;
  state?: string | null;
};

/** How the automatic lookup is doing for one car (its last result), for the car's page. */
export function carLookupSituation(car: CarLookupLite, lookupEnabled: boolean): { tone: Tone; text: string } {
  if (!lookupEnabled) return { tone: 'neutral', text: 'Consulta automática desligada para a empresa.' };
  const when = car.finesCheckedAt ? shortDateTime(car.finesCheckedAt).slice(0, 5) : null;
  // What is missing is known before any lookup ran: say it now, so the data gets filled in.
  if ('renavam' in car && (!car.renavam || !car.state)) {
    return { tone: 'warning', text: 'Falta o Renavam e o estado do carro. Abra o carro e preencha: ele entra na próxima verificação.' };
  }
  if (car.renavam && !isValidRenavam(car.renavam)) {
    return { tone: 'warning', text: 'O Renavam parece errado (o dígito verificador não confere). Confira no documento do carro.' };
  }
  if (car.finesCheckStatus === 'refused') return { tone: 'warning', text: car.finesCheckMessage ?? 'O órgão recusou a placa ou o Renavam. Confira no documento do carro; ao salvar, ele é consultado de novo.' };
  // The data is complete now: a "missing data" mark left by an earlier lookup is old news; the next lookup takes the car in.
  if (car.finesCheckStatus === 'missing_data' && 'renavam' in car) return { tone: 'neutral', text: 'Dados completos. O carro entra na próxima verificação.' };
  switch (car.finesCheckStatus) {
    case 'ok':
      return { tone: 'success', text: `Consultado em ${when}. Sem pendência.` };
    case 'partial':
      return { tone: 'warning', text: `${car.finesCheckMessage ?? 'Consulta incompleta.'}${when ? ` (${when})` : ''}` };
    case 'error':
      return { tone: 'danger', text: car.finesCheckMessage ?? 'A consulta não funcionou. O sistema tenta de novo no próximo ciclo.' };
    case 'missing_data':
      return { tone: 'warning', text: car.finesCheckMessage ?? 'Faltam o Renavam e o estado do carro.' };
    default:
      return { tone: 'neutral', text: 'Ainda não consultado. A primeira consulta sai no próximo ciclo.' };
  }
}

/** The latest time any car had its fines looked up, for "Última consulta". */
export function lastLookup(cars: Array<{ finesCheckedAt: string | null }>): string | null {
  return cars.reduce<string | null>((latest, car) => (car.finesCheckedAt && (!latest || car.finesCheckedAt > latest) ? car.finesCheckedAt : latest), null);
}
