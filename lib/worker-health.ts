// Relative imports only: compiled into the VPS worker (worker/tsconfig.json).
import { hostname } from 'node:os';
import { sql } from './db';

const WORKER_ID = process.env.WORKER_ID || hostname();
const STARTED_AT = new Date().toISOString();

/** The worker's pulse: the Operation screen shows it offline when this stops. */
export async function recordHeartbeat(version: string | null = process.env.npm_package_version ?? null) {
  await sql`
    INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at, version)
    VALUES (${WORKER_ID}, ${STARTED_AT}, NOW(), ${version})
    ON CONFLICT (worker_id) DO UPDATE
    SET started_at = EXCLUDED.started_at, last_seen_at = NOW(), version = EXCLUDED.version
  `;
}

/** Records one run of a platform job (billing, credits…) with its outcome. Rethrows failures. */
export async function trackRun<T>(job: string, organizationId: string | null, run: () => Promise<T>): Promise<T> {
  const rows = await sql`
    INSERT INTO worker_runs (job, organization_id) VALUES (${job}, ${organizationId}) RETURNING id
  `;
  const id = rows[0].id;
  try {
    const result = await run();
    await sql`UPDATE worker_runs SET status = 'success', finished_at = NOW() WHERE id = ${id}`;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`UPDATE worker_runs SET status = 'error', finished_at = NOW(), error = ${message.slice(0, 2000)} WHERE id = ${id}`;
    throw error;
  }
}
