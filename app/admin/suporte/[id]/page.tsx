'use client';

import { use } from 'react';
import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { TicketPage } from '@/components/support-center';
import { useAppSession } from '@/hooks/use-app-session';

export default function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, loading } = useAppSession();
  if (loading || !user) return <LoadingShell role="admin" />;
  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <TicketPage id={id} basePath="/admin/suporte" />
    </AppShell>
  );
}
