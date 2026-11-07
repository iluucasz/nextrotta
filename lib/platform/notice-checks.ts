// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { getEntitlements, currentUsage } from '../billing/entitlements';
import { sql } from '../db';
import { describePortoError } from '../porto-login-errors';
import { trackRun } from '../worker-health';
import { limitLevel, limitShare } from './notice-meta';
import { syncPlatformNotices } from './notice-alerts';
import { getIntegrationsStatus } from './operations';
import type { NoticeInput } from './notices';

/**
 * What the platform watches by itself, so the owner does not have to open each company to find out. Every check lists what is
 * wrong right now under its own key prefix; syncPlatformNotices notifies the new problems once, keeps the standing ones quiet and
 * resolves what went away. Runs in the worker twice an hour and, lazily, when a person of the team has the panel open (the worker
 * cannot report its own death). Each check fails alone.
 */

const HOUR = 3_600_000;
const panelOrganization = (id: string) => `/plataforma/organizacoes/${id}`;

type OrganizationRow = { id: string; name: string; slug: string };

async function activeOrganizations(): Promise<OrganizationRow[]> {
  const rows = await sql`
    SELECT id, name, slug FROM organizations
    WHERE deleted_at IS NULL AND status IN ('active', 'past_due') ORDER BY name
  `;
  return rows.map((row) => ({ id: String(row.id), name: String(row.name), slug: String(row.slug) }));
}

// ---------------------------------------------------------------------------------------------
// The platform
// ---------------------------------------------------------------------------------------------

