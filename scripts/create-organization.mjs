// Creates an organization and its first admin. Stand-in for the platform owner panel's
// provisioning flow until that exists.
//
//   node scripts/create-organization.mjs --name "Empresa X" --slug empresax \
//     --admin-email admin@empresax.com --admin-name "Fulano"
//
// The admin password is generated and printed once.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { openPool, parseArgs } from './lib/db.mjs';

// Keep in sync with RESERVED_SUBDOMAINS in lib/tenant-host.ts.
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'painel', 'plataforma', 'login', 'suporte', 'status', 'blog', 'docs', 'mail', 'nextrotta-alertas',
]);
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const args = parseArgs();
const name = typeof args.name === 'string' ? args.name.trim() : '';
const slug = typeof args.slug === 'string' ? args.slug.trim().toLowerCase() : '';
const adminEmail = typeof args['admin-email'] === 'string' ? args['admin-email'].trim().toLowerCase() : '';
const adminName = typeof args['admin-name'] === 'string' ? args['admin-name'].trim() : '';

if (!name || !slug || !adminEmail || !adminName) {
  console.error(
    'Uso: node scripts/create-organization.mjs --name "<empresa>" --slug <subdominio> --admin-email <email> --admin-name "<nome>"',
  );
  process.exit(1);
}

if (!SLUG_PATTERN.test(slug) || RESERVED.has(slug)) {
  console.error(`Subdomínio inválido ou reservado: "${slug}". Use letras minúsculas, números e hífen.`);
  process.exit(1);
}

const { pool, target } = openPool();
const client = await pool.connect();

try {
  console.log(`Banco de destino: ${target}`);

  const password = randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);

  await client.query('BEGIN');

  const organization = await client.query(
    `INSERT INTO organizations (slug, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [slug, name],
  );

  await client.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, $4, 'admin')`,
    [organization.rows[0].id, adminEmail, adminName, passwordHash],
  );

  await client.query('INSERT INTO organization_settings (organization_id) VALUES ($1)', [organization.rows[0].id]);

  await client.query('COMMIT');

  console.log('Organização criada.');
  console.log(`  Subdomínio: ${slug}`);
  console.log(`  Admin:      ${adminEmail}`);
  console.log(`  Senha:      ${password}`);
} catch (error) {
  await client.query('ROLLBACK');
  if (error.code === '23505') {
    console.error('Subdomínio ou e-mail já em uso.');
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
