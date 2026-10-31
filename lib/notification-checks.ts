// What the system notices on its own and tells the company's admin through the bell. Run when the admin opens a page
// and every few minutes while it stays open (GET /api/notifications?check=1). Each check says a thing once (the dedupe
// key) and, when the situation clears by itself, takes its notice off the bell.
import { sql } from './db';
import { getLimitUsage, organizationHasFeature } from './billing/entitlements';
import { brasiliaDateKey } from './formatters';
import { createNotification, ensureScheduleReminder, resolveNotifications } from './notifications';
import { getOrganizationSystemStatus } from './system-status';

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** From this day of the month the previous month's folha is expected to be closed. */
export const PAYROLL_REMINDER_DAY = 3;

/** "2026-01" -> "2025-12". */
function previousMonthOf(month: string) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 2, 1)).toISOString().slice(0, 7);
}

/** The Porto robot and the WhatsApp server answer from the VPS: when one does not, say what stops meanwhile. */
export async function checkModules(organizationId: string) {
  const status = await getOrganizationSystemStatus(organizationId);
  const today = brasiliaDateKey();

  if (status.porto === 'down') {
    await createNotification({
      organizationId,
      kind: 'maintenance',
      severity: 'warning',
      title: 'Módulo Porto em manutenção',
      body: 'O servidor da automação não está respondendo. Enquanto isso, a importação de horas e escala do Porto fica parada. O resto do sistema funciona normalmente.',
      href: '/admin/config-porto',
      dedupeKey: `module:porto:${today}`,
    });
  } else {
    await resolveNotifications(organizationId, 'module:porto:');
  }

  if (status.whatsapp === 'down') {
    await createNotification({
      organizationId,
      kind: 'maintenance',
      severity: 'warning',
      title: 'Módulo WhatsApp em manutenção',
      body: 'O servidor de mensagens não está respondendo. Enquanto isso, os envios de WhatsApp ficam parados. O resto do sistema funciona normalmente.',
      href: '/admin/whatsapp',
      dedupeKey: `module:whatsapp:${today}`,
    });
  } else {
    await resolveNotifications(organizationId, 'module:whatsapp:');
  }
}

/** Active technicians who produced in `month` and have no closed folha for it. */
export async function findPendingPayroll(organizationId: string, month: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await sql`
    SELECT t.id, t.name
    FROM technicians t
    WHERE t.organization_id = ${organizationId}
      AND t.status = 'active'
      AND t.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM services s
        WHERE s.organization_id = ${organizationId}
          AND s.technician_id = t.id
          AND s.deleted_at IS NULL
          AND COALESCE(NULLIF(s.competence_month, ''), to_char(s.date_performed, 'YYYY-MM')) = ${month}
      )
      AND NOT EXISTS (
        SELECT 1 FROM payroll p
        WHERE p.organization_id = ${organizationId}
          AND p.technician_id = t.id
          AND p.competence_month = ${month}
          AND p.status = 'closed'
          AND p.deleted_at IS NULL
      )
    ORDER BY t.name
  `;
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

/** The month that just ended and still has folhas to close: once, from the 3rd, until they are all closed. */
export async function checkPayroll(organizationId: string) {
  const today = brasiliaDateKey();
  if (Number(today.slice(8, 10)) < PAYROLL_REMINDER_DAY) return;

  const month = previousMonthOf(today.slice(0, 7));
  const pending = await findPendingPayroll(organizationId, month);
  if (!pending.length) {
    await resolveNotifications(organizationId, 'payroll:pending:');
    return;
  }

  const names = pending.slice(0, 3).map((technician) => technician.name);
  const more = pending.length - names.length;
  await createNotification({
    organizationId,
    kind: 'payroll',
    severity: 'warning',
    title: `Folha de ${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ainda não fechada`,
    body: `Falta fechar a folha de ${pending.length} técnico(s): ${names.join(', ')}${more > 0 ? ` e mais ${more}` : ''}.`,
    href: '/admin/payroll',
    dedupeKey: `payroll:pending:${month}`,
  });
}

/** A WhatsApp that lost its connection sends nothing until the QR Code is read again. */
export async function checkWhatsAppConnection(organizationId: string) {
  if (!(await organizationHasFeature(organizationId, 'whatsapp'))) return;

  const rows = await sql`
    SELECT enabled, instance_name, connection_state, connection_checked_at
    FROM whatsapp_config
    WHERE organization_id = ${organizationId}
  `;
  const config = rows[0];
  if (!config?.instance_name) return;

  const checkedRecently = config.connection_checked_at && Date.now() - new Date(config.connection_checked_at as string).getTime() < 3 * 24 * 3600 * 1000;
  if (config.connection_state === 'disconnected' && checkedRecently) {
    await createNotification({
      organizationId,
      kind: 'whatsapp',
      severity: 'warning',
      title: 'O WhatsApp da empresa está desconectado',
      body: 'Os avisos e envios pelo WhatsApp estão parados. Leia o QR Code de novo para voltar a enviar.',
      href: '/admin/whatsapp',
      dedupeKey: `whatsapp:disconnected:${brasiliaDateKey()}`,
    });
  } else if (config.connection_state === 'connected') {
    await resolveNotifications(organizationId, 'whatsapp:disconnected:');
  }
}

/** The plan's storage: a warning at 90% and an urgent notice when it is full (once per month each). */
export async function checkStorage(organizationId: string) {
  const usage = await getLimitUsage(organizationId, 'storageMb');
  if (!usage) return;

  const month = brasiliaDateKey().slice(0, 7);
  const share = usage.limit > 0 ? usage.used / usage.limit : 1;
  const amount = `${Math.round(usage.used)} de ${usage.limit} MB`;

  if (share >= 1) {
    await createNotification({
      organizationId,
      kind: 'storage',
      severity: 'critical',
      title: 'O armazenamento do plano está cheio',
      body: `Você usou ${amount}. Novos arquivos não serão aceitos. Fale com o suporte para ampliar.`,
      href: '/admin/assinatura',
      dedupeKey: `storage:full:${month}`,
    });
  } else if (share >= 0.9) {
    await createNotification({
      organizationId,
      kind: 'storage',
      severity: 'warning',
      title: 'O armazenamento do plano está quase cheio',
      body: `Você usou ${amount}. Fale com o suporte antes que acabe o espaço.`,
      href: '/admin/assinatura',
      dedupeKey: `storage:almost:${month}`,
    });
  }
}

/** Every check, each isolated: one failing never hides the others (and never breaks the page that asked). */
export async function runNotificationChecks(organizationId: string) {
  const checks: Array<[string, (id: string) => Promise<unknown>]> = [
    ['schedule', ensureScheduleReminder],
    ['modules', checkModules],
    ['payroll', checkPayroll],
    ['whatsapp', checkWhatsAppConnection],
    ['storage', checkStorage],
  ];

  await Promise.all(checks.map(([name, check]) => check(organizationId).catch((error) => console.error(`[notifications] ${name} check failed:`, error))));
}
