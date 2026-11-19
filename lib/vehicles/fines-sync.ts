// The lookup of the cars' fines through the paid provider: every Sunday on its own (the worker), and "Verificar agora" by the admin
// (once a day). Each lookup registers, on its own, the fines the company does not have yet (with the driver suggested from the car's
// history) and leaves a line in the history. Relative imports only: the worker runs it.
import { recordAudit } from '../audit';
import { organizationHasFeature } from '../billing/entitlements';
import { sql } from '../db';
import { createNotification } from '../notifications';
import { createProviderFetcher, providerToken, sourcesFor, type ExternalFine, type Fetcher, type LookupResult } from './fines-provider';
import { suggestDriver, sundayOnOrBefore } from './fines-rules';
import { formatPlate, isValidRenavam } from './rules';
import type { RunCarDetail, RunDetails, RunSourceDetail } from './status';

/** The feature (granted by the owner, company by company) that turns the automatic lookup on. */
export const FINES_LOOKUP_FEATURE = 'fines_lookup';

/**
 * "Verificar agora" runs inside a 300 s function. A PRF answer takes 12-60 s and the agency is asked one car at a time, so a big fleet does
 * not fit: new calls stop this long after the start, and the call already in flight (at worst 2 attempts of PROVIDER_TIMEOUT_SECONDS + 25 s)
 * still ends before the 300 s. What was left waits for the next lookup (the weekly one in the worker has no such limit).
 */
export const MANUAL_BUDGET_MS = 160_000;
export const MANUAL_ATTEMPTS = 2;

/**
 * "Verificar agora" does not ask again about a car that was looked up successfully this recently (every question is billed, even with no fine):
 * clicking again moves on to the cars that are missing instead of paying twice for the same answer. The oldest answer goes first.
 */
export const MANUAL_RECENT_HOURS = 6;

/** Cars asked about at the same time (each answer waits for an agency, so many at once keeps a fleet inside the time limit of "Verificar agora"). */
const PARALLEL_CARS = 8;

/**
 * The manual "Verificar agora" works once a day per company (the line of the day holds a lock until the next day; a lookup that ends in an
 * error lets the day go). Owner's decision, 19/11/2026: it was off from 16/11 while the lookup was being tried out, and is on again.
 * Set it to false to let a manual lookup start again as soon as the previous one finishes (a lookup still running always blocks another).
 */
export const MANUAL_ONCE_A_DAY = true;

/** A run that says "running" for longer than this died on the way (a restart, a timeout): it neither counts nor locks. */
const STALE_RUN_MINUTES = 15;

export type RunKind = 'weekly' | 'manual';
export type RunStatus = 'running' | 'ok' | 'partial' | 'error';

export type LookupRun = {
  id: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  cars: number;
  created: number;
  failed: number;
  message: string | null;
  /** Whether the line has the per-car detail (the ones recorded before it existed do not). The detail itself comes from `getLookupRun`. */
  hasDetails: boolean;
};

/** `deferred`: cars left for the next lookup because the time budget of this one ran out ("Verificar agora" has 300 s). */
export type LookupSummary = { cars: number; created: number; failed: number; deferred: number; runId: string | null };

type Car = { id: string; plate: string; renavam: string | null; state: string | null; fines_checked_at: string | null; fines_check_status: string | null };

const brDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
const dayStart = (dateKey: string) => `${dateKey}T00:00:00-03:00`;

// ---------------------------------------------------------------------------------------------------------------- the history

/**
 * Opens a line in the history. A manual one is allowed once a day per company, and the database decides who gets the day (a unique index
 * on the day the line holds), so two clicks at the same moment cannot both pass: it returns null when today's manual lookup already ran
 * (or is still running). A lookup that ended in an error lets the day go, and so does one that never finished.
 */
