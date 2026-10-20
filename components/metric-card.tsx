import type { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  hintTone?: 'default' | 'success' | 'warning' | 'danger';
  accentText?: boolean;
}

const toneClasses = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-700',
};

const toneTextClasses = {
  default: 'text-foreground',
  success: 'text-emerald-700',
  warning: 'text-amber-700',
  danger: 'text-rose-700',
};

const toneHintClasses = {
  default: 'text-muted-foreground',
  success: 'text-emerald-700/90',
  warning: 'text-amber-700/90',
  danger: 'text-rose-700/90',
};

export function MetricCard({ title, value, hint, icon: Icon, tone = 'default', hintTone, accentText = false }: MetricCardProps) {
  const resolvedHintClass = hintTone
    ? toneHintClasses[hintTone]
    : accentText
      ? toneHintClasses[tone]
      : 'text-muted-foreground';

  return (
    <section className="app-metric-card min-w-0 rounded-xl border border-border bg-card p-4 shadow-[0_4px_14px_#25233702] sm:p-[18px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className={`mt-3 break-words text-2xl font-semibold leading-tight tracking-tight tabular-nums ${accentText ? toneTextClasses[tone] : 'text-foreground'}`}>{value}</p>
        </div>
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {hint ? <p className={`mt-3 text-xs leading-relaxed ${resolvedHintClass}`}>{hint}</p> : null}
    </section>
  );
}
