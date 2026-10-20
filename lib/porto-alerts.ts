// Relative imports only: runs in the VPS worker (worker/tsconfig.json).
import { getOrganizationSettings } from './organization-settings-store';
import { sendEvolutionText } from './whatsapp/evolution';
import { connectionFromConfig, getWhatsAppConfig } from './whatsapp/store';

/**
 * Warns the organization's admin by WhatsApp (Configurações → "WhatsApp para alertas do robô") that
 * an automatic Porto run of their organization failed or finished with warnings — problems they can
 * act on (credentials, a technician missing from the Porto list, a duplicated QRA, unreadable laudos).
 * Sent through the organization's own WhatsApp instance, independent of the technicians' notification
 * switch. A change of the Porto screens is the platform's problem and goes to the owner instead
 * (lib/platform/alerts.ts). Never throws: a failed alert only gets logged.
 */
export async function sendPortoAlert(organizationId: string, title: string, lines: string[]): Promise<{ sent: boolean; reason?: string }> {
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
