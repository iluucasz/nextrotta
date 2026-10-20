'use client';

import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { SupportCenter } from '@/components/support-center';
import { useAppSession } from '@/hooks/use-app-session';

export default function TechnicianSupportPage() {
  const { user, loading } = useAppSession();
  if (loading || !user) return <LoadingShell role="technician" />;
  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <SupportCenter basePath="/dashboard/suporte" showAuthor={false} />
    </AppShell>
  );
}
