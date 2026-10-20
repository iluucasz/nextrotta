// Creates the platform owner account (the role above every organization).
//
//   node scripts/create-platform-owner.mjs --email voce@exemplo.com --name "Seu Nome"
//
// The password comes from the OWNER_PASSWORD environment variable (kept out of the command line and
// shell history); without it, one is generated and printed once.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { openPool, parseArgs } from './lib/db.mjs';

const args = parseArgs();
const email = typeof args.email === 'string' ? args.email.trim().toLowerCase() : '';
const name = typeof args.name === 'string' ? args.name.trim() : '';

if (!email || !name) {
  console.error('Uso: node scripts/create-platform-owner.mjs --email <email> --name "<nome>"');
  process.exit(1);
}

const chosenPassword = process.env.OWNER_PASSWORD;
if (chosenPassword !== undefined && chosenPassword.length < 8) {
  console.error('OWNER_PASSWORD precisa ter pelo menos 8 caracteres.');
  process.exit(1);
}

const { pool, target } = openPool();

try {
  console.log(`Banco de destino: ${target}`);

  const existing = await pool.query(
    'SELECT id, role FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1',
    [email],
  );
  if (existing.rows.length) {
    console.error(`Já existe um usuário com o e-mail ${email} (papel: ${existing.rows[0].role}).`);
    process.exit(1);
  }

  const password = chosenPassword ?? randomBytes(12).toString('base64url');
  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO users (organization_id, email, name, password_hash, role)
     VALUES (NULL, $1, $2, $3, 'platform_owner')`,
    [email, name, passwordHash],
  );

  console.log('Dono da plataforma criado.');
  console.log(`  E-mail: ${email}`);
  console.log(chosenPassword ? '  Senha:  a informada em OWNER_PASSWORD' : `  Senha:  ${password}`);
} finally {
  await pool.end();
}
