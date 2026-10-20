import { getPublishedSiteContent } from './site/store';
import { normalizePhone } from './whatsapp/phone';

/**
 * The platform's own contact, as published in "Conteúdo do site" (never fixed in code). Used by the
 * screens a company sees outside the normal system: welcome/preparation and closed access.
 */
export async function getSupportContact() {
  const content = await getPublishedSiteContent();
  return {
    /** Digits with country code (wa.me format), or null when not set/invalid. */
    whatsapp: normalizePhone(content.whatsapp || content.phone),
    email: content.email || null,
  };
}

export type SupportContact = Awaited<ReturnType<typeof getSupportContact>>;
