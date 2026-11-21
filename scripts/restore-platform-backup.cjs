// Restores a platform backup (the .nrpb file from Operação → Backup da plataforma) into an EMPTY database.
//
//   node scripts/restore-platform-backup.cjs --file <backup.nrpb>            checks the file and prints what it holds (changes nothing)
//   node scripts/restore-platform-backup.cjs --file <backup.nrpb> --apply    writes into the database of DATABASE_URL (.env.local / .env)
//
// Before --apply: create the new database (Neon), point DATABASE_URL at it and run `pnpm db:migrate` so the tables exist.
// The tables must be empty (it refuses otherwise) and it all happens in one transaction: it either restores everything or nothing.
// The key is PLATFORM_BACKUP_KEY, or PORTO_CREDENTIALS_KEY when the first one was never set: the SAME one the backup was made with.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
for (const name of ['.env.local', '.env']) {
  const file = path.join(ROOT, name);
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
require.extensions['.ts'] = (mod, filename) => mod._compile(
  ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  filename,
);
const { openPlatformBackup, platformBackupKey } = require('../lib/platform/backup-format.ts');
const { restorePlatformBackup } = require('../lib/platform/backup-restore.ts');

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1] ?? true;
}

(async () => {
  const file = arg('file');
  if (!file || file === true) {
    console.error('Uso: node scripts/restore-platform-backup.cjs --file <backup.nrpb> [--apply]');
    process.exit(1);
  }
  const key = platformBackupKey();
  if (!key) {
    console.error('Falta a chave: defina PLATFORM_BACKUP_KEY (ou PORTO_CREDENTIALS_KEY) no .env.local.');
    process.exit(1);
  }
  const backup = openPlatformBackup(fs.readFileSync(file), key);
  const rows = Object.values(backup.counts).reduce((total, count) => total + count, 0);
  console.log(`Backup de ${backup.header.createdAt}: ${backup.header.tables.length} tabelas, ${rows} linhas. Arquivo íntegro.`);
  for (const [table, count] of Object.entries(backup.counts)) if (count) console.log(`  ${table}: ${count}`);

  if (!arg('apply')) {
    console.log('\nNada foi alterado. Para restaurar de verdade, rode de novo com --apply.');
    return;
  }

  const { Pool, neonConfig } = require('@neondatabase/serverless');
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  const url = new URL(process.env.DATABASE_URL);
  console.log(`\nRestaurando em ${url.hostname}${url.pathname} ...`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await restorePlatformBackup(client, 'public', backup);
    await client.query('COMMIT');
    console.log(`Pronto: ${Object.values(result.inserted).reduce((total, count) => total + count, 0)} linhas restauradas.`);
    if (result.skippedTables.length) console.log(`Tabelas do backup que não existem neste banco (puladas): ${result.skippedTables.join(', ')}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error(`\nA restauração foi desfeita (nada mudou no banco): ${error.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
