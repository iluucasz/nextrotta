// The weekly lookup of the cars' fines: asks the provider about each car and registers, on its own, the fines the company does not
// have yet (with the driver suggested from the car's history). Relative imports only: the worker runs it.
import { recordAudit } from '../audit';
import { organizationHasFeature } from '../billing/entitlements';
import { sql } from '../db';
import { createNotification } from '../notifications';
import { createProviderFetcher, providerToken, sourcesFor, type ExternalFine, type Fetcher } from './fines-provider';
import { suggestDriver } from './fines-rules';
import { formatPlate, isValidRenavam } from './rules';

/** The feature (granted by the owner, company by company) that turns the automatic lookup on. */
export const FINES_LOOKUP_FEATURE = 'fines_lookup';

/** A scheduled run looks a car up at most once a week (a restart or a catch-up never pays twice); "Consultar agora" waits 30 minutes. */
export const SCHEDULED_INTERVAL_MINUTES = 6 * 24 * 60;
export const MANUAL_INTERVAL_MINUTES = 30;

/** `limited`: the call stopped at `maxCars` and more cars were waiting (click again, or the weekly round does them). */
export type LookupSummary = { cars: number; skipped: number; created: number; failed: number; limited: boolean };

type Car = { id: string; plate: string; renavam: string | null; state: string | null; fines_checked_at: string | null };

const brDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10).split('-').reverse().join('/');

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

/**
 * Looks up every car of a company that has its Renavam and state, registers the new fines and tells the admin once (the bell).
 * `minIntervalMinutes`: a car looked up more recently than this is skipped, so nothing is paid twice.
 */
export async function lookupOrganization(
  organizationId: string,
  fetcher: Fetcher,
  options: { today: string; minIntervalMinutes: number; maxCars?: number },
): Promise<LookupSummary> {
  const summary: LookupSummary = { cars: 0, skipped: 0, created: 0, failed: 0, limited: false };
  const cars = (await sql`
    SELECT id, plate, renavam, state, fines_checked_at FROM vehicles
    WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND status <> 'inactive'
    ORDER BY plate
  `) as unknown as Car[];

  const nowIso = new Date().toISOString();
  const found: Array<{ plate: string; fine: ExternalFine }> = [];

  for (const car of cars) {
    if (!car.renavam || !car.state) {
      await markCar(car.id, 'missing_data', 'Informe o Renavam e o estado (UF) do carro para consultar as multas.', false);
      continue;
    }
    if (!isValidRenavam(car.renavam)) {
      await markCar(car.id, 'missing_data', 'O Renavam deste carro parece errado (o dígito verificador não confere). Confira o número no documento do carro.', false);
      continue;
    }
    if (car.fines_checked_at && Date.now() - Date.parse(car.fines_checked_at) < options.minIntervalMinutes * 60_000) {
      summary.skipped += 1;
      continue;
    }

    if (options.maxCars && summary.cars >= options.maxCars) {
      summary.limited = true;
      break;
    }
    summary.cars += 1;
    const { sources, detranCovered } = sourcesFor(car.state);
    const target = { plate: car.plate, renavam: car.renavam, state: car.state };
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
  }

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
  return summary;
}

export type RoundSummary = { configured: boolean; companies: number; created: number; failed: number };

/** The worker's round: every active company the owner granted the lookup to. Safe to run daily (each car waits its week). */
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
      const result = await lookupOrganization(organizationId, use, { today, minIntervalMinutes: SCHEDULED_INTERVAL_MINUTES });
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
