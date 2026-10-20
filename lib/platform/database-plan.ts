import { sql } from '../db';
import { getPlatformSettings } from './settings';
import { getVercelAccount } from './vercel-plan';

/**
 * The database's ceiling for Operação → Capacidade. Neon reports it on the database itself
 * (neon.max_cluster_size); the plan name and compute allowance come from the Vercel Marketplace
 * resource whose id is this Neon project (with VERCEL_API_TOKEN).
 */

const MB = 1024 * 1024;

/** "1GB", "512MB", "10240" (MB) → MB; "-1"/empty → null (no limit reported). */
function sizeToMb(value: string | null) {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb|tb)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'mb').toLowerCase();
  const factor = unit === 'tb' ? 1024 * 1024 : unit === 'gb' ? 1024 : unit === 'kb' ? 1 / 1024 : 1;
  return amount > 0 ? Math.round(amount * factor) : null;
}

export type DatabaseCapacity = {
  usedMb: number;
  /** The total to compare against: the owner's value, else the limit Neon reports. */
  limitMb: number | null;
  source: 'owner' | 'neon' | null;
  projectId: string | null;
  planName: string | null;
  computeTime: string | null;
  quotaExceeded: boolean;
};

export async function getDatabaseCapacity(): Promise<DatabaseCapacity> {
  const [[row], { capacity }, vercel] = await Promise.all([
    sql`
      SELECT pg_database_size(current_database())::float AS bytes,
             current_setting('neon.project_id', true) AS project_id,
             current_setting('neon.max_cluster_size', true) AS max_size
    `,
    getPlatformSettings(),
    getVercelAccount(),
  ]);
  const projectId = row?.project_id ? String(row.project_id) : null;
  const neonMb = sizeToMb(row?.max_size ?? null);
  const integration =
    vercel.configured && vercel.ok && projectId ? vercel.integrations.find((item) => item.externalResourceId === projectId) ?? null : null;
  const ownerMb = capacity.databaseGb === null ? null : capacity.databaseGb * 1024;
  return {
    usedMb: Number(row?.bytes ?? 0) / MB,
    limitMb: ownerMb ?? neonMb,
    source: ownerMb !== null ? 'owner' : neonMb !== null ? 'neon' : null,
    projectId,
    planName: integration?.planName ?? null,
    computeTime: integration?.details.find((detail) => /compute/i.test(detail.label))?.value ?? null,
    quotaExceeded: Boolean(integration?.quotaExceeded),
  };
}