async function platformHealth(): Promise<NoticeInput[]> {
  const found: NoticeInput[] = [];

  // The worker writes its heartbeat every 30 minutes, so more than 75 without one means it is down. Read from the database on purpose:
  // the same answer from any machine (asking its health route from a development computer would raise a false alarm).
  const heartbeat = (await sql`SELECT MAX(last_seen_at) AS last FROM worker_heartbeats`)[0]?.last as string | null | undefined;
  const silentMs = heartbeat ? Date.now() - new Date(heartbeat).getTime() : 0;
  if (heartbeat && silentMs > 75 * 60_000) {
    found.push({
      category: 'system',
      severity: 'critical',
      title: 'O worker não está respondendo',
      body: `Sem sinal há ${Math.round(silentMs / 60_000)} min. Enquanto isso o robô do Porto, os envios de WhatsApp, a cobrança diária e os backups ficam parados.`,
      href: '/plataforma/operacao',
      dedupeKey: 'sys:worker-down',
    });
  }

  // Only the services that answered with an error: a missing variable in a development machine is not an incident.
  for (const item of await getIntegrationsStatus()) {
    if (item.state !== 'error') continue;
    if (item.name === 'Worker de automações' || item.name === 'Webhook de cobrança') continue; // the first is above; the second is "no event yet"
    found.push({
      category: item.name.includes('IA') ? 'ai' : 'system',
      severity: 'critical',
      title: `${item.name} com problema`,
      body: item.detail,
      href: '/plataforma/operacao',
      dedupeKey: `sys:integration:${item.name}`,
    });
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Limits (storage, users, WhatsApp messages and Porto runs of the plan)
// ---------------------------------------------------------------------------------------------

const LIMIT_LABELS = {
  storageMb: { name: 'armazenamento', unit: 'MB', category: 'limits' as const },
  maxUsers: { name: 'usuários ativos', unit: '', category: 'limits' as const },
  whatsappMessagesMonth: { name: 'mensagens de WhatsApp do mês', unit: '', category: 'whatsapp' as const },
  portoRunsMonth: { name: 'execuções do Porto do mês', unit: '', category: 'automation' as const },
};

async function limitsReached(organizations: OrganizationRow[]): Promise<NoticeInput[]> {
  const found: NoticeInput[] = [];
  for (const organization of organizations) {
    const { limits } = await getEntitlements(organization.id);
    for (const key of Object.keys(LIMIT_LABELS) as Array<keyof typeof LIMIT_LABELS>) {
      const limit = limits[key];
      if (limit === null) continue;
      const used = await currentUsage(organization.id, key);
      const share = limitShare(used, limit);
      const level = limitLevel(share);
      if (!level || share === null) continue;
      const meta = LIMIT_LABELS[key];
      const unit = meta.unit ? ` ${meta.unit}` : '';
      found.push({
        organizationId: organization.id,
        category: meta.category,
        severity: level === 'full' ? 'warning' : 'info',
        title: level === 'full' ? `${organization.name}: limite de ${meta.name} atingido` : `${organization.name}: ${meta.name} acima de 90%`,
        body: `Usou ${Math.round(used * 10) / 10}${unit} de ${limit}${unit} (${Math.round(share * 100)}%).${level === 'full' ? ' A empresa já não consegue adicionar mais. Ofereça um plano maior ou ajuste o limite da empresa.' : ''}`,
        href: panelOrganization(organization.id),
        dedupeKey: `limits:${organization.id}:${key}:${level}`,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// WhatsApp, Porto robot, backups, inactivity
// ---------------------------------------------------------------------------------------------

async function whatsappDown(): Promise<NoticeInput[]> {
  const rows = await sql`
    SELECT o.id, o.name, w.connection_checked_at
    FROM whatsapp_config w JOIN organizations o ON o.id = w.organization_id
    WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
      AND w.enabled AND w.instance_name IS NOT NULL AND w.connection_state = 'disconnected'
  `;
  return rows.map((row) => ({
    organizationId: String(row.id),
    category: 'whatsapp' as const,
    severity: 'warning' as const,
    title: `${row.name}: WhatsApp desconectado`,
    body: 'Os avisos e envios da empresa pelo WhatsApp estão parados até ela ler o QR Code de novo.',
    href: panelOrganization(String(row.id)),
    dedupeKey: `whatsapp:down:${row.id}`,
  }));
}

/** The robot is on for a company but nothing came in for two days: the nightly import is failing or not running. */
async function portoStale(): Promise<NoticeInput[]> {
  const rows = await sql`
    SELECT o.id, o.name,
      (SELECT MAX(l.started_at) FROM porto_sync_log l WHERE l.organization_id = o.id AND l.status IN ('success', 'partial', 'dry_run')) AS last_ok,
      (SELECT l.error_message FROM porto_sync_log l WHERE l.organization_id = o.id AND l.status = 'error' ORDER BY l.started_at DESC LIMIT 1) AS last_error
    FROM porto_config p JOIN organizations o ON o.id = p.organization_id
    WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due')
      AND p.automation_enabled AND p.cpf IS NOT NULL AND p.encrypted_password IS NOT NULL
  `;
  const found: NoticeInput[] = [];
  for (const row of rows) {
    const lastOk = row.last_ok ? new Date(row.last_ok as string).getTime() : null;
    if (lastOk !== null && Date.now() - lastOk < 48 * HOUR) continue;
    // A company that just turned the robot on has had no run yet: give it the first two nights.
    const days = lastOk === null ? null : Math.floor((Date.now() - lastOk) / (24 * HOUR));
    const cause = row.last_error ? describePortoError(String(row.last_error)).message : 'Nenhuma execução registrada.';
    if (lastOk === null && !row.last_error) continue;
    found.push({
      organizationId: String(row.id),
      category: 'automation',
      severity: 'warning',
      title: `${row.name}: robô do Porto sem importar${days === null ? '' : ` há ${days} dias`}`,
      body: cause,
      href: panelOrganization(String(row.id)),
      dedupeKey: `automation:stale:${row.id}`,
    });
  }
  return found;
}

async function backupsStale(): Promise<NoticeInput[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return [];
  const rows = await sql`
    SELECT o.id, o.name,
      (SELECT MAX(b.created_at) FROM organization_backups b WHERE b.organization_id = o.id AND b.status = 'completed') AS last_ok,
      (SELECT b.error FROM organization_backups b WHERE b.organization_id = o.id AND b.status = 'failed' ORDER BY b.created_at DESC LIMIT 1) AS last_error
    FROM organizations o
    WHERE o.deleted_at IS NULL AND o.status IN ('active', 'past_due') AND o.created_at < NOW() - INTERVAL '2 days'
  `;
  return rows
    .filter((row) => !row.last_ok || Date.now() - new Date(row.last_ok as string).getTime() > 36 * HOUR)
    .map((row) => ({
      organizationId: String(row.id),
      category: 'backup' as const,
      severity: 'critical' as const,
      title: `${row.name}: sem backup há mais de 36 horas`,
      body: row.last_error ? `Última falha: ${String(row.last_error).slice(0, 300)}` : 'Nenhum backup concluído recentemente.',
      href: panelOrganization(String(row.id)),
      dedupeKey: `backup:stale:${row.id}`,
    }));
}

/** An active company where nobody has logged in for two weeks: a customer about to leave without saying so. */
async function inactiveOrganizations(): Promise<NoticeInput[]> {
  const rows = await sql`
    SELECT o.id, o.name, MAX(u.last_login_at) AS last_login
    FROM organizations o JOIN users u ON u.organization_id = o.id AND u.deleted_at IS NULL
    WHERE o.deleted_at IS NULL AND o.status = 'active' AND COALESCE(o.activated_at, o.created_at) < NOW() - INTERVAL '14 days'
    GROUP BY o.id, o.name
    HAVING MAX(u.last_login_at) IS NULL OR MAX(u.last_login_at) < NOW() - INTERVAL '14 days'
  `;
  return rows.map((row) => ({
    organizationId: String(row.id),
    category: 'growth' as const,
    severity: 'info' as const,
    title: `${row.name}: ninguém entra há 14 dias`,
    body: row.last_login ? `Último acesso em ${new Date(row.last_login as string).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.` : 'Nenhum acesso registrado.',
    href: panelOrganization(String(row.id)),
    dedupeKey: `growth:inactive:${row.id}`,
  }));
}

/** A written case the team has not answered for a day: nobody else will notice it (the customer is waiting in silence). */
async function casesWaiting(): Promise<NoticeInput[]> {
  const rows = await sql`
    SELECT b.id, b.ticket_number, b.title, b.organization_id, o.name AS organization_name,
      COALESCE(
        (SELECT MAX(m.created_at) FROM bug_messages m WHERE m.bug_id = b.id AND NOT m.from_owner AND NOT m.internal),
        b.created_at
      ) AS waiting_since,
      (SELECT MAX(m.created_at) FROM bug_messages m WHERE m.bug_id = b.id AND m.from_owner AND NOT m.internal) AS last_answer
    FROM bug_reports b LEFT JOIN organizations o ON o.id = b.organization_id
    WHERE b.status IN ('new', 'investigating') AND b.channel = 'case' AND b.origin = 'portal'
  `;
  return rows
    .filter((row) => {
      const since = new Date(row.waiting_since as string).getTime();
      const answered = row.last_answer ? new Date(row.last_answer as string).getTime() >= since : false;
      return !answered && Date.now() - since > 24 * HOUR;
    })
    .map((row) => ({
      organizationId: (row.organization_id as string | null) ?? null,
      category: 'support' as const,
      severity: 'warning' as const,
      audience: 'staff' as const,
      title: `Caso #${row.ticket_number ?? ''} sem resposta há mais de 24 horas`,
      body: `${row.organization_name ? `${row.organization_name}: ` : ''}${String(row.title).slice(0, 160)}`,
      href: `/plataforma/reports/${row.id}`,
      dedupeKey: `support:waiting:${row.id}`,
    }));
}

// ---------------------------------------------------------------------------------------------

type Check = { prefix: string; run: () => Promise<NoticeInput[]> };

async function platformChecks(): Promise<Check[]> {
  const organizations = await activeOrganizations();
  // Each prefix owns its keys, so one check failing never resolves (or hides) what another found.
  return [
    { prefix: 'sys:', run: platformHealth },
    { prefix: 'limits:', run: () => limitsReached(organizations) },
    { prefix: 'whatsapp:down:', run: whatsappDown },
    { prefix: 'automation:stale:', run: portoStale },
    { prefix: 'backup:stale:', run: backupsStale },
    { prefix: 'growth:inactive:', run: inactiveOrganizations },
    { prefix: 'support:waiting:', run: casesWaiting },
  ];
}

/** What every check finds right now, without writing or notifying anything (for tests and for looking). */
export async function collectPlatformFindings(): Promise<Record<string, NoticeInput[] | { error: string }>> {
  const result: Record<string, NoticeInput[] | { error: string }> = {};
  for (const check of await platformChecks()) {
    try {
      result[check.prefix] = await check.run();
    } catch (error) {
      result[check.prefix] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return result;
}

export async function runPlatformChecks(options: { minIntervalMs?: number } = {}): Promise<Record<string, { created: number; resolved: number } | { error: string }> | null> {
  if (options.minIntervalMs) {
    const recent = await sql`
      SELECT 1 FROM worker_runs WHERE job = 'platform_checks' AND started_at > NOW() - (${options.minIntervalMs}::int * INTERVAL '1 millisecond') LIMIT 1
    `;
    if (recent[0]) return null;
  }

  return trackRun('platform_checks', null, async () => {
    const result: Record<string, { created: number; resolved: number } | { error: string }> = {};
    for (const check of await platformChecks()) {
      try {
        result[check.prefix] = await syncPlatformNotices(check.prefix, await check.run());
      } catch (error) {
        console.error(`[platform-checks] ${check.prefix}`, error);
        result[check.prefix] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return result;
  });
}
