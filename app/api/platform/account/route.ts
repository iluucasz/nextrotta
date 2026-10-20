import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PlatformError } from '@/lib/platform/errors';
import { readJson, withPlatformOwner } from '@/lib/platform/route';

export const runtime = 'nodejs';

/** The owner's own account. */
export async function GET(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const rows = await sql`SELECT name, email, last_login_at AS "lastLoginAt" FROM users WHERE id = ${owner.userId}`;
    return NextResponse.json({ account: rows[0] });
  });
}

/** { currentPassword, newPassword } — changes the owner's password (at least 10 characters). */
export async function PUT(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const body = await readJson(request);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (newPassword.length < 10) throw new PlatformError('A nova senha precisa ter pelo menos 10 caracteres.');
    if (newPassword === currentPassword) throw new PlatformError('A nova senha precisa ser diferente da atual.');

    const rows = await sql`SELECT password_hash FROM users WHERE id = ${owner.userId}`;
    if (!rows[0] || !(await verifyPassword(currentPassword, String(rows[0].password_hash)))) {
      throw new PlatformError('A senha atual está incorreta.', 403);
    }

    await sql`UPDATE users SET password_hash = ${await hashPassword(newPassword)}, updated_at = NOW() WHERE id = ${owner.userId}`;
    await recordAudit({ organizationId: null, actorId: owner.userId, actorRole: 'platform_owner', action: 'account.password_changed' });
    return NextResponse.json({ success: true });
  });
}

/** { name, email } — the owner's name and login e-mail (unique across the platform). */
export async function PATCH(request: NextRequest) {
  return withPlatformOwner(request, async (owner) => {
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!name) throw new PlatformError('Informe seu nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PlatformError('Informe um e-mail válido.');

    const taken = await sql`SELECT 1 FROM users WHERE email = ${email} AND id <> ${owner.userId} AND deleted_at IS NULL`;
    if (taken.length) throw new PlatformError('Este e-mail já é usado por outra conta.', 409);

    const before = (await sql`SELECT name, email FROM users WHERE id = ${owner.userId}`)[0];
    await sql`UPDATE users SET name = ${name}, email = ${email}, updated_at = NOW() WHERE id = ${owner.userId}`;
    await recordAudit({
      organizationId: null,
      actorId: owner.userId,
      actorRole: 'platform_owner',
      action: 'account.updated',
      details: { before, after: { name, email } },
    });
    return NextResponse.json({ success: true });
  });
}
