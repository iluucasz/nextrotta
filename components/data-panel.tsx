import { cn } from '@/lib/utils';

interface DataPanelProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

export function DataPanel({ title, description, children, action, className, contentClassName, titleClassName, descriptionClassName }: DataPanelProps) {
  return (
    <section className={cn('app-data-panel min-w-0 rounded-xl border border-border bg-card shadow-[0_4px_14px_#25233702]', className)}>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 className={cn('text-sm font-semibold tracking-tight text-foreground', titleClassName)}>{title}</h2>
          {description ? <p className={cn('mt-1.5 text-xs leading-relaxed text-muted-foreground', descriptionClassName)}>{description}</p> : null}
        </div>
        {action}
      </div>
      <div className={cn('px-4 pb-5 sm:px-5', contentClassName)}>{children}</div>
    </section>
  );
}
