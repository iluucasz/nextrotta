'use client';

import { AppShell } from '@/components/app-shell';
import { MyFines } from '@/components/apps/cars/my-fines';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { useAppSession } from '@/hooks/use-app-session';
import '../../admin/dashboard-gerencial/management-dashboard.css';

export default function TechnicianFinesPage() {
  const { user, loading } = useAppSession();

  if (loading || !user) return <LoadingShell role="technician" />;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader title="Minhas multas" />
      <MyFines />
    </AppShell>
  );
}
