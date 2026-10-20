'use client';

import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { SupportCenter } from '@/components/support-center';
import { useAppSession } from '@/hooks/use-app-session';

export default function AdminSupportPage() {
  const { user, loading } = useAppSession();
  if (loading || !user) return <LoadingShell role="admin" />;
  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <SupportCenter basePath="/admin/suporte" showAuthor />
    </AppShell>
  );
}
