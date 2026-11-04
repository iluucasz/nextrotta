import { NextRequest, NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { hashPassword, verifyAuth, verifyPassword } from '@/lib/auth';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';

const MIN_PASSWORD_LENGTH = 8;

/** Whether this user must choose a new password now (the one they have was set by the platform owner). */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  // The owner working inside an account, or an admin previewing, never changes the person's password.
  if (auth.impersonationId || auth.preview) return NextResponse.json({ mustChange: false });
  const rows = await sql`SELECT must_change_password FROM users WHERE id = ${auth.userId} AND deleted_at IS NULL`;
  return NextResponse.json({ mustChange: Boolean(rows[0]?.must_change_password) });
}

/** { newPassword } — sets the password chosen after a reset. Only works while the temporary password is pending. */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth || auth.impersonationId || auth.preview) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` }, { status: 400 });
  }

  const rows = await sql`SELECT password_hash, must_change_password FROM users WHERE id = ${auth.userId} AND deleted_at IS NULL`;
  if (!rows[0]?.must_change_password) {
    return NextResponse.json({ error: 'Sua senha não está pendente de troca.' }, { status: 409 });
  }
  if (await verifyPassword(newPassword, String(rows[0].password_hash))) {
    return NextResponse.json({ error: 'Escolha uma senha diferente da temporária.' }, { status: 400 });
  }

  await sql`
    UPDATE users
    SET password_hash = ${await hashPassword(newPassword)}, must_change_password = FALSE, updated_at = NOW()
    WHERE id = ${auth.userId}
  `;
  await recordAudit({
    organizationId: auth.organizationId ?? null,
    actorId: auth.userId,
    actorRole: auth.role,
    action: 'user.password_changed',
    targetType: 'user',
    targetId: auth.userId,
  });
  return NextResponse.json({ success: true });
}
