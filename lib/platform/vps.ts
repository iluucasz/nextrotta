// Relative imports only: also compiled into the VPS worker (worker/tsconfig.json).
import { recordAudit } from '../audit';
import { sql } from '../db';
import { sendOwnerAlert } from './alerts';
import { INFRA_COST_CATEGORIES, type CostCategory } from './costs';
import { PlatformError } from './errors';
import { getPlatformSettings } from './settings';

/**
 * The shared VPS seen from the owner panel, through the NextRotta VPS agent (vps-agent/server.mjs):
 * host and container usage, images, disk, cleanup, restarts — plus the infrastructure costs the
 * owner enters and their split per organization. The agent itself decides what may be touched
 * (production is read only); this module records history, audits every action and alerts.
 */

export type ContainerOwner = 'nextrotta' | 'production' | 'shared' | 'unknown';

export interface VpsHost {
  checkedAt: string;
  cpu: { percent: number; cores: number | null; load: number[] };
  memory: { total: number; available: number; used: number; swapTotal: number };
  disk: { total: number; used: number; free: number; percent: number };
  network: { rxBytes: number; txBytes: number };
  uptimeSeconds: number;
  os: string | null;
}

export interface VpsContainer {
  id: string;
  name: string;
  owner: ContainerOwner;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  startedAt: string | null;
  restartCount: number;
  restartPolicy: string | null;
  ports: string[];
  sizeRw: number | null;
  sizeRootFs: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  logBytes: number | null;
  logRotation: Record<string, string>;
}

export function vpsAgentConfigured() {
  return Boolean(process.env.VPS_AGENT_URL && process.env.VPS_AGENT_SECRET);
}

async function callAgent<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const baseUrl = process.env.VPS_AGENT_URL;
  const secret = process.env.VPS_AGENT_SECRET;
  if (!baseUrl || !secret) throw new PlatformError('O agente da VPS não está configurado (VPS_AGENT_URL / VPS_AGENT_SECRET).', 503);

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
    });
  } catch {
    throw new PlatformError('O agente da VPS não respondeu. A VPS pode estar fora do ar.', 503);
  }
  if (response.status === 502 || response.status === 503) throw new PlatformError('O agente da VPS está fora do ar.', 503);
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new PlatformError(body?.error ?? `O agente da VPS respondeu ${response.status}.`, response.status >= 500 ? 502 : response.status);
  return body as T;
}

export const getVpsHost = () => callAgent<VpsHost>('/host');
export const getVpsContainers = () => callAgent<{ containers: VpsContainer[] }>('/containers').then((data) => data.containers);
export const getVpsImages = () => callAgent<{ images: unknown[] }>('/images').then((data) => data.images);
export const getVpsDisk = () => callAgent<Record<string, unknown>>('/disk');

export async function getVpsContainerLogs(name: string, tail = 200) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) throw new PlatformError('Container inválido.');
  return callAgent<{ name: string; logs: string }>(`/containers/${encodeURIComponent(name)}/logs?tail=${Math.min(Math.max(tail, 1), 2000)}`);
}

/** Restart (the agent refuses production and needs confirm=evolution for the shared WhatsApp). */
export async function restartVpsContainer(name: string, confirmShared: boolean, actor: { id: string }) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) throw new PlatformError('Container inválido.');
  const result = await callAgent<{ ok: boolean; owner: ContainerOwner }>(
    `/containers/${encodeURIComponent(name)}/restart${confirmShared ? '?confirm=evolution' : ''}`,
    { method: 'POST', timeoutMs: 90_000 },
  );
  await recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action: 'vps.container_restarted',
    targetType: 'vps_container',
    targetId: name,
    details: { owner: result.owner },
  });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------------------------

type CleanupAction = { kind: string; target: string; bytes: number; reason: string; ok?: boolean; error?: string };

