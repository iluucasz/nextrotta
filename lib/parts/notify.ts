import { organizationHasFeature } from '../billing/entitlements';
import { sendEvolutionText } from '../whatsapp/evolution';
import { normalizePhone } from '../whatsapp/phone';
import { claimMessage, connectionFromConfig, finishMessage, getWhatsAppConfig } from '../whatsapp/store';

export interface CustomerMessageResult {
  /** 'unavailable': the organization's WhatsApp isn't connected (or not in the plan). */
  status: 'sent' | 'failed' | 'unavailable' | 'duplicate';
  error: string | null;
  /** Opens the technician's own WhatsApp with the text ready: the way out when ours can't send. */
  shareUrl: string | null;
}

export function whatsappShareUrl(phone: string | null, text: string) {
  const number = normalizePhone(phone);
  return `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`;
}

/**
 * Sends a message to the end customer through the organization's WhatsApp (Evolution) and records
 * it in the send history. With a test number configured, it goes there instead (like every other
 * message of the organization).
 */
export async function sendCustomerMessage(
  organizationId: string,
  input: { phone: string | null; text: string; technicianId: string; technicianName: string; dedupeKey: string; createdBy: string | null },
): Promise<CustomerMessageResult> {
  const shareUrl = whatsappShareUrl(input.phone, input.text);
  const phone = normalizePhone(input.phone);
  if (!phone) return { status: 'failed', error: 'WhatsApp do cliente inválido.', shareUrl };

  if (!(await organizationHasFeature(organizationId, 'whatsapp'))) {
    return { status: 'unavailable', error: 'O WhatsApp não está incluído no plano.', shareUrl };
  }
  const config = await getWhatsAppConfig(organizationId);
  const connection = connectionFromConfig(config);
  if (!connection) return { status: 'unavailable', error: 'O WhatsApp da empresa não está conectado.', shareUrl };

  const target = config.testPhone ? normalizePhone(config.testPhone) ?? phone : phone;
  const messageId = await claimMessage(organizationId, {
    technicianId: input.technicianId,
    technicianName: input.technicianName,
    phone: target,
    type: 'parts_sale',
    trigger: 'event',
    dedupeKey: input.dedupeKey,
    referenceDate: null,
    message: input.text,
    createdBy: input.createdBy,
  });
  if (!messageId) return { status: 'duplicate', error: null, shareUrl };

  const result = await sendEvolutionText(connection, target, input.text);
  await finishMessage(messageId, {
    status: result.ok ? 'sent' : 'failed',
    error: result.error,
    phone: target,
    redirectedToTest: target !== phone,
  });
  return { status: result.ok ? 'sent' : 'failed', error: result.error, shareUrl };
}
