// Applies pending SQL migrations from db/migrations in filename order, each in its own
// transaction, and records them in schema_migrations.
//
//   node scripts/migrate.mjs            apply pending migrations
//   node scripts/migrate.mjs --status   list applied/pending without changing anything
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, openPool, parseArgs } from './lib/db.mjs';

const MIGRATIONS_DIR = path.join(ROOT, 'db', 'migrations');

const args = parseArgs();
const { pool, target } = openPool({ migration: true });

try {
  console.log(`Banco de destino: ${target}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((row) => row.version));
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
  const pending = files.filter((name) => !applied.has(name));

  if (args.status) {
    for (const name of files) console.log(`${applied.has(name) ? 'aplicada ' : 'pendente '} ${name}`);
    process.exit(0);
  }

  if (!pending.length) {
    console.log('Nenhuma migração pendente.');
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    for (const name of pending) {
      const sqlText = readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sqlText);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`aplicada  ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`falhou    ${name}: ${error.message}`);
        process.exitCode = 1;
        break;
      }
    }
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
