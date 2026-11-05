'use client';

import { AppShell } from '@/components/app-shell';
import { NotificationsCenter } from '@/components/notifications/center';
import { LoadingShell } from '@/components/page-skeleton';
import { useAppSession } from '@/hooks/use-app-session';
import '../dashboard-gerencial/management-dashboard.css';

export default function AdminNotificationsPage() {
  const { user, loading } = useAppSession();
  if (loading || !user) return <LoadingShell role="admin" />;
  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <NotificationsCenter />
    </AppShell>
  );
}
