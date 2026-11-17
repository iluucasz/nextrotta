import { sql } from '../db';
import { createNotification, resolveNotifications } from '../notifications';
import { weekStart } from './fines-rules';
import { loadFleetAlerts } from './fines-store';
import { dueState, formatPlate } from './rules';

const brDate = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * The worker's daily round (08:00 Brasília): runs checkFleet for every company that has cars and is not blocked, so the weekly
 * reminder (every Monday), the deadlines and the licensing dates reach the admin without anyone opening the system.
 * One company failing never stops the others. Safe to run again: each notice says a thing once.
 * `organizationIds` narrows it to those companies (the tests use it: a test must never write into a real company).
 */
export async function runFleetChecks(today: string, options: { organizationIds?: string[] } = {}): Promise<{ checked: number; failed: number }> {
  const companies = await sql`
    SELECT DISTINCT o.id
    FROM organizations o
    JOIN vehicles v ON v.organization_id = o.id AND v.deleted_at IS NULL
    WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
      AND (${options.organizationIds ?? null}::uuid[] IS NULL OR o.id = ANY(${options.organizationIds ?? null}::uuid[]))
  `;
  let failed = 0;
  for (const company of companies) {
    try {
      await checkFleet(String(company.id), today);
    } catch (error) {
      failed += 1;
      console.error('[carros] weekly check failed for', company.id, error);
    }
  }
  return { checked: companies.length - failed, failed };
}

/**
 * What the Carros app tells the admin through the bell: once a week, to look up the cars' fines; each fine whose time to name
 * the driver is running out; and each car whose licensing or insurance is about to expire. Each says a thing once (dedupe key)
 * and goes away when the situation does.
 */
export async function checkFleet(organizationId: string, today: string) {
  const cars = await sql`
    SELECT id, plate, licensing_due::text AS licensing_due, insurance_due::text AS insurance_due
    FROM vehicles
    WHERE organization_id = ${organizationId} AND deleted_at IS NULL AND status <> 'inactive'
  `;
  if (!cars.length) return;

  // The weekly reminder: the platform cannot look the fines up on its own, so it asks the admin to.
  await createNotification({
    organizationId,
    kind: 'fleet',
    severity: 'info',
    title: 'Consulte as multas dos carros',
    body: 'Veja no Detran ou na Carteira Digital de Trânsito se algum carro da empresa tem multa nova e registre aqui. O prazo para indicar o condutor corre desde a notificação.',
    href: '/admin/apps/carros?tab=multas',
    dedupeKey: `fleet:fines-check:${weekStart(today)}`,
  });

  const { urgent } = await loadFleetAlerts(organizationId, today);
  for (const fine of urgent) {
    const deadline = fine.indicationDeadline as string;
    const left = daysBetween(today, deadline);
    const overdue = left < 0;
    await createNotification({
      organizationId,
      kind: 'fleet',
      severity: overdue ? 'critical' : 'warning',
      title: overdue
        ? `Prazo vencido para indicar o condutor da multa do ${formatPlate(fine.plate)}`
        : `Indique o condutor da multa do ${formatPlate(fine.plate)}: ${left === 0 ? 'último dia' : left === 1 ? 'falta 1 dia' : `faltam ${left} dias`}`,
      body: `${fine.description}. Prazo: ${brDate(deadline)}.`,
      href: '/admin/apps/carros?tab=multas',
      dedupeKey: `fleet:indicate:${fine.id}:${overdue ? 'overdue' : 'soon'}`,
    });
  }

  for (const car of cars) {
    for (const [kind, label, due] of [
      ['licensing', 'licenciamento', car.licensing_due as string | null],
      ['insurance', 'seguro', car.insurance_due as string | null],
    ] as const) {
      const state = dueState(due, today);
      if (due && (state === 'soon' || state === 'overdue')) {
        await createNotification({
          organizationId,
          kind: 'fleet',
          severity: state === 'overdue' ? 'critical' : 'warning',
          title: state === 'overdue' ? `${label[0].toUpperCase()}${label.slice(1)} vencido: ${formatPlate(String(car.plate))}` : `Vence o ${label} do ${formatPlate(String(car.plate))} em ${brDate(due)}`,
          body: state === 'overdue' ? `Venceu em ${brDate(due)}. Quando regularizar, informe o novo vencimento no carro.` : 'Já está feito? Informe o novo vencimento no carro.',
          href: '/admin/apps/carros',
          dedupeKey: `fleet:${kind}:${car.id}:${due}`,
        });
      } else {
        // Renewed (a new date) or not near anymore: the old notice is off the bell.
        await resolveNotifications(organizationId, `fleet:${kind}:${car.id}:`);
      }
    }
  }
}
