import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { PlatformShell } from '@/components/platform/shell';
import { verifyToken } from '@/lib/auth';
import { isPlatformRole } from '@/lib/platform-access';
import { sql } from '@/lib/db';

// Authorization is owned by the middleware; here we only read the owner's name for the header.
async function ownerProfile() {
  const token = (await cookies()).get('auth-token')?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || !isPlatformRole(payload.role)) return { name: 'Admin da plataforma', email: '', role: 'platform_owner' as const };
  const rows = await sql`SELECT name, email FROM users WHERE id = ${payload.userId}`;
  return { name: String(rows[0]?.name || (payload.role === 'platform_support' ? 'Atendente' : 'Admin da plataforma')), email: String(rows[0]?.email ?? ''), role: payload.role };
}

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell owner={await ownerProfile()}>{children}</PlatformShell>;
}
