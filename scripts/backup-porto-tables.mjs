// Exports the current contents of every table the Porto Seguro integration can write to,
// as an independent local safety net (in addition to Neon's own point-in-time recovery).
//
// Usage:  node scripts/backup-porto-tables.mjs
// Output: backups/<timestamp>/<table>.json  (gitignored — never commit this folder)
//
// To restore a table from a backup, see scripts/restore-porto-table.mjs.

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

loadEnvLocal();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não encontrado em .env.local');
}

const sql = neon(process.env.DATABASE_URL);

// Every table the automation can INSERT/UPDATE/DELETE into.
// technicians is intentionally NOT included — the integration only reads it (QRA lookup), never writes to it.
const TABLES = ['schedule', 'work_hours', 'porto_config', 'porto_sync_log'];

async function tableExists(tableName) {
  const rows = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${tableName}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(ROOT, 'backups', timestamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Backup iniciado em ${outDir}\n`);

  const summary = [];

  for (const table of TABLES) {
    const exists = await tableExists(table);
    if (!exists) {
      console.log(`  [pular] ${table} — tabela ainda não existe no banco.`);
      summary.push({ table, exists: false, rows: 0 });
      continue;
    }

    const rows = await sql.query(`SELECT * FROM ${table}`);
    const filePath = path.join(outDir, `${table}.json`);
    fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
    console.log(`  [ok] ${table} — ${rows.length} linha(s) -> ${path.relative(ROOT, filePath)}`);
    summary.push({ table, exists: true, rows: rows.length });
  }

  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), tables: summary }, null, 2));

  console.log(`\nBackup concluído: ${path.relative(ROOT, outDir)}`);
}

main().catch((error) => {
  console.error('Backup falhou:', error);
  process.exit(1);
});
