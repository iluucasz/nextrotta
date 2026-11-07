// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { sql } from '../db';
import { sendOwnerAlert } from './alerts';
import { insertNotice, resolveNoticesExcept, type NoticeInput } from './notices';

/**
 * What the rest of the system calls to tell the NextRotta's people something: the notice goes to the inbox
 * (platform_notices) and, when it is critical and for the admins, also to the owner's WhatsApp (once per notice).
 * Never throws: a failure here must not break the flow that raised it.
 */

async function organizationLabel(organizationId: string | null | undefined): Promise<string | null> {
  if (!organizationId) return null;
  const rows = await sql`SELECT name, slug FROM organizations WHERE id = ${organizationId}`;
  return rows[0] ? `${rows[0].name} (${rows[0].slug})` : null;
}

/** The WhatsApp for a critical notice that was just created. Its own key keeps it from being sent twice. */
async function alertOwner(id: string, input: NoticeInput) {
  const label = await organizationLabel(input.organizationId);
  await sendOwnerAlert({
    key: `notice:${id}`,
    kind: 'notice',
    title: input.title,
    lines: [...(label ? [`Empresa: ${label}`] : []), ...(input.body ? [input.body] : [])],
    organizationIds: input.organizationId ? [input.organizationId] : [],
    skipFeed: true,
  });
}

export async function notifyPlatform(input: NoticeInput & { whatsapp?: boolean }, repeat: 'count' | 'refresh' = 'count') {
  try {
    const { id, created } = await insertNotice(input, repeat);
    if (created && input.severity === 'critical' && (input.audience ?? 'owner') === 'owner' && input.whatsapp !== false) {
      await alertOwner(id, input);
    }
    return { id, created };
  } catch (error) {
    console.error('[platform-notices] could not notify:', input.category, error);
    return null;
  }
}

/**
 * For a periodic check: everything that is wrong right now under `prefix` (each with its own dedupeKey starting with the
 * prefix). New problems notify, ones still there are refreshed without counting, and what is no longer wrong is resolved.
 * Returns what changed, for the run's log.
 */
export async function syncPlatformNotices(prefix: string, current: NoticeInput[]) {
  let created = 0;
  for (const input of current) {
    if (!input.dedupeKey?.startsWith(prefix)) throw new Error(`A chave "${input.dedupeKey}" não começa com "${prefix}".`);
    const result = await notifyPlatform(input, 'refresh');
    if (result?.created) created += 1;
  }
  const resolved = await resolveNoticesExcept(prefix, current.map((input) => input.dedupeKey as string));
  return { created, resolved };
}
