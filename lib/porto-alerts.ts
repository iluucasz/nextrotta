// Relative imports only: runs in the VPS worker (worker/tsconfig.json).
import { notifyOrganization, resolveNotifications } from './notifications';
import { describePortoError, isPortoLoginRejection, portoLoginNotice } from './porto-login-errors';
import { getOrganizationSettings } from './organization-settings-store';
import { sendEvolutionText } from './whatsapp/evolution';
import { connectionFromConfig, getWhatsAppConfig } from './whatsapp/store';

/**
 * The robot did its job: one "Concluído" entry per job per day in the bell (no WhatsApp: good news is not an alert).
 * Also takes the "login does not work" entry off the bell, since the run just logged in.
 */
export async function notifyPortoSuccess(organizationId: string, jobLabel: string, result: { technicians_processed?: number; rows_written?: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const technicians = result.technicians_processed ?? 0;
  const rows = result.rows_written ?? 0;
  await resolveNotifications(organizationId, 'porto:login:').catch(() => undefined);
  await notifyOrganization(organizationId, {
    kind: 'porto',
    severity: 'success',
    title: `Robô do Porto: ${jobLabel} concluída`,
    body: technicians ? `${technicians} técnico(s) conferidos, ${rows} registro(s) gravados.` : 'A importação automática terminou sem problemas.',
    href: '/admin/config-porto',
    dedupeKey: `porto:ok:${jobLabel}:${today}`,
  });
}

/**
 * Warns the organization's admin by WhatsApp (Configurações → "WhatsApp para alertas do robô") that
 * an automatic Porto run of their organization failed or finished with warnings — problems they can
 * act on (credentials, a technician missing from the Porto list, a duplicated QRA, unreadable laudos).
 * Sent through the organization's own WhatsApp instance, independent of the technicians' notification
 * switch. A change of the Porto screens is the platform's problem and goes to the owner instead
 * (lib/platform/alerts.ts). Never throws: a failed alert only gets logged.
 */
export async function sendPortoAlert(organizationId: string, title: string, lines: string[]): Promise<{ sent: boolean; reason?: string }> {
  // What the company reads is the sentence, never the technical trace of the run.
  const rawLines = lines;
  lines = rawLines.map((line) => describePortoError(line).message);
  const today = new Date().toISOString().slice(0, 10);

  // The bell does not depend on the WhatsApp being set up: once a day per problem. A rejected login is one entry
  // (the same key the bell check uses, notification-checks.ts), whichever of the two raises it first.
  const login = rawLines.find((line) => isPortoLoginRejection(line));
  if (login) {
    const notice = portoLoginNotice(describePortoError(login).message);
    await notifyOrganization(organizationId, { kind: 'porto', severity: 'critical', ...notice, href: '/admin/config-porto', dedupeKey: `porto:login:${today}` });
  } else {
    await notifyOrganization(organizationId, {
      kind: 'porto',
      severity: 'warning',
      title: `Robô do Porto: ${title}`,
      body: lines.slice(0, 3).join(' · '),
      href: '/admin/config-porto',
      dedupeKey: `porto:${title}:${today}`,
    });
  }

  try {
    const phone = (await getOrganizationSettings(organizationId)).portoAlertPhone.trim();
    if (!phone) return { sent: false, reason: 'Nenhum WhatsApp de alerta configurado.' };

    const connection = connectionFromConfig(await getWhatsAppConfig(organizationId));
    if (!connection) return { sent: false, reason: 'O WhatsApp da empresa não está conectado.' };

    const body = lines.slice(0, 12).map((line) => `• ${line}`).join('\n');
    const more = lines.length > 12 ? `\n• … e mais ${lines.length - 12}` : '';
    const text = `⚠️ *Robô do Porto*: ${title}\n\n${body}${more}\n\nDetalhes em Config. Porto → Histórico de execuções.`;
    const result = await sendEvolutionText(connection, phone, text);
    if (!result.ok) console.error('[porto-alerts] send failed:', organizationId, result.error);
    return result.ok ? { sent: true } : { sent: false, reason: result.error ?? undefined };
  } catch (error) {
    console.error('[porto-alerts] error:', organizationId, error);
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
