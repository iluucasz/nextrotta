/**
 * The Apps catalog: every extra integration the platform offers lives here, so the sidebar stays short
 * (one "Apps" entry) instead of growing a link per integration. To add an app, add an entry below; it shows
 * up in /admin/apps with its card, category and button. No other screen needs to change.
 */

export type AppStatus = 'available' | 'soon';

export interface AppEntry {
  /** Stable slug, never reused. */
  id: string;
  name: string;
  /** One line shown on the card. */
  summary: string;
  /** Groups the cards and feeds the filter chips ("Vendas", "Comunicação"...). */
  category: string;
  /** Key of the icon in `components/apps/apps-catalog.tsx` (falls back to a puzzle piece). */
  icon?: string;
  /** Where the app opens (its own screen). Without it the card has no open button. */
  href?: string;
  /** Plan feature that unlocks the app; empty = available to every company. */
  feature?: string;
  status: AppStatus;
}

export const APP_CATALOG: AppEntry[] = [
  {
    id: 'carros',
    name: 'Carros',
    summary: 'Os carros da empresa, quem está com cada um e os vencimentos.',
    category: 'Frota',
    icon: 'car',
    href: '/admin/apps/carros',
    status: 'available',
  },
];

/** Categories in the order they first appear in the catalog. */
export function appCategories(apps: AppEntry[]): string[] {
  return Array.from(new Set(apps.map((app) => app.category)));
}

/** Search by name, summary or category (accent- and case-insensitive); an empty term returns everything. */
export function filterApps(apps: AppEntry[], term: string, category: string | null): AppEntry[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = normalize(term.trim());
  return apps.filter((app) => {
    if (category && app.category !== category) return false;
    if (!needle) return true;
    return normalize(`${app.name} ${app.summary} ${app.category}`).includes(needle);
  });
}
