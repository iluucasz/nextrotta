'use client';

// Building blocks of the management look (Dashboard Gerencial, Faturamento): metric cards with a comparison,
// panels, legends and the chart styling. The classes (`mg-*`) live in app/admin/dashboard-gerencial/
// management-dashboard.css and only apply inside an element with the `mg-dashboard` class.
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, ChartNoAxesCombined, ChevronDown, type LucideIcon } from 'lucide-react';
import { formatPercent } from '@/lib/formatters';
import { variation } from '@/lib/management-dashboard';

export const chartAxis = { tickLine: false, axisLine: false, tick: { fill: '#8a8b9b', fontSize: 14 }, minTickGap: 24 };

export const chartTooltipStyle = {
  border: '1px solid #eeedf4',
  borderRadius: 12,
  boxShadow: '0 8px 30px #25233d12',
  fontSize: 16,
  color: '#252337',
};

export const compactCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function SelectFilter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="mg-select">
      <span>{label}</span>
      <div>
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </label>
  );
}

/** The change from a previous value, green when it is good (`reverse` for costs, where less is better). */
export function Delta({ current, previous, reverse = false }: { current: number; previous: number; reverse?: boolean }) {
  const delta = variation(current, previous);
  if (delta === null) return <span className="mg-delta neutral">Sem base anterior</span>;
  const positive = reverse ? delta < 0 : delta > 0;
  const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`mg-delta ${delta === 0 ? 'neutral' : positive ? 'positive' : 'negative'}`}>
      <Icon size={13} />
      {delta > 0 ? '+' : ''}
      {formatPercent(delta)}
    </span>
  );
}

export function Metric({
  title,
  value,
  hint,
  icon: Icon,
  current,
  previous,
  dark = false,
  reverse = false,
}: {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  current: number;
  previous: number;
  dark?: boolean;
  reverse?: boolean;
}) {
  return (
    <article className={`mg-metric ${dark ? 'mg-metric-dark' : ''}`}>
      <div className="mg-metric-top">
        <span>{title}</span>
        <span className="mg-icon">
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <div className="mg-metric-bottom">
        <Delta current={current} previous={previous} reverse={reverse} />
        <span>{hint}</span>
      </div>
    </article>
  );
}

export function Panel({
  title,
  description,
  badge,
  children,
  className = '',
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mg-panel ${className}`}>
      <header className="mg-panel-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {badge}
      </header>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mg-legend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartEmpty({ message = 'Nenhum registro neste recorte.' }: { message?: string }) {
  return (
    <div className="mg-chart-empty">
      <ChartNoAxesCombined size={26} />
      <p>{message}</p>
      <span>Selecione outro período ou ajuste os filtros.</span>
    </div>
  );
}
