// The lookup of the cars' fines through the paid provider: every Sunday on its own (the worker), and "Verificar agora" by the admin
// (once a day). Each lookup registers, on its own, the fines the company does not have yet (with the driver suggested from the car's
// history) and leaves a line in the history. Relative imports only: the worker runs it.
import { recordAudit } from '../audit';
import { organizationHasFeature } from '../billing/entitlements';
import { sql } from '../db';
import { createNotification } from '../notifications';
import { createProviderFetcher, providerToken, sourcesFor, type ExternalFine, type Fetcher } from './fines-provider';
import { suggestDriver, sundayOnOrBefore } from './fines-rules';
import { formatPlate, isValidRenavam } from './rules';

/** The feature (granted by the owner, company by company) that turns the automatic lookup on. */
export const FINES_LOOKUP_FEATURE = 'fines_lookup';

/** Cars asked about at the same time (each answer waits for a Detran, so a few at once keeps a big fleet inside the time limit). */
const PARALLEL_CARS = 4;

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
};

export type LookupSummary = { cars: number; created: number; failed: number; runId: string | null };

type Car = { id: string; plate: string; renavam: string | null; state: string | null; fines_checked_at: string | null };

const brDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/');
const dayStart = (dateKey: string) => `${dateKey}T00:00:00-03:00`;

// ---------------------------------------------------------------------------------------------------------------- the switch

/** Whether the company wants the Sunday lookup (on unless it paused it). The owner's grant (the feature) is checked apart. */
export async function getAutoEnabled(organizationId: string): Promise<boolean> {
  const rows = await sql`SELECT auto_enabled FROM fines_lookup_settings WHERE organization_id = ${organizationId}`;
  return rows[0] ? Boolean(rows[0].auto_enabled) : true;
}

export async function setAutoEnabled(organizationId: string, enabled: boolean, userId: string | null) {
  await sql`
    INSERT INTO fines_lookup_settings (organization_id, auto_enabled, updated_by) VALUES (${organizationId}, ${enabled}, ${userId})
    ON CONFLICT (organization_id) DO UPDATE SET auto_enabled = ${enabled}, updated_at = NOW(), updated_by = ${userId}
  `;
  await recordAudit({
    organizationId,
    actorId: userId,
    actorRole: 'admin',
    impersonationId: null,
    action: enabled ? 'fines_lookup.resumed' : 'fines_lookup.paused',
    targetType: 'organization',
    targetId: organizationId,
    details: {},
  });
}

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
  const rows = await sql`
    INSERT INTO fines_lookup_runs (organization_id, kind, triggered_by, lock_day)
    VALUES (${organizationId}, 'manual', ${triggeredBy}, ${today}::date)
    ON CONFLICT (organization_id, lock_day) WHERE lock_day IS NOT NULL DO NOTHING
    RETURNING id
  `;
  return rows[0] ? String(rows[0].id) : null;
}

async function finishRun(runId: string, summary: { cars: number; created: number; failed: number }, status: RunStatus, message: string | null) {
  await sql`
    UPDATE fines_lookup_runs SET
      status = ${status}, finished_at = NOW(), cars = ${summary.cars}, created = ${summary.created}, failed = ${summary.failed}, message = ${message},
      lock_day = CASE WHEN ${status === 'error'} THEN NULL ELSE lock_day END
    WHERE id = ${runId}
  `;
}

/** Whether today's manual lookup was already used. */
export async function manualLockedToday(organizationId: string, today: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM fines_lookup_runs
    WHERE organization_id = ${organizationId} AND lock_day = ${today}::date
      AND NOT (status = 'running' AND started_at < NOW() - make_interval(mins => ${STALE_RUN_MINUTES}))
    LIMIT 1
  `;
  return rows.length > 0;
}

/** The latest lookups of the company, newest first (what the screen lists). */
export async function listLookupRuns(organizationId: string, limit = 8): Promise<LookupRun[]> {
  const rows = await sql`
    SELECT id, kind, status, started_at, finished_at, cars, created, failed, message
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
    };
  });
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

