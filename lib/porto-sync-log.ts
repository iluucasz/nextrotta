import { randomUUID } from 'crypto';
import { featureAllowedSql } from './billing/entitlements';
import { sql } from './db';

export type SyncJobType = 'hours' | 'schedule';
export type SyncStatus = 'running' | 'success' | 'partial' | 'error' | 'skipped' | 'dry_run';

export async function getPortoConfig(organizationId: string) {
  const rows = await sql`SELECT * FROM porto_config WHERE organization_id = ${organizationId}`;
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

/** Organizations the worker's daily runs should cover: active, with the automation switched on. */
export async function listOrganizationsWithPortoAutomation(): Promise<string[]> {
  const rows = await sql.query(`
    SELECT c.organization_id
    FROM porto_config c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.automation_enabled = TRUE
      AND o.status IN ('active', 'past_due')
      AND o.deleted_at IS NULL
      AND ${featureAllowedSql('o', 'porto')}
  `);
  return rows.map((row) => String(row.organization_id));
}

/** 'auto' = the worker's schedule; 'manual' = a run started from the screen. */
export type SyncRunTrigger = 'auto' | 'manual';

export async function startSyncLog(organizationId: string, jobType: SyncJobType, runTrigger: SyncRunTrigger): Promise<string> {
  const id = randomUUID();
  await sql`
    INSERT INTO porto_sync_log (id, organization_id, job_type, status, run_trigger)
    VALUES (${id}, ${organizationId}, ${jobType}, 'running', ${runTrigger})
  `;
  return id;
}

export async function finishSyncLog(
  id: string,
  result: {
    status: SyncStatus;
    technicians_processed?: number;
    rows_written?: number;
    details?: unknown;
    error_message?: string | null;
    range?: { start: string; end: string };
    /** The run points at a Porto screen change (see lib/porto-layout.ts). */
    layout_suspect?: boolean;
  },
) {
  await sql`
    UPDATE porto_sync_log
    SET finished_at = NOW(),
        status = ${result.status},
        technicians_processed = ${result.technicians_processed ?? 0},
        rows_written = ${result.rows_written ?? 0},
        details = ${result.details ? JSON.stringify(result.details) : null},
        error_message = ${result.error_message ?? null},
        range_start = ${result.range?.start ?? null},
        range_end = ${result.range?.end ?? null},
        layout_suspect = ${result.layout_suspect ?? false},
        duration_ms = (EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::integer
    WHERE id = ${id}
  `;
}

export async function recordHoursImportResult(
  organizationId: string,
  params: { status: SyncStatus; error?: string | null },
) {
  await sql`
    UPDATE porto_config
    SET last_hours_import_at = NOW(),
        last_hours_import_status = ${params.status},
        last_error = ${params.error ?? null}
    WHERE organization_id = ${organizationId}
  `;
}

export async function recordScheduleCheck(organizationId: string) {
  await sql`UPDATE porto_config SET last_schedule_check_at = NOW() WHERE organization_id = ${organizationId}`;
}

export async function recordScheduleImportResult(
  organizationId: string,
  params: { monthKey: string; status: SyncStatus; error?: string | null },
) {
  await sql`
    UPDATE porto_config
    SET last_schedule_import_month = ${params.monthKey},
        last_schedule_import_status = ${params.status},
        last_schedule_check_at = NOW(),
        last_error = ${params.error ?? null}
    WHERE organization_id = ${organizationId}
  `;
}
