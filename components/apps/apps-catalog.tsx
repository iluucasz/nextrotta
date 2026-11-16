'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, MessageCircle, Package, Puzzle, Search, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { APP_CATALOG, appCategories, filterApps, type AppEntry } from '@/lib/apps/catalog';
import './apps.css';

const ICONS: Record<string, LucideIcon> = {
  message: MessageCircle,
  package: Package,
  shield: ShieldCheck,
  sparkles: Sparkles,
};

function AppCard({ app }: { app: AppEntry }) {
  const Icon = (app.icon && ICONS[app.icon]) || Puzzle;
  const soon = app.status === 'soon' || !app.href;
  return (
    <li className="ap-card">
      <span className="ap-card-icon">
        <Icon size={22} />
      </span>
      <div className="ap-card-text">
        <h3>{app.name}</h3>
        <p>{app.summary}</p>
      </div>
      <div className="ap-card-foot">
        <span className="ap-card-category">{app.category}</span>
        {soon ? (
          <span className="ap-soon">Em breve</span>
        ) : (
          <Link href={app.href!} className="mg-button ap-open">
            Abrir <ArrowUpRight size={15} />
          </Link>
        )}
      </div>
    </li>
  );
}

/** /admin/apps: the catalog of extra integrations (cards with search and category filter). */
export function AppsCatalog({ apps = APP_CATALOG, features = null }: { apps?: AppEntry[]; features?: string[] | null }) {
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  // An app tied to a plan feature only shows for companies that have it (features null = no plan yet, nothing restricted).
  const visible = useMemo(() => apps.filter((app) => !app.feature || !features || features.includes(app.feature)), [apps, features]);
  const categories = useMemo(() => appCategories(visible), [visible]);
  const filtered = useMemo(() => filterApps(visible, term, category), [visible, term, category]);

  return (
    <div className="mg-dashboard ap">
      <header className="mg-page-heading">
        <div>
          <div className="mg-eyebrow">
            <span /> CENTRAL <span className="mg-eyebrow-divider">/</span> NEXTROTTA
          </div>
          <h1>
            Apps<span>.</span>
          </h1>
          <p>Integrações e extras para a sua empresa.</p>
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="ap-empty">Os apps novos aparecem aqui.</p>
      ) : (
        <>
          <div className="ap-toolbar">
            <label className="ap-search">
              <Search size={16} aria-hidden />
              <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Buscar app"
                aria-label="Buscar app"
              />
            </label>
            {categories.length > 1 ? (
              <div className="ap-chips" role="group" aria-label="Categorias">
                <button type="button" className={`ap-chip${category === null ? ' is-selected' : ''}`} onClick={() => setCategory(null)}>
                  Todos
                </button>
                {categories.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`ap-chip${category === name ? ' is-selected' : ''}`}
                    onClick={() => setCategory(category === name ? null : name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {filtered.length === 0 ? (
            <p className="ap-empty">Nenhum app encontrado.</p>
          ) : (
            <ul className="ap-grid">
              {filtered.map((app) => (
                <AppCard key={app.id} app={app} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
