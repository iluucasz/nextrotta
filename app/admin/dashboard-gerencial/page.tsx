import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ManagementDashboard } from './management-dashboard';

export const metadata: Metadata = { title: 'Dashboard Gerencial | NextRotta' };
export const dynamic = 'force-dynamic';

export default async function ManagementDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/dashboard');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return <ManagementDashboard userName={user.name} today={today} />;
}