/** Preview (dryRun) or run. Both are recorded, so the panel can compare and show the history. */
export async function runVpsCleanup(options: { dryRun: boolean; trigger: 'manual' | 'auto'; actor?: { id: string } | null }) {
  try {
    const result = await callAgent<{
      actions?: CleanupAction[];
      results?: CleanupAction[];
      totalBytes?: number;
      freedBytes?: number;
      disk?: { percent: number };
      diskBefore?: { percent: number };
      diskAfter?: { percent: number };
    }>(`/cleanup${options.dryRun ? '?dryRun=1' : ''}`, { method: 'POST', timeoutMs: 300_000 });

    const actions = options.dryRun ? result.actions ?? [] : result.results ?? [];
    const freed = options.dryRun ? result.totalBytes ?? 0 : result.freedBytes ?? 0;
    const rows = await sql`
      INSERT INTO vps_cleanups (trigger, dry_run, actor_id, freed_bytes, disk_before, disk_after, actions)
      VALUES (
        ${options.trigger}, ${options.dryRun}, ${options.actor?.id ?? null}, ${freed},
        ${(options.dryRun ? result.disk?.percent : result.diskBefore?.percent) ?? null},
        ${options.dryRun ? null : result.diskAfter?.percent ?? null},
        ${JSON.stringify(actions)}::jsonb
      )
      RETURNING id
    `;
    if (!options.dryRun && options.actor) {
      await recordAudit({
        organizationId: null,
        actorId: options.actor.id,
        actorRole: 'platform_owner',
        action: 'vps.cleanup',
        targetType: 'vps',
        targetId: String(rows[0].id),
        details: { freedBytes: freed, actions: actions.length },
      });
    }
    return { id: String(rows[0].id), dryRun: options.dryRun, freedBytes: freed, actions, diskBefore: result.diskBefore ?? result.disk ?? null, diskAfter: result.diskAfter ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      INSERT INTO vps_cleanups (trigger, dry_run, actor_id, error) VALUES (${options.trigger}, ${options.dryRun}, ${options.actor?.id ?? null}, ${message})
    `;
    throw error;
  }
}

export async function listVpsCleanups(limit = 30) {
  const rows = await sql`
    SELECT id, trigger, dry_run, actor_id, started_at, freed_bytes, disk_before, disk_after, actions, error
    FROM vps_cleanups
    ORDER BY started_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 200)}
  `;
  return rows.map((row) => ({
    id: String(row.id),
    trigger: String(row.trigger),
    dryRun: Boolean(row.dry_run),
    actorId: row.actor_id ? String(row.actor_id) : null,
    startedAt: new Date(row.started_at as string).toISOString(),
    freedBytes: Number(row.freed_bytes),
    diskBefore: row.disk_before === null ? null : Number(row.disk_before),
    diskAfter: row.disk_after === null ? null : Number(row.disk_after),
    actions: row.actions as CleanupAction[],
    error: (row.error as string | null) ?? null,
  }));
}

/** Daily, from the worker, only once the owner switched the automatic cleanup on. */
export async function runAutomaticVpsCleanup() {
  const settings = await getPlatformSettings();
  if (!settings.vps.autoCleanup || !vpsAgentConfigured()) return null;
  const result = await runVpsCleanup({ dryRun: false, trigger: 'auto' });
  const failed = result.actions.filter((action) => action.ok === false);
  if (failed.length) {
    await sendOwnerAlert({
      key: `vps-cleanup-failed:${new Date().toISOString().slice(0, 10)}`,
      kind: 'vps',
      title: 'a limpeza automática da VPS teve falhas',
      lines: failed.map((action) => `${action.target}: ${action.error ?? 'erro'}`),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Metrics history and alerts (worker, every 5 minutes)
// ---------------------------------------------------------------------------------------------

const GB = 1024 ** 3;

function brasiliaDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export async function collectVpsMetrics() {
  const day = brasiliaDay();
  let host: VpsHost;
  let containers: VpsContainer[];
  try {
    [host, containers] = await Promise.all([getVpsHost(), getVpsContainers()]);
  } catch (error) {
    // The worker runs on the same VPS, so the agent (not the whole machine) is what stopped answering.
    await sendOwnerAlert({
      key: `vps-agent-down:${day}:${new Date().getUTCHours()}`,
      kind: 'vps',
      title: 'o agente da VPS não está respondendo',
      lines: [error instanceof Error ? error.message : String(error), 'O painel fica sem métricas e sem limpeza até ele voltar.'],
    });
    throw error;
  }

  await sql`
    INSERT INTO vps_metrics (
      cpu_percent, load_1, memory_used_bytes, memory_total_bytes, memory_available_bytes,
      disk_used_bytes, disk_total_bytes, disk_percent, network_rx_bytes, network_tx_bytes
    )
    VALUES (
      ${host.cpu.percent}, ${host.cpu.load[0] ?? null}, ${host.memory.used}, ${host.memory.total}, ${host.memory.available},
      ${host.disk.used}, ${host.disk.total}, ${host.disk.percent}, ${host.network.rxBytes}, ${host.network.txBytes}
    )
  `;
  if (containers.length) {
    await sql`
      INSERT INTO vps_container_metrics (container_name, owner, state, cpu_percent, memory_bytes, memory_limit_bytes, restart_count, log_bytes)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(
        containers.map((container) => ({
          container_name: container.name,
          owner: container.owner,
          state: container.state,
          cpu_percent: container.cpuPercent,
          memory_bytes: container.memoryBytes,
          memory_limit_bytes: container.memoryLimitBytes,
          restart_count: container.restartCount,
          log_bytes: container.logBytes,
        })),
      )}::jsonb) AS item(
        container_name text, owner text, state text, cpu_percent numeric, memory_bytes bigint,
        memory_limit_bytes bigint, restart_count integer, log_bytes bigint
      )
    `;
  }

  if (host.disk.percent >= 80) {
    const critical = host.disk.percent >= 90;
    await sendOwnerAlert({
      key: `vps-disk-${critical ? 'critical' : 'warning'}:${day}`,
      kind: 'vps',
      title: `disco da VPS em ${host.disk.percent}%${critical ? ' (crítico)' : ''}`,
      lines: ['Veja a prévia da limpeza em Operação → VPS.', `Livre: ${(host.disk.free / GB).toFixed(1)} GB de ${(host.disk.total / GB).toFixed(1)} GB.`],
    });
  }
  if (host.memory.available < GB) {
    await sendOwnerAlert({
      key: `vps-memory:${day}:${new Date().getUTCHours()}`,
      kind: 'vps',
      title: 'pouca memória disponível na VPS',
      lines: [`${(host.memory.available / GB).toFixed(2)} GB disponíveis de ${(host.memory.total / GB).toFixed(1)} GB (a VPS não tem swap).`],
    });
  }
  for (const container of containers.filter((item) => item.owner === 'nextrotta' && item.state !== 'running' && !/^nextrotta-worker-[0-9a-f]{7}$/.test(item.name))) {
    await sendOwnerAlert({
      key: `vps-container-down:${container.name}:${day}`,
      kind: 'vps',
      title: `o container ${container.name} do NextRotta está parado`,
      lines: [`Estado: ${container.status}.`],
    });
  }
  return { host, containers: containers.length };
}

export type MetricsRange = '24h' | '7d' | '30d';

/** Host history aggregated per bucket (5 min for 24h, hour for 7d, day for 30d). */
export async function getVpsMetricsHistory(range: MetricsRange) {
  const config = { '24h': { interval: '24 hours', bucket: 'minute', step: 5 }, '7d': { interval: '7 days', bucket: 'hour', step: 1 }, '30d': { interval: '30 days', bucket: 'day', step: 1 } }[range];
  const rows = await sql.query(
    `
      SELECT date_trunc('${config.bucket}', collected_at) AS bucket,
             ROUND(AVG(cpu_percent), 1) AS cpu,
             ROUND(MAX(cpu_percent), 1) AS cpu_max,
             ROUND(AVG(memory_used_bytes)) AS memory_used,
             MAX(memory_total_bytes) AS memory_total,
             ROUND(MAX(disk_percent), 1) AS disk_percent,
             MAX(network_rx_bytes) - MIN(network_rx_bytes) AS rx,
             MAX(network_tx_bytes) - MIN(network_tx_bytes) AS tx
      FROM vps_metrics
      WHERE collected_at > NOW() - INTERVAL '${config.interval}'
      GROUP BY 1
      ORDER BY 1
    `,
  );
  return rows.map((row) => ({
    at: new Date(row.bucket as string).toISOString(),
    cpuPercent: Number(row.cpu),
    cpuMaxPercent: Number(row.cpu_max),
    memoryUsedBytes: Number(row.memory_used),
    memoryTotalBytes: Number(row.memory_total),
    diskPercent: Number(row.disk_percent),
    networkRxBytes: Math.max(0, Number(row.rx)),
    networkTxBytes: Math.max(0, Number(row.tx)),
  }));
}

export async function getContainerMetricsHistory(name: string, range: MetricsRange) {
  const interval = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }[range];
  const bucket = { '24h': 'minute', '7d': 'hour', '30d': 'day' }[range];
  const rows = await sql.query(
    `
      SELECT date_trunc('${bucket}', collected_at) AS bucket, ROUND(AVG(cpu_percent), 1) AS cpu, ROUND(AVG(memory_bytes)) AS memory
      FROM vps_container_metrics
      WHERE container_name = $1 AND collected_at > NOW() - INTERVAL '${interval}'
      GROUP BY 1 ORDER BY 1
    `,
    [name],
  );
  return rows.map((row) => ({ at: new Date(row.bucket as string).toISOString(), cpuPercent: Number(row.cpu), memoryBytes: Number(row.memory) }));
}

// ---------------------------------------------------------------------------------------------
// Costs, split per organization, and capacity
// ---------------------------------------------------------------------------------------------

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export { INFRA_COST_CATEGORIES };

export async function listInfraCosts(month?: string) {
  if (month && !MONTH_PATTERN.test(month)) throw new PlatformError('Mês inválido (use AAAA-MM).');
  const rows = month
    ? await sql`SELECT * FROM infra_costs WHERE deleted_at IS NULL AND month = ${month} ORDER BY created_at`
    : await sql`SELECT * FROM infra_costs WHERE deleted_at IS NULL ORDER BY month DESC, created_at LIMIT 500`;
  return rows.map((row) => ({
    id: String(row.id),
    month: String(row.month),
    category: String(row.category) as CostCategory,
    categoryLabel: INFRA_COST_CATEGORIES[String(row.category) as CostCategory] ?? String(row.category),
    description: String(row.description ?? ''),
    amount: Number(row.amount),
    createdAt: new Date(row.created_at as string).toISOString(),
  }));
}

export async function addInfraCost(input: Record<string, unknown>, actor: { id: string }) {
  const month = String(input.month ?? '');
  const category = String(input.category ?? '');
  const amount = Number(input.amount);
  if (!MONTH_PATTERN.test(month)) throw new PlatformError('Mês inválido (use AAAA-MM).');
  if (!(category in INFRA_COST_CATEGORIES)) throw new PlatformError('Categoria inválida.');
  if (!Number.isFinite(amount) || amount < 0) throw new PlatformError('Informe um valor maior ou igual a zero.');
  const description = String(input.description ?? '').trim().slice(0, 200);
  const rows = await sql`
    INSERT INTO infra_costs (month, category, description, amount, created_by)
    VALUES (${month}, ${category}, ${description}, ${Math.round(amount * 100) / 100}, ${actor.id})
    RETURNING id
  `;
  await recordAudit({ organizationId: null, actorId: actor.id, actorRole: 'platform_owner', action: 'infra_cost.created', targetType: 'infra_cost', targetId: String(rows[0].id), details: { month, category, amount, description } });
  return String(rows[0].id);
}

/** A wrong entry is archived, never removed. */
export async function archiveInfraCost(id: string, actor: { id: string }) {
  const rows = await sql`
    UPDATE infra_costs SET deleted_at = NOW(), deleted_by = ${actor.id}
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING month, category, amount
  `;
  if (!rows[0]) throw new PlatformError('Lançamento não encontrado.', 404);
  await recordAudit({ organizationId: null, actorId: actor.id, actorRole: 'platform_owner', action: 'infra_cost.archived', targetType: 'infra_cost', targetId: id, details: rows[0] });
}

/**
 * How full the night window (23:00–06:00 Brasília) is: browser minutes used by automatic runs on the
 * last nights against what the browser slots can hold. When it gets close to full, it's time for
 * more browsers at once or another VPS.
 */
export async function getNightCapacity(nights = 7) {
  const settings = await getPlatformSettings();
  const rows = await sql`
    SELECT (started_at AT TIME ZONE 'America/Sao_Paulo' - INTERVAL '7 hours')::date AS night,
           COALESCE(SUM(duration_ms), 0)::float AS ms,
           MAX(finished_at) AS last_finished
    FROM porto_sync_log
    WHERE COALESCE(run_trigger, 'auto') = 'auto'
      AND started_at > NOW() - (${Math.min(Math.max(nights, 1), 60)} || ' days')::interval
      AND (EXTRACT(HOUR FROM started_at AT TIME ZONE 'America/Sao_Paulo') >= 23
           OR EXTRACT(HOUR FROM started_at AT TIME ZONE 'America/Sao_Paulo') < 6)
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  const windowMinutes = 7 * 60 * settings.porto.maxBrowsers;
  return {
    maxBrowsers: settings.porto.maxBrowsers,
    windowMinutes,
    nights: rows.map((row) => {
      const minutes = Math.round(Number(row.ms) / 60000);
      return {
        night: String(row.night instanceof Date ? row.night.toISOString().slice(0, 10) : row.night).slice(0, 10),
        browserMinutes: minutes,
        occupancyPercent: Math.round((minutes / windowMinutes) * 1000) / 10,
        lastFinishedAt: row.last_finished ? new Date(row.last_finished as string).toISOString() : null,
      };
    }),
  };
}
