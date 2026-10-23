'use client';

import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { TechnicianVideoButton } from '@/components/parts/admin/tab-video';
import { TechnicianParts } from '@/components/parts/technician-parts';
import { useAppSession } from '@/hooks/use-app-session';

export default function TechnicianPartsPage() {
  const { user, loading } = useAppSession();

  if (loading || !user) return <LoadingShell role="technician" />;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader title="Minhas peças">
        <TechnicianVideoButton />
      </PageHeader>
      <TechnicianParts />
    </AppShell>
  );
}
