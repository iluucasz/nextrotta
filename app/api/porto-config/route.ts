import { NextRequest, NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { encryptPortoPassword } from '@/lib/porto-crypto';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { notifyWorkerRefresh } from '@/lib/porto-worker-client';

export const runtime = 'nodejs';

const SYNC_LOG_LIMIT = 10;

async function requireAdmin(request: NextRequest) {
  const auth = await verifyOrganizationAuth(request);
  return auth?.role === 'admin' ? auth : null;
}

function normalizeCpf(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

function serializeConfigRow(row: Record<string, unknown> | undefined) {
  if (!row) {
    return {
      cpf: '',
      has_password: false,
      automation_enabled: false,
      dry_run_only: true,
      last_hours_import_at: null,
      last_hours_import_status: null,
      last_schedule_check_at: null,
      last_schedule_import_month: null,
      last_schedule_import_status: null,
      last_error: null,
      updated_at: null,
    };
  }

  return {
    cpf: row.cpf ?? '',
    has_password: Boolean(row.encrypted_password),
    automation_enabled: Boolean(row.automation_enabled),
    dry_run_only: row.dry_run_only === undefined ? true : Boolean(row.dry_run_only),
    last_hours_import_at: row.last_hours_import_at ?? null,
    last_hours_import_status: row.last_hours_import_status ?? null,
    last_schedule_check_at: row.last_schedule_check_at ?? null,
    last_schedule_import_month: row.last_schedule_import_month ?? null,
    last_schedule_import_status: row.last_schedule_import_status ?? null,
    last_error: row.last_error ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'porto');
    if (featureBlocked) return featureBlocked;

    const [rows, logs] = await Promise.all([
      sql`SELECT * FROM porto_config WHERE organization_id = ${auth.organizationId}`,
      sql`
        SELECT id, job_type, started_at, finished_at, status, technicians_processed, rows_written,
               error_message, details, range_start, range_end, layout_suspect
        FROM porto_sync_log
        WHERE organization_id = ${auth.organizationId}
        ORDER BY started_at DESC
        LIMIT ${SYNC_LOG_LIMIT}
      `,
    ]);

    return NextResponse.json({
      config: serializeConfigRow(rows[0] as Record<string, unknown> | undefined),
      logs,
    });
  } catch (error) {
    console.error('[porto-config] Get config error:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdmin(request);
    if (!auth) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'porto');
    if (featureBlocked) return featureBlocked;

    const body = await request.json();
    const cpf = normalizeCpf(body.cpf);
    const password = typeof body.password === 'string' ? body.password : '';
    const automationEnabled = Boolean(body.automation_enabled);
    const dryRunOnly = body.dry_run_only === undefined ? true : Boolean(body.dry_run_only);

    if (!cpf || cpf.length !== 11) {
      return NextResponse.json({ error: 'Informe um CPF válido (11 dígitos).' }, { status: 400 });
    }

    const encryptedPassword = password ? encryptPortoPassword(password) : null;

    const rows = await sql`
      INSERT INTO porto_config (organization_id, cpf, encrypted_password, automation_enabled, dry_run_only, updated_at, updated_by)
      VALUES (${auth.organizationId}, ${cpf}, ${encryptedPassword}, ${automationEnabled}, ${dryRunOnly}, NOW(), ${auth.userId})
      ON CONFLICT (organization_id) DO UPDATE SET
        cpf = EXCLUDED.cpf,
        encrypted_password = COALESCE(EXCLUDED.encrypted_password, porto_config.encrypted_password),
        automation_enabled = EXCLUDED.automation_enabled,
        dry_run_only = EXCLUDED.dry_run_only,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
      RETURNING *
    `;

    await notifyWorkerRefresh();
    return NextResponse.json({ config: serializeConfigRow(rows[0] as Record<string, unknown>) });
  } catch (error) {
    console.error('[porto-config] Update config error:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