export async function beginRun(organizationId: string, kind: RunKind, triggeredBy: string | null, today: string): Promise<string | null> {
  if (kind === 'weekly') {
    const rows = await sql`INSERT INTO fines_lookup_runs (organization_id, kind) VALUES (${organizationId}, 'weekly') RETURNING id`;
    return String(rows[0].id);
  }
  // A line that says "running" for too long died on the way (a restart, a timeout): it lets its day go.
  await sql`
    UPDATE fines_lookup_runs SET status = 'error', lock_day = NULL, finished_at = NOW(), message = 'A consulta não terminou.'
    WHERE organization_id = ${organizationId} AND lock_day IS NOT NULL AND status = 'running' AND started_at < NOW() - make_interval(mins => ${STALE_RUN_MINUTES})
  `;
  if (!MANUAL_ONCE_A_DAY) {
    // The daily rule is off: a lookup that already finished (even one recorded while the rule was on) no longer holds the day.
    await sql`UPDATE fines_lookup_runs SET lock_day = NULL WHERE organization_id = ${organizationId} AND lock_day IS NOT NULL AND status <> 'running'`;
  }
  const rows = await sql`
    INSERT INTO fines_lookup_runs (organization_id, kind, triggered_by, lock_day)
    VALUES (${organizationId}, 'manual', ${triggeredBy}, ${today}::date)
    ON CONFLICT (organization_id, lock_day) WHERE lock_day IS NOT NULL DO NOTHING
    RETURNING id
  `;
  return rows[0] ? String(rows[0].id) : null;
}

async function finishRun(runId: string, summary: { cars: number; created: number; failed: number }, status: RunStatus, message: string | null, details: RunDetails | null = null) {
  await sql`
    UPDATE fines_lookup_runs SET
      status = ${status}, finished_at = NOW(), cars = ${summary.cars}, created = ${summary.created}, failed = ${summary.failed}, message = ${message},
      details = ${details ? JSON.stringify(details) : null}::jsonb,
      lock_day = CASE WHEN ${status === 'error' || !MANUAL_ONCE_A_DAY} THEN NULL ELSE lock_day END
    WHERE id = ${runId}
  `;
}

