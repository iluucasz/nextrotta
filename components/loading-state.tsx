export function LoadingState({ label = 'Carregando dados...' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background" role="status">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-6 py-4 text-sm text-muted-foreground shadow-[0_4px_14px_#25233702]">
        <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}
