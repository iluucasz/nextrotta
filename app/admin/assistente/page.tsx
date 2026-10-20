'use client';
import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { AssistantWorkspace } from '@/components/assistant/workspace';
import { useAppSession } from '@/hooks/use-app-session';
export default function AssistantPage() {
  const { user, loading } = useAppSession();
  if (loading || !user) return <LoadingShell role="admin" />;
  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <AssistantWorkspace />
    </AppShell>
  );
}
