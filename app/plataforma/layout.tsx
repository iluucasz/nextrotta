import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { PlatformShell } from '@/components/platform/shell';
import { verifyToken } from '@/lib/auth';
import { sql } from '@/lib/db';

// Authorization is owned by the middleware; here we only read the owner's name for the header.
async function ownerProfile() {
  const token = (await cookies()).get('auth-token')?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || payload.role !== 'platform_owner') return { name: 'Dono da plataforma', email: '' };
  const rows = await sql`SELECT name, email FROM users WHERE id = ${payload.userId}`;
  return { name: String(rows[0]?.name || 'Dono da plataforma'), email: String(rows[0]?.email ?? '') };
}

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  return <PlatformShell owner={await ownerProfile()}>{children}</PlatformShell>;
}
