// Restores ONE table from a backup produced by scripts/backup-porto-tables.mjs.
//
// This is destructive: it deletes existing rows for the given table (scoped to the
// technician_id/date range present in the backup file, when applicable) and re-inserts the
// backed-up rows. Always double-check the printed plan before confirming.
//
// Usage:
//   node scripts/restore-porto-table.mjs <table> <path-to-backup.json> --confirm
//
// Example:
//   node scripts/restore-porto-table.mjs schedule backups/2026-08-20T23-10-00-000Z/schedule.json --confirm

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnvLocal() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local não encontrado — rode este script a partir da raiz do projeto.');
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const ALLOWED_TABLES = new Set(['schedule', 'work_hours', 'porto_config', 'porto_sync_log']);

// Column list + types per table, matching each table's actual schema — used to build a safe
// jsonb_to_recordset cast, the same technique already used by the app's own bulk-write routes.
const TABLE_SPECS = {
  schedule: {
    columns: 'id uuid, technician_id uuid, date date, start_time time, end_time time, status schedule_status, notes text, created_at timestamptz',
    conflictColumn: 'id',
  },
  work_hours: {
    columns: 'id uuid, technician_id uuid, date date, start_time time, end_time time, hours_worked numeric, week_number int, month int, year int, created_at timestamptz, source varchar(16)',
    conflictColumn: 'id',
  },
  porto_config: {
    columns: 'id smallint, cpf text, encrypted_password text, automation_enabled boolean, dry_run_only boolean, last_hours_import_at timestamptz, last_hours_import_status varchar(16), last_schedule_check_at timestamptz, last_schedule_import_month varchar(7), last_schedule_import_status varchar(16), last_error text, updated_at timestamptz, updated_by text',
    conflictColumn: 'id',
  },
  porto_sync_log: {
    columns: 'id text, job_type varchar(16), started_at timestamptz, finished_at timestamptz, status varchar(16), technicians_processed int, rows_written int, details jsonb, error_message text',
    conflictColumn: 'id',
  },
};

async function main() {
  const [table, backupPath, confirmFlag] = process.argv.slice(2);

  if (!table || !backupPath) {
    console.error('Uso: node scripts/restore-porto-table.mjs <table> <backup.json> --confirm');
    console.error(`Tabelas permitidas: ${[...ALLOWED_TABLES].join(', ')}`);
    process.exit(1);
  }

  if (!ALLOWED_TABLES.has(table)) {
    console.error(`Tabela "${table}" não é uma das tabelas restauráveis: ${[...ALLOWED_TABLES].join(', ')}`);
    process.exit(1);
  }

  const resolvedPath = path.resolve(ROOT, backupPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Arquivo de backup não encontrado: ${resolvedPath}`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!Array.isArray(rows)) {
    console.error('O arquivo de backup precisa ser um array de linhas (formato gerado por backup-porto-tables.mjs).');
    process.exit(1);
  }

  console.log(`Plano: restaurar ${rows.length} linha(s) na tabela "${table}" a partir de ${backupPath}`);
  console.log('Isso vai fazer UPSERT (por id) — linhas com o mesmo id existentes na tabela serão sobrescritas com os dados do backup.');
  console.log('Linhas que existem hoje na tabela mas NÃO estão no backup NÃO são apagadas por este script (restauração aditiva, não um espelho exato).');

  if (confirmFlag !== '--confirm') {
    console.log('\nNenhuma alteração feita. Rode novamente com --confirm no final para executar de verdade.');
    return;
  }

  loadEnvLocal();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não encontrado em .env.local');
  }
  const sql = neon(process.env.DATABASE_URL);
  const spec = TABLE_SPECS[table];
  const columnNames = spec.columns.split(',').map((c) => c.trim().split(' ')[0]);

  const result = await sql.query(
    `
      INSERT INTO ${table} (${columnNames.join(', ')})
      SELECT ${columnNames.join(', ')}
      FROM jsonb_to_recordset($1::jsonb) AS item(${spec.columns})
      ON CONFLICT (${spec.conflictColumn}) DO UPDATE SET
        ${columnNames.filter((c) => c !== spec.conflictColumn).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}
      RETURNING ${spec.conflictColumn}
    `,
    [JSON.stringify(rows)],
  );

  console.log(`\nRestauração concluída: ${result.length} linha(s) inserida(s)/atualizada(s) em "${table}".`);
}

main().catch((error) => {
  console.error('Restauração falhou:', error);
  process.exit(1);
});
