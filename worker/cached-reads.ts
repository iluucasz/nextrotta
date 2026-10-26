import { getOrganizationSettings } from '../lib/organization-settings-store';
import { listOrganizationsWithPortoAutomation } from '../lib/porto-sync-log';
import { getPlatformSettings } from '../lib/platform/settings';
import { getWhatsAppConfig, listOrganizationsWithWhatsApp } from '../lib/whatsapp/store';

/**
 * What the schedulers read every minute (platform settings, which organizations have the automations
 * on, each one's times) changes rarely, but reading it from Neon every minute keeps the database awake
 * 24 hours a day — and the plans bill by the hours it stays awake. So the worker keeps these reads in
 * memory and only goes back to the database when:
 *   - the maintenance tick runs (every 30 min, index.ts), or
 *   - the app tells it something was saved (POST /refresh, worker/server.ts).
 * A failed reload keeps serving the last known value, so a database hiccup never stops the schedulers.
 */

type Entry = { value: unknown; stale: boolean };
const entries = new Map<string, Entry>();

export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);
  if (entry && !entry.stale) return entry.value as T;
  try {
    const value = await load();
    entries.set(key, { value, stale: false });
    return value;
  } catch (error) {
    if (entry) return entry.value as T;
    throw error;
  }
}

/** Marks everything stale: the next read of each entry goes back to the database. */
export function invalidateCachedReads() {
  for (const entry of entries.values()) entry.stale = true;
}

export const cachedPlatformSettings = () => cached('platform-settings', getPlatformSettings);
export const cachedPortoOrganizations = () => cached('porto-organizations', listOrganizationsWithPortoAutomation);
export const cachedOrganizationSettings = (organizationId: string) =>
  cached(`organization-settings:${organizationId}`, () => getOrganizationSettings(organizationId));
export const cachedWhatsAppOrganizations = () => cached('whatsapp-organizations', listOrganizationsWithWhatsApp);
export const cachedWhatsAppConfig = (organizationId: string) =>
  cached(`whatsapp-config:${organizationId}`, () => getWhatsAppConfig(organizationId));
