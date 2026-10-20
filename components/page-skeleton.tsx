import { AppShell } from '@/components/app-shell';

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-secondary ${className}`} aria-hidden="true" />;
}

/**
 * Approximates the typical admin/dashboard page shape (header, metric-card row, one panel with a
 * few rows) so the loading state looks like the real screen settling in, instead of a blank page
 * with a spinner pill.
 */
export function PageSkeleton() {
  return (
    <div className="space-y-5 p-4 sm:p-6" role="status" aria-label="Carregando conteúdo da página">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2.5">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-7 w-56 max-w-full" />
          <SkeletonBlock className="h-4 w-80 max-w-full" />
        </div>
        <SkeletonBlock className="h-10 w-36" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border bg-card p-4 shadow-[0_4px_14px_#25233702] sm:p-[18px]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-3">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-6 w-16" />
              </div>
              <SkeletonBlock className="h-8 w-8 shrink-0 rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card shadow-[0_4px_14px_#25233702]">
        <div className="flex flex-col gap-3 px-4 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <SkeletonBlock className="h-4 w-40" />
          <SkeletonBlock className="h-8 w-28" />
        </div>
        <div className="space-y-3 px-4 pb-5 sm:px-5">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonBlock key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

interface LoadingShellProps {
  role: 'admin' | 'technician';
}

/**
 * Drop-in replacement for <LoadingState /> — renders the real AppShell (sidebar + topbar) right
 * away instead of a blank page, with PageSkeleton filling the content area while data loads.
 */
export function LoadingShell({ role }: LoadingShellProps) {
  return (
    <AppShell role={role}>
      <PageSkeleton />
    </AppShell>
  );
}
