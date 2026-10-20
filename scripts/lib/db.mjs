// Shared setup for the maintenance scripts: loads the env file, opens a pooled (WebSocket)
// connection — needed for transactions and multi-statement SQL, which the HTTP driver can't do —
// and describes the target database so the operator can see where writes are going.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, neonConfig } from '@neondatabase/serverless';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnv() {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(ROOT, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** Host and database name only — never prints credentials. */
export function describeDatabase(url) {
  const parsed = new URL(url);
  return `${parsed.hostname}/${parsed.pathname.replace(/^\//, '')}`;
}

export function openPool({ migration = false } = {}) {
  loadEnv();

  // Schema changes may use a more privileged role than the app's runtime connection.
  const url = (migration && process.env.DATABASE_MIGRATION_URL) || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL não encontrado em .env.local nem em .env');
  }

  neonConfig.webSocketConstructor = globalThis.WebSocket;
  return { pool: new Pool({ connectionString: url }), target: describeDatabase(url) };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}
