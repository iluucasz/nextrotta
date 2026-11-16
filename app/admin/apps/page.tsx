'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AppsCatalog } from '@/components/apps/apps-catalog';
import { LoadingShell } from '@/components/page-skeleton';
import { useAppSession } from '@/hooks/use-app-session';
import '../dashboard-gerencial/management-dashboard.css';

export default function AdminAppsPage() {
  const { user, loading } = useAppSession();
  const [features, setFeatures] = useState<string[] | null>(null);

  // Same source the menu uses to hide what the plan does not include.
  useEffect(() => {
    let active = true;
    fetch('/api/organization/status', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) setFeatures(data.features ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (loading || !user) return <LoadingShell role="admin" />;
  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <AppsCatalog features={features} />
    </AppShell>
  );
}