async function markCar(carId: string, status: 'ok' | 'partial' | 'error' | 'missing_data', message: string | null, touchCheckedAt: boolean) {
  await sql`
    UPDATE vehicles SET
      fines_check_status = ${status}, fines_check_message = ${message},
      fines_checked_at = CASE WHEN ${touchCheckedAt} THEN NOW() ELSE fines_checked_at END
    WHERE id = ${carId}
  `;
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
  options: { today: string; mode: RunKind; runId?: string },
): Promise<LookupSummary> {
  const summary: LookupSummary = { cars: 0, created: 0, failed: 0, runId: options.runId ?? null };
  try {
    const cars = (await sql`
      SELECT id, plate, renavam, state, fines_checked_at FROM vehicles
      WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND status <> 'inactive'
      ORDER BY plate
    `) as unknown as Car[];

    const weekStart = Date.parse(dayStart(sundayOnOrBefore(options.today)));
    const toLookUp: Car[] = [];
    for (const car of cars) {
      if (!car.renavam || !car.state) {
        await markCar(car.id, 'missing_data', 'Informe o Renavam e o estado (UF) do carro para consultar as multas.', false);
      } else if (!isValidRenavam(car.renavam)) {
        await markCar(car.id, 'missing_data', 'O Renavam deste carro parece errado (o dígito verificador não confere). Confira o número no documento do carro.', false);
      } else if (options.mode === 'manual' || !car.fines_checked_at || Date.parse(car.fines_checked_at) < weekStart) {
        toLookUp.push(car);
      }
    }

    if (options.mode === 'weekly') {
      if (!toLookUp.length) return summary;
      summary.runId = await beginRun(organizationId, 'weekly', null, options.today);
    }
    const runId = summary.runId;

    const nowIso = new Date().toISOString();
    const found: Array<{ plate: string; fine: ExternalFine }> = [];
    const problems = new Set<string>();

    await mapLimit(toLookUp, PARALLEL_CARS, async (car) => {
      summary.cars += 1;
      const { sources, detranCovered } = sourcesFor(car.state as string);
      const target = { plate: car.plate, renavam: car.renavam as string, state: car.state as string };
      const errors: string[] = [];
      let succeeded = 0;
      for (const source of sources) {
        const result = await fetcher(source, target);
        if (!result.ok) {
          errors.push(result.message);
          continue;
        }
        succeeded += 1;
        for (const fine of result.fines) {
          if (await registerFound(organizationId, car, fine, nowIso)) {
            found.push({ plate: car.plate, fine });
            summary.created += 1;
          }
        }
      }

      errors.forEach((message) => problems.add(message));
      if (succeeded === 0) {
        summary.failed += 1;
        // Nothing was looked up: not marked as checked, so the next round tries again (a failed query is not billed).
        await markCar(car.id, 'error', errors.join(' ').slice(0, 500), false);
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
      const status: RunStatus = summary.cars > 0 && summary.failed === summary.cars ? 'error' : summary.failed > 0 ? 'partial' : 'ok';
      const message = problems.size ? Array.from(problems).join(' ').slice(0, 500) : summary.cars === 0 ? 'Nenhum carro com Renavam e estado para consultar.' : null;
      await finishRun(runId, summary, status, message);
    }
    return summary;
  } catch (error) {
    if (summary.runId) await finishRun(summary.runId, summary, 'error', 'A consulta falhou antes de terminar.').catch(() => undefined);
    throw error;
  }
}

export type RoundSummary = { configured: boolean; companies: number; created: number; failed: number };

/** The worker's round: every active company the owner granted the lookup to. Runs daily, but only does what the week asks for. */
export async function runFineLookups(today: string, fetcher?: Fetcher): Promise<RoundSummary> {
  const token = providerToken();
  const use = fetcher ?? (token ? createProviderFetcher(token) : null);
  if (!use) return { configured: false, companies: 0, created: 0, failed: 0 };

  const companies = await sql`
    SELECT DISTINCT o.id
    FROM organizations o
    JOIN vehicles v ON v.organization_id = o.id AND v.deleted_at IS NULL
    WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
  `;
  const round: RoundSummary = { configured: true, companies: 0, created: 0, failed: 0 };
  for (const company of companies) {
    const organizationId = String(company.id);
    try {
      if (!(await organizationHasFeature(organizationId, FINES_LOOKUP_FEATURE))) continue;
      if (!(await getAutoEnabled(organizationId))) continue;
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
