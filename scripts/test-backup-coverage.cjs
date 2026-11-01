// Run with: node scripts/test-backup-coverage.cjs   (reads the database in .env, writes nothing)
// Every table that carries an organization's data must be in the backups, or be named as left out on purpose: a table
// created tomorrow cannot silently stay out of them. And every table a restore touches must really exist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
process.loadEnvFile(path.join(__dirname, '..', '.env'));
const { neon } = require('@neondatabase/serverless');
const { BACKUP_TABLES, BACKUP_EXCLUDED, RESTORE_TABLES } = require('../lib/backup/tables.ts');

(async () => {
  const sql = neon(process.env.DATABASE_URL);
  console.log('banco:', new URL(process.env.DATABASE_URL).hostname);
  const withOrganization = (
    await sql`SELECT DISTINCT c.table_name FROM information_schema.columns c
              JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
              WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'`
  ).map((row) => row.table_name);

  const known = new Set([...BACKUP_TABLES, ...BACKUP_EXCLUDED]);
  const missing = withOrganization.filter((table) => !known.has(table));
  assert.deepEqual(missing, [], `tabelas com dados da empresa fora dos backups (ponha em BACKUP_TABLES ou em BACKUP_EXCLUDED): ${missing.join(', ')}`);

  const gone = [...BACKUP_TABLES].filter((table) => !withOrganization.includes(table));
  assert.deepEqual(gone, [], `tabelas dos backups que não existem: ${gone.join(', ')}`);

  const overlap = BACKUP_TABLES.filter((table) => BACKUP_EXCLUDED.includes(table));
  assert.deepEqual(overlap, [], 'uma tabela não pode estar nas duas listas');

  const notInBackup = RESTORE_TABLES.map((entry) => entry.table).filter((table) => !BACKUP_TABLES.includes(table));
  assert.deepEqual(notInBackup, [], 'a restauração mexe numa tabela que o backup não guarda');

  // each restored table has the columns the restore relies on
  const columns = await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY(${RESTORE_TABLES.map((entry) => entry.table)})`;
  const byTable = {};
  for (const row of columns) (byTable[row.table_name] ??= new Set()).add(row.column_name);
  for (const entry of RESTORE_TABLES) {
    const have = byTable[entry.table];
    for (const key of entry.keys) assert.ok(have?.has(key), `${entry.table}.${key}`);
    if (entry.soft) assert.ok(have.has('deleted_at'), `${entry.table}.deleted_at`);
    if (entry.zeroColumn) assert.ok(have.has(entry.zeroColumn), `${entry.table}.${entry.zeroColumn}`);
  }

  console.log(`cobertura ok: ${BACKUP_TABLES.length} tabelas guardadas, ${BACKUP_EXCLUDED.length} deixadas de fora de propósito, ${RESTORE_TABLES.length} restauradas`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
