'use client';

import type { KeyboardEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TabItem<T extends string> = {
  value: T;
  label: string;
  icon: LucideIcon;
  /** A count beside the label (open fines...). Nothing when 0 or absent. */
  badge?: number;
  /** The count is something urgent: red instead of grey. */
  urgent?: boolean;
};

/** The big tabs of the Carros screen: large enough to read and to touch (48 px high), the open one underlined. */
export function BigTabs<T extends string>({ items, value, onChange, label }: { items: TabItem<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = items.findIndex((item) => item.value === value);
    const next = items[(index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length];
    onChange(next.value);
    // Move the focus with the selection, like any tab bar.
    requestAnimationFrame(() => document.getElementById(`cr-tab-${next.value}`)?.focus());
  }

  return (
    <div className="cr-bigtabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.value === value;
        return (
          <button
            key={item.value}
            id={`cr-tab-${item.value}`}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cn('cr-bigtab', active && 'is-active')}
            onClick={() => onChange(item.value)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
            {item.badge ? <span className={cn('cr-bigtab-badge', item.urgent && 'is-urgent')}>{item.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
