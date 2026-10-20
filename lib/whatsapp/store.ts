// Relative imports only: this module is also compiled into the VPS worker (worker/tsconfig.json),
// which has no `@/` path alias.
import { randomUUID } from 'crypto';
import { featureAllowedSql } from '../billing/entitlements';
import { sql } from '../db';
import type { EvolutionConnection, EvolutionServer } from './evolution';
import {
  normalizeNotificationSettings,
  type MessageStatus,
  type CustomerMessageType,
  type MessageTrigger,
  type NotificationSettings,
  type NotificationType,
} from './notification-types';

/**
 * The shared Evolution server: EVOLUTION_API_URL / EVOLUTION_API_KEY, env only (Vercel and the
 * worker container). Never sent to any screen. Null when not configured.
 */
export function evolutionServer(): EvolutionServer | null {
  const apiUrl = (process.env.EVOLUTION_API_URL ?? '').trim();
  const apiKey = (process.env.EVOLUTION_API_KEY ?? '').trim();
  return apiUrl && apiKey ? { apiUrl, apiKey } : null;
}

export interface WhatsAppConfig {
  /** Every query made with this config is scoped to this organization. */
  organizationId: string;
  apiUrl: string;
  apiKey: string;
  /** The organization's own Evolution instance (its subdomain); empty until created. */
  instance: string;
  enabled: boolean;
  /** When set, every message goes to this number instead of the technician's. */
  testPhone: string;
  /** Public URL of this system, used by the `{link}` template variable. */
  appUrl: string;
  notifications: NotificationSettings;
  updatedAt: string | null;
}

export async function getWhatsAppConfig(organizationId: string): Promise<WhatsAppConfig> {
  const rows = await sql`SELECT * FROM whatsapp_config WHERE organization_id = ${organizationId}`;
  const row = rows[0] as Record<string, unknown> | undefined;

  const server = evolutionServer();
  return {
    organizationId,
    apiUrl: server?.apiUrl ?? '',
    apiKey: server?.apiKey ?? '',
    instance: String(row?.instance_name ?? ''),
    enabled: Boolean(row?.enabled),
    testPhone: String(row?.test_phone ?? ''),
    appUrl: String(row?.app_url ?? ''),
    notifications: normalizeNotificationSettings(row?.notifications),
    updatedAt: row?.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  };
}

/** Organizations whose scheduled notifications the worker should check: active, with WhatsApp on. */
export async function listOrganizationsWithWhatsApp(): Promise<string[]> {
  const rows = await sql.query(`
    SELECT c.organization_id
    FROM whatsapp_config c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.enabled = TRUE
      AND o.status IN ('active', 'past_due')
      AND o.deleted_at IS NULL
      AND ${featureAllowedSql('o', 'whatsapp')}
  `);
  return rows.map((row) => String(row.organization_id));
}

export function connectionFromConfig(config: WhatsAppConfig): EvolutionConnection | null {
  if (!config.apiUrl || !config.apiKey || !config.instance) return null;
  return { apiUrl: config.apiUrl, apiKey: config.apiKey, instance: config.instance };
}

export interface WhatsAppConfigUpdate {
  enabled: boolean;
  testPhone: string;
  appUrl: string;
  notifications: NotificationSettings;
}

export async function saveWhatsAppConfig(organizationId: string, update: WhatsAppConfigUpdate, updatedBy: string) {
  await sql`
    INSERT INTO whatsapp_config (organization_id, enabled, test_phone, app_url, notifications, updated_at, updated_by)
    VALUES (${organizationId}, ${update.enabled}, ${update.testPhone}, ${update.appUrl}, ${JSON.stringify(update.notifications)}::jsonb, NOW(), ${updatedBy})
    ON CONFLICT (organization_id) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        test_phone = EXCLUDED.test_phone,
        app_url = EXCLUDED.app_url,
        notifications = EXCLUDED.notifications,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
  `;
}

/**
 * Atomically marks a scheduled job as run for `periodKey` (a day or a month). Returns false when
 * it already ran for that period — so the worker's 5-minute ticks and a manual run can't overlap.
 */
export async function claimJobRun(organizationId: string, type: NotificationType, periodKey: string) {
  // Make sure the row exists, otherwise the UPDATE below has nothing to claim.
  await sql`INSERT INTO whatsapp_config (organization_id) VALUES (${organizationId}) ON CONFLICT (organization_id) DO NOTHING`;

  const rows = await sql`
    UPDATE whatsapp_config
    SET job_runs = jsonb_set(job_runs, ${`{${type}}`}::text[], to_jsonb(${periodKey}::text))
    WHERE organization_id = ${organizationId} AND COALESCE(job_runs->>${type}, '') <> ${periodKey}
    RETURNING organization_id
  `;

  return rows.length > 0;
}

export interface NewMessage {
  technicianId: string | null;
  technicianName: string | null;
  phone: string | null;
  type: NotificationType | 'test' | CustomerMessageType;
  trigger: MessageTrigger;
  dedupeKey: string | null;
  referenceDate: string | null;
  message: string;
  createdBy?: string | null;
}

/**
 * Inserts a pending row. Returns its id, or null when `dedupeKey` is already claimed — meaning
 * this exact notification was already sent (or is being sent right now).
 */
export async function claimMessage(organizationId: string, message: NewMessage): Promise<string | null> {
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO whatsapp_messages (
      id, organization_id, technician_id, technician_name, phone, type, trigger_kind, dedupe_key, reference_date, message, status, created_by
    )
    VALUES (
      ${id}, ${organizationId}, ${message.technicianId}, ${message.technicianName}, ${message.phone}, ${message.type}, ${message.trigger},
      ${message.dedupeKey}, ${message.referenceDate}, ${message.message}, 'pending', ${message.createdBy ?? null}
    )
    ON CONFLICT (organization_id, dedupe_key) DO NOTHING
    RETURNING id
  `;

  return rows.length ? id : null;
}

export async function finishMessage(
  id: string,
  result: { status: Exclude<MessageStatus, 'pending'>; error: string | null; phone: string | null; redirectedToTest: boolean },
) {
  // Only a successful send keeps its dedupe key: a failed or skipped notification must stay
  // retryable, by the next manual run or once the technician's phone number is fixed.
  await sql`
    UPDATE whatsapp_messages
    SET status = ${result.status},
        error = ${result.error},
        phone = ${result.phone},
        redirected_to_test = ${result.redirectedToTest},
        sent_at = CASE WHEN ${result.status} = 'sent' THEN NOW() ELSE NULL END,
        dedupe_key = CASE WHEN ${result.status} = 'sent' THEN dedupe_key ELSE NULL END
    WHERE id = ${id}
  `;
}
