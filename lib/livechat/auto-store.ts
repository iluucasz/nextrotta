import { recordAudit } from '../audit';
import { sql } from '../db';
import { PlatformError, type Actor } from '../platform/errors';
import { autoDefinition, hoursProblem, isAutoKey, normalizeHours, renderAutoMessage, resolveAutoMessages, templateProblem, type AutoKey, type AutoRow, type AutoVariable } from './auto-messages';

/** What the owner changed in the automatic messages (the rest is the defaults of lib/livechat/auto-messages.ts). */
async function loadRows(): Promise<AutoRow[]> {
  const rows = await sql`SELECT key, enabled, body, config FROM livechat_auto_messages`;
  return rows.map((row) => ({ key: String(row.key), enabled: row.enabled as boolean | null, body: row.body as string | null, config: row.config }));
}

/** The catalog as it is now (defaults plus changes) and the business hours. */
export async function loadAutoMessages() {
  return resolveAutoMessages(await loadRows());
}

/**
 * The text of an automatic message with its variables filled, or null when the owner turned it off. A failure to read the
 * settings falls back to the default text: a closing or a welcome is never lost because of this table.
 */
export async function getAutoMessage(key: AutoKey, values: Partial<Record<AutoVariable, string>> = {}): Promise<string | null> {
  let enabled = autoDefinition(key).defaultEnabled;
  let text = autoDefinition(key).defaultText;
  try {
    const found = (await loadAutoMessages()).messages.find((message) => message.key === key);
    if (found) {
      enabled = found.enabled;
      text = found.text;
    }
  } catch (error) {
    console.error('[livechat] automatic messages unavailable, using the defaults:', error);
  }
  return enabled ? renderAutoMessage(text, values) : null;
}

/**
 * { enabled?, body?, hours?, reset? } — saves one automatic message. `reset` goes back to the default text and state.
 * `hours` is only for the "outside hours" message.
 */
export async function saveAutoMessage(key: string, input: Record<string, unknown>, actor: Actor) {
  if (!isAutoKey(key)) throw new PlatformError('Mensagem não encontrada.', 404);
  const definition = autoDefinition(key);

  const reset = input.reset === true;
  const enabled = reset ? null : typeof input.enabled === 'boolean' ? input.enabled : undefined;
  let body: string | null | undefined = reset ? null : undefined;
  if (!reset && input.body !== undefined) {
    const problem = templateProblem(key, input.body);
    if (problem) throw new PlatformError(problem);
    // The default text saved as is stays "the default", so a later improvement of it reaches the owner too.
    body = String(input.body).trim() === definition.defaultText ? null : String(input.body).trim();
  }
  let config: Record<string, unknown> | undefined;
  if (reset && key === 'whatsapp_away') config = {};
  if (!reset && input.hours !== undefined) {
    if (key !== 'whatsapp_away') throw new PlatformError('Só a mensagem de fora do horário tem horário de atendimento.');
    const problem = hoursProblem(input.hours);
    if (problem) throw new PlatformError(problem);
    config = normalizeHours(input.hours);
  }

  // What was not touched stays as it is (merged here: the query driver has no way to compose fragments).
  const current = (await sql`SELECT enabled, body, config FROM livechat_auto_messages WHERE key = ${key}`)[0];
  const next = {
    enabled: enabled === undefined ? ((current?.enabled as boolean | null) ?? null) : enabled,
    body: body === undefined ? ((current?.body as string | null) ?? null) : body,
    config: config === undefined ? (current?.config ?? {}) : config,
  };
  await sql`
    INSERT INTO livechat_auto_messages (key, enabled, body, config, updated_by, updated_at)
    VALUES (${key}, ${next.enabled}, ${next.body}, ${JSON.stringify(next.config)}::jsonb, ${actor.id}, NOW())
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, body = EXCLUDED.body, config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `;
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: actor.role ?? 'platform_owner',
    action: reset ? 'livechat_auto.reset' : 'livechat_auto.updated',
    targetType: 'livechat_auto_message',
    targetId: null,
    details: { key, enabled: enabled ?? undefined, bodyChanged: body !== undefined && !reset, hoursChanged: config !== undefined && !reset },
  });
  return loadAutoMessages();
}