/** Whether today's manual lookup was already used (with the daily rule off: whether one is running right now). */
export async function manualLockedToday(organizationId: string, today: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM fines_lookup_runs
    WHERE organization_id = ${organizationId} AND lock_day = ${today}::date
      AND NOT (status = 'running' AND started_at < NOW() - make_interval(mins => ${STALE_RUN_MINUTES}))
      AND (status = 'running' OR ${MANUAL_ONCE_A_DAY})
    LIMIT 1
  `;
  return rows.length > 0;
}

/** The latest lookups of the company, newest first (what the screen lists). */
export async function listLookupRuns(organizationId: string, limit = 8): Promise<LookupRun[]> {
  const rows = await sql`
    SELECT id, kind, status, started_at, finished_at, cars, created, failed, message, (details IS NOT NULL) AS has_details
    FROM fines_lookup_runs WHERE organization_id = ${organizationId}
    ORDER BY started_at DESC LIMIT ${limit}
  `;
  return rows.map((row) => {
    const startedAt = new Date(row.started_at as string).toISOString();
    const stale = row.status === 'running' && Date.now() - Date.parse(startedAt) > STALE_RUN_MINUTES * 60_000;
    return {
      id: String(row.id),
      kind: row.kind as RunKind,
      status: stale ? 'error' : (row.status as RunStatus),
      startedAt,
      finishedAt: row.finished_at ? new Date(row.finished_at as string).toISOString() : null,
      cars: Number(row.cars),
      created: Number(row.created),
      failed: Number(row.failed),
      message: stale ? 'A consulta não terminou.' : ((row.message as string | null) ?? null),
      hasDetails: Boolean(row.has_details),
    };
  });
}

/** One lookup of the company with what each agency said about each car (the window of the History tab); null when it is not theirs. */
export async function getLookupRun(organizationId: string, runId: string): Promise<(LookupRun & { details: RunDetails | null }) | null> {
  const rows = await sql`
    SELECT id, kind, status, started_at, finished_at, cars, created, failed, message, details
    FROM fines_lookup_runs WHERE organization_id = ${organizationId} AND id = ${runId}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  const startedAt = new Date(row.started_at as string).toISOString();
  const stale = row.status === 'running' && Date.now() - Date.parse(startedAt) > STALE_RUN_MINUTES * 60_000;
  return {
    id: String(row.id),
    kind: row.kind as RunKind,
    status: stale ? 'error' : (row.status as RunStatus),
    startedAt,
    finishedAt: row.finished_at ? new Date(row.finished_at as string).toISOString() : null,
    cars: Number(row.cars),
    created: Number(row.created),
    failed: Number(row.failed),
    message: stale ? 'A consulta não terminou.' : ((row.message as string | null) ?? null),
    hasDetails: Boolean(row.details),
    details: (row.details as RunDetails | null) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------- lookup

async function history(organizationId: string, vehicleId: string) {
  const rows = await sql`
    SELECT technician_id, assigned_at, released_at FROM vehicle_assignments
    WHERE vehicle_id = ${vehicleId} AND organization_id = ${organizationId}
  `;
  return rows.map((row) => ({
    technicianId: String(row.technician_id),
    assignedAt: new Date(row.assigned_at as string).toISOString(),
    releasedAt: row.released_at ? new Date(row.released_at as string).toISOString() : null,
  }));
}

/** Registers a fine the provider reported, unless the company already has it (even one it removed: it was dealt with). */
async function registerFound(organizationId: string, car: Car, fine: ExternalFine, nowIso: string): Promise<boolean> {
  const known = await sql`SELECT 1 FROM vehicle_fines WHERE organization_id = ${organizationId} AND ait_number = ${fine.ait} LIMIT 1`;
  if (known.length) return false;

  const infractionAt = fine.infractionAt ?? nowIso;
  const driver = suggestDriver(await history(organizationId, car.id), infractionAt);
  const notes = `Encontrada pela consulta automática em ${brDay(nowIso)} (${fine.authority}).${fine.infractionAt ? '' : ' A data da infração não veio na consulta: confira e ajuste.'} Confira o prazo na notificação.`;
  const rows = await sql`
    INSERT INTO vehicle_fines (organization_id, vehicle_id, technician_id, ait_number, infraction_at, description, location, authority, amount, points, payment_due, notes, source)
    VALUES (${organizationId}, ${car.id}, ${driver}, ${fine.ait}, ${infractionAt}, ${fine.description}, ${fine.location}, ${fine.authority}, ${fine.amount}, ${fine.points}, ${fine.paymentDue}::date, ${notes}, 'auto')
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  if (!rows.length) return false;
  await recordAudit({
    organizationId,
    actorId: null,
    actorRole: 'system',
    impersonationId: null,
    action: 'fine.auto_created',
    targetType: 'vehicle_fine',
    targetId: String(rows[0].id),
    details: { vehicleId: car.id, aitNumber: fine.ait, amount: fine.amount, authority: fine.authority, technicianId: driver },
  });
  return true;
}

async function markCar(carId: string, status: 'ok' | 'partial' | 'error' | 'missing_data' | 'refused', message: string | null, touchCheckedAt: boolean) {
  await sql`
    UPDATE vehicles SET
      fines_check_status = ${status}, fines_check_message = ${message},
      fines_checked_at = CASE WHEN ${touchCheckedAt} THEN NOW() ELSE fines_checked_at END
    WHERE id = ${carId}
  `;
}

/**
 * One call at a time per agency. MEASURED with real cars: the PRF answers in 3 to 13 s when asked one at a time, and when several
 * cars are asked together some never answer (timeout at 120 s). The two agencies of a car (and different agencies) still go together.
 */
export function serializePerSource(fetcher: Fetcher): Fetcher {
  const tails = new Map<string, Promise<unknown>>();
  return (source, car) => {
    const previous = tails.get(source.key) ?? Promise.resolve();
    const run = previous.then(() => fetcher(source, car));
    tails.set(source.key, run.catch(() => undefined));
    return run;
  };
}

async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

/**
 * Looks the company's cars up, registers the new fines and tells the admin once (the bell). Leaves a line in the history.
 * - `weekly` (the worker, Sundays): the cars not looked up since this week's Sunday began (and the ones never looked up, so a car
 *   just added is not left waiting a week). Nothing to do leaves no line in the history.
 * - `manual` ("Verificar agora"): every car that has its data; `runId` is the line already opened by `beginRun` (it holds the day's lock).
 */
export async function lookupOrganization(
  organizationId: string,
  fetcher: Fetcher,
  options: { today: string; mode: RunKind; runId?: string; /** Stop starting new cars after this moment (epoch ms). */ deadlineMs?: number },
): Promise<LookupSummary> {
  const summary: LookupSummary = { cars: 0, created: 0, failed: 0, deferred: 0, runId: options.runId ?? null };
  try {
    const cars = (await sql`
      SELECT id, plate, renavam, state, fines_checked_at, fines_check_status FROM vehicles
      WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND status <> 'inactive'
      ORDER BY plate
    `) as unknown as Car[];

    const weekStart = Date.parse(dayStart(sundayOnOrBefore(options.today)));
    const toLookUp: Car[] = [];
    let recentlyChecked = 0;
    for (const car of cars) {
      if (!car.renavam || !car.state) {
        await markCar(car.id, 'missing_data', 'Informe o Renavam e o estado (UF) do carro para consultar as multas.', false);
      } else if (!isValidRenavam(car.renavam)) {
        await markCar(car.id, 'missing_data', 'O Renavam deste carro parece errado (o dígito verificador não confere). Confira o número no documento do carro.', false);
      } else if (car.fines_check_status === 'refused') {
        // The agency refused this plate or Renavam: nothing is asked (and billed) until someone edits the car, which clears the mark.
      } else if (options.mode === 'manual') {
        const recent = car.fines_checked_at && Date.now() - Date.parse(car.fines_checked_at) < MANUAL_RECENT_HOURS * 3_600_000;
        if (recent) recentlyChecked += 1;
        else toLookUp.push(car);
      } else if (!car.fines_checked_at || Date.parse(car.fines_checked_at) < weekStart) {
        toLookUp.push(car);
      }
    }
    // The ones never looked up (or looked up longest ago) go first, so each click moves the fleet forward.
    toLookUp.sort((a, b) => (a.fines_checked_at ? Date.parse(a.fines_checked_at) : 0) - (b.fines_checked_at ? Date.parse(b.fines_checked_at) : 0));

    if (options.mode === 'weekly') {
      if (!toLookUp.length) return summary;
      summary.runId = await beginRun(organizationId, 'weekly', null, options.today);
    }
    const runId = summary.runId;

    const nowIso = new Date().toISOString();
    const found: Array<{ plate: string; fine: ExternalFine }> = [];
    const problems = new Set<string>();
    const carDetails: RunCarDetail[] = [];
    let withoutLookup = 0;

    // The time budget is checked when a call's turn in the agency's queue comes (every car is picked up at once, but the calls wait in line):
    // out of time, the call is not made and the car is left for the next lookup, keeping its old mark so it is the first one asked next time.
    // A query that is not set up on the platform (`unavailable`) is asked once per lookup: the next cars get the same answer without a call.
    const unavailable = new Map<string, LookupResult>();
    const bounded: Fetcher = async (source, car) => {
      if (options.deadlineMs && Date.now() > options.deadlineMs) {
        return { ok: false, deferred: true, message: `${source.label}: ficou para a próxima verificação (acabou o tempo desta).` };
      }
      const known = unavailable.get(source.key);
      if (known) return known;
      const result = await fetcher(source, car);
      if (!result.ok && result.unavailable) unavailable.set(source.key, result);
      return result;
    };
    const queued = serializePerSource(bounded);
    await mapLimit(toLookUp, PARALLEL_CARS, async (car) => {
      const { sources, detranCovered } = sourcesFor(car.state as string);
      const target = { plate: car.plate, renavam: car.renavam as string, state: car.state as string };
      const errors: string[] = [];
      let succeeded = 0;
      // Both agencies of a car are asked at the same time; what they answered is then handled one by one.
      const answers = await Promise.all(sources.map((source) => queued(source, target)));
      const left = answers.every((answer) => !answer.ok && (answer.deferred || answer.unavailable));
      if (left && answers.some((answer) => !answer.ok && answer.deferred)) {
        summary.deferred += 1;
        return;
      }
      // Every agency of this car is not set up yet: nothing was looked up, and it is no failure of the car.
      const notSetUp = left;
      if (notSetUp) withoutLookup += 1;
      else summary.cars += 1;
      const detail: RunCarDetail = { plate: car.plate, sources: [] };
      for (const [index, result] of answers.entries()) {
        const sourceDetail: RunSourceDetail = { label: sources[index].label, result: 'ok', found: 0, created: [], message: null };
        detail.sources.push(sourceDetail);
        if (!result.ok) {
          sourceDetail.result = result.unavailable ? 'unavailable' : result.deferred ? 'deferred' : 'failed';
          if (sourceDetail.result === 'failed') sourceDetail.message = result.message;
          if (!result.unavailable) errors.push(result.message);
          continue;
        }
        succeeded += 1;
        sourceDetail.found = result.fines.length;
        for (const fine of result.fines) {
          if (await registerFound(organizationId, car, fine, nowIso)) {
            found.push({ plate: car.plate, fine });
            sourceDetail.created.push({ ait: fine.ait, description: fine.description, amount: fine.amount });
            summary.created += 1;
          }
        }
      }
      carDetails.push(detail);

      // An agency that is not set up yet is not the company's problem: it is neither a message nor a failure.
      errors.forEach((message) => problems.add(message));
      if (notSetUp) {
        await markCar(car.id, 'partial', `Ainda não há consulta de multas disponível para ${car.state}.`, false);
      } else if (succeeded === 0) {
        summary.failed += 1;
        if (answers.some((answer) => !answer.ok && answer.refused)) {
          // The agency refused the data: it is asked no more until the car is edited.
          await markCar(car.id, 'refused', errors.join(' ').slice(0, 500), false);
        } else {
          // Nothing was looked up: not marked as checked, so the next round tries again (a failed query is not billed).
          await markCar(car.id, 'error', errors.join(' ').slice(0, 500), false);
        }
      } else if (errors.length) {
        await markCar(car.id, 'partial', errors.join(' ').slice(0, 500), true);
      } else if (!detranCovered) {
        await markCar(car.id, 'partial', `Só as rodovias federais (PRF) foram consultadas: o Detran de ${car.state} ainda não está integrado.`, true);
      } else {
        await markCar(car.id, 'ok', null, true);
      }
    });

    if (found.length) {
      await createNotification({
        organizationId,
        kind: 'fleet',
        severity: 'warning',
        title: found.length === 1 ? 'Multa nova encontrada nos carros' : `${found.length} multas novas encontradas nos carros`,
        body: `${found
          .slice(0, 3)
          .map((item) => `${formatPlate(item.plate)}: ${item.fine.description}`)
          .join('; ')}${found.length > 3 ? ' e mais' : ''}. Confira o prazo na notificação e avise o prestador.`,
        href: '/admin/apps/carros?tab=multas',
        dedupeKey: `fleet:found:${options.today}:${found[0].fine.ait}`,
      });
    }

    if (runId) {
      const status: RunStatus = summary.cars > 0 && summary.failed === summary.cars ? 'error' : summary.failed > 0 || summary.deferred > 0 ? 'partial' : 'ok';
      const notes = [
        problems.size ? Array.from(problems).join(' ') : '',
        summary.deferred ? `${summary.deferred} ${summary.deferred === 1 ? 'carro ficou' : 'carros ficaram'} para a próxima verificação (acabou o tempo desta).` : '',
        withoutLookup ? `${withoutLookup} ${withoutLookup === 1 ? 'carro' : 'carros'} sem consulta de multas disponível ainda.` : '',
        !problems.size && !summary.deferred && !withoutLookup && summary.cars === 0
          ? recentlyChecked > 0
            ? `Os carros com dados já foram consultados há menos de ${MANUAL_RECENT_HOURS} horas.`
            : 'Nenhum carro com Renavam e estado para consultar.'
          : '',
      ].filter(Boolean);
      const message = notes.length ? notes.join(' ').slice(0, 500) : null;
      carDetails.sort((a, b) => a.plate.localeCompare(b.plate));
      await finishRun(runId, summary, status, message, { cars: carDetails });
    }
    return summary;
  } catch (error) {
    if (summary.runId) await finishRun(summary.runId, summary, 'error', 'A consulta falhou antes de terminar.').catch(() => undefined);
    throw error;
  }
}

export type RoundSummary = { configured: boolean; companies: number; created: number; failed: number };

/**
 * The worker's round: every active company the owner granted the lookup to. Runs daily, but only does what the week asks for.
 * `organizationIds` narrows it to those companies (the tests use it: a test must never write into a real company).
 */
export async function runFineLookups(today: string, fetcher?: Fetcher, options: { organizationIds?: string[] } = {}): Promise<RoundSummary> {
  const token = providerToken();
  const use = fetcher ?? (token ? createProviderFetcher(token) : null);
  if (!use) return { configured: false, companies: 0, created: 0, failed: 0 };

  const companies = await sql`
    SELECT DISTINCT o.id
    FROM organizations o
    JOIN vehicles v ON v.organization_id = o.id AND v.deleted_at IS NULL
    WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
      AND (${options.organizationIds ?? null}::uuid[] IS NULL OR o.id = ANY(${options.organizationIds ?? null}::uuid[]))
  `;
  const round: RoundSummary = { configured: true, companies: 0, created: 0, failed: 0 };
  for (const company of companies) {
    const organizationId = String(company.id);
    try {
      if (!(await organizationHasFeature(organizationId, FINES_LOOKUP_FEATURE))) continue;
      const result = await lookupOrganization(organizationId, use, { today, mode: 'weekly' });
      round.companies += 1;
      round.created += result.created;
      round.failed += result.failed;
    } catch (error) {
      round.failed += 1;
      console.error('[carros] fines lookup failed for', organizationId, error);
    }
  }
  return round;
}
