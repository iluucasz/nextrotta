'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, RotateCcw, X } from 'lucide-react';
import {
  NOTICE_CATEGORIES,
  NOTICE_CATEGORY_LABELS,
  NOTICE_SEVERITIES,
  NOTICE_SEVERITY_LABELS,
  type NoticeCategory,
  type NoticeSeverity,
} from '@/lib/platform/notice-meta';
import { api, useResource } from './api';
import { useNotify } from './notice';
import { useIsOwner } from './role';
import { Confirm, Empty, ErrorState, Loading, Panel } from './ui';
import './notice-inbox.css';

type Item = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  category: NoticeCategory;
  severity: NoticeSeverity;
  title: string;
  body: string;
  href: string | null;
  occurrences: number;
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  read: boolean;
  cleared: boolean;
};

type Summary = { bySeverity: Record<NoticeSeverity, number>; unread: number; byCategory: Record<string, number> };
type Response = { items: Item[]; hasMore: boolean; summary: Summary };

const PAGE = 50;

function dayLabel(iso: string) {
  const day = (value: Date) => value.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const when = new Date(iso);
  const today = new Date();
  if (day(when) === day(today)) return 'Hoje';
  if (day(when) === day(new Date(today.getTime() - 86_400_000))) return 'Ontem';
  return when.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long' });
}

function ago(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** The inbox of the NextRotta's own people: what is going on in the companies and in the platform. */
export function NoticeInbox() {
  const notify = useNotify();
  const owner = useIsOwner();
  const [view, setView] = useState<'active' | 'cleared'>('active');
  const [severity, setSeverity] = useState<NoticeSeverity | ''>('');
  const [category, setCategory] = useState<NoticeCategory | ''>('');
  const [organizationId, setOrganizationId] = useState('');
  const [resolved, setResolved] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [clearing, setClearing] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams({ state: view, limit: String(limit), check: '1' });
    if (severity) params.set('severity', severity);
    if (category) params.set('category', category);
    if (organizationId) params.set('organizationId', organizationId);
    if (resolved) params.set('resolved', '1');
    return `/notices?${params}`;
  }, [view, severity, category, organizationId, resolved, limit]);

  const list = useResource<Response>(query);
  const organizations = useResource<{ organizations: { id: string; name: string }[] }>('/organizations');
  const { reload } = list;

  // A new problem should show up without anyone pressing anything.
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (list.loading && !list.data) return <Loading />;
  if (list.error && !list.data) return <ErrorState message={list.error} onRetry={list.reload} />;

  const items = list.data?.items ?? [];
  const summary = list.data?.summary;
  const categories = NOTICE_CATEGORIES.filter((value) => owner || value === 'support');

  async function act(action: 'read' | 'clear' | 'restore', body: { ids?: string[]; all?: boolean }, done?: string) {
    try {
      await api('/notices', { body: { action, ...body, filters: { severity, category, organizationId, resolved, state: view } } });
      if (done) notify(done);
      reload();
      window.dispatchEvent(new Event('nr-notices-changed'));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Não foi possível concluir.');
    }
  }

  const groups: Array<{ label: string; items: Item[] }> = [];
  for (const item of items) {
    const label = dayLabel(item.lastSeenAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  return (
    <>
      <div className="nr-ni-cards" role="group" aria-label="Filtrar por importância">
        {NOTICE_SEVERITIES.map((value) => (
          <button
            key={value}
            type="button"
            className={`nr-ni-card ${value}`}
            aria-pressed={severity === value}
            onClick={() => setSeverity(severity === value ? '' : value)}
          >
            <span>{NOTICE_SEVERITY_LABELS[value]}</span>
            <strong>{summary?.bySeverity[value] ?? 0}</strong>
            <small>não lidas</small>
          </button>
        ))}
      </div>

      <Panel className="nr-ni-panel">
        <div className="nr-pad nr-ni-body">
        <div className="nr-ni-filters">
          <div className="nr-tabs nr-ni-views" role="tablist" aria-label="Ver">
            <button role="tab" aria-selected={view === 'active'} onClick={() => setView('active')}>
              Ativas
            </button>
            <button role="tab" aria-selected={view === 'cleared'} onClick={() => setView('cleared')}>
              Limpas
            </button>
          </div>
          <label>
            <span>Assunto</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as NoticeCategory | '')}>
              <option value="">Todos</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {NOTICE_CATEGORY_LABELS[value]}
                  {summary?.byCategory[value] ? ` (${summary.byCategory[value]})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Empresa</span>
            <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
              <option value="">Todas</option>
              {(organizations.data?.organizations ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="nr-ni-check">
            <input type="checkbox" checked={resolved} onChange={(event) => setResolved(event.target.checked)} />
            <span>Mostrar resolvidos</span>
          </label>
          {view === 'active' && items.length > 0 && (
            <div className="nr-ni-bulk">
              <button type="button" className="nr-btn" onClick={() => act('read', { all: true }, 'Marcadas como lidas.')}>
                <Check size={14} /> Marcar como lidas
              </button>
              <button type="button" className="nr-btn" onClick={() => setClearing(true)}>
                Limpar as da tela
              </button>
            </div>
          )}
        </div>

        {items.length === 0 ? (
          <Empty
            title={view === 'cleared' ? 'Nada limpo por aqui' : 'Tudo em ordem'}
            text={view === 'cleared' ? 'O que você limpar fica aqui para consulta.' : 'Nenhum alerta com esses filtros.'}
          />
        ) : (
          <div className="nr-ni-list">
            {groups.map((group) => (
              <section key={group.label}>
                <h3 className="nr-ni-day">{group.label}</h3>
                {group.items.map((item) => (
                  <article key={item.id} className={`nr-ni-item ${item.severity} ${item.read ? 'read' : 'unread'} ${item.resolvedAt ? 'resolved' : ''}`}>
                    <span className="nr-ni-bar" aria-hidden="true" />
                    <div className="nr-ni-main">
                      <div className="nr-ni-head">
                        <strong>{item.title}</strong>
                        {!item.read && <i className="nr-ni-dot" aria-label="Não lida" />}
                      </div>
                      {item.body && <p>{item.body}</p>}
                      <div className="nr-ni-meta">
                        <span className="nr-ni-tag">{NOTICE_SEVERITY_LABELS[item.severity]}</span>
                        <span className="nr-ni-tag soft">{NOTICE_CATEGORY_LABELS[item.category]}</span>
                        {item.organizationId && (
                          <Link href={`/plataforma/organizacoes/${item.organizationId}`}>{item.organizationName ?? 'Empresa'}</Link>
                        )}
                        <span>{ago(item.lastSeenAt)}</span>
                        {item.occurrences > 1 && <span>{item.occurrences} ocorrências</span>}
                        {item.resolvedAt && <span className="nr-ni-tag good">Resolvido {ago(item.resolvedAt)}</span>}
                      </div>
                    </div>
                    <div className="nr-ni-actions">
                      {item.href && (
                        <Link
                          href={item.href}
                          className="nr-btn"
                          onClick={() => {
                            if (!item.read) void act('read', { ids: [item.id] });
                          }}
                        >
                          <ExternalLink size={14} /> Abrir
                        </Link>
                      )}
                      {view === 'active' ? (
                        <>
                          {!item.read && (
                            <button type="button" className="nr-ni-icon" title="Marcar como lida" aria-label="Marcar como lida" onClick={() => act('read', { ids: [item.id] })}>
                              <Check size={15} />
                            </button>
                          )}
                          <button type="button" className="nr-ni-icon" title="Limpar" aria-label="Limpar" onClick={() => act('clear', { ids: [item.id] })}>
                            <X size={15} />
                          </button>
                        </>
                      ) : (
                        <button type="button" className="nr-ni-icon" title="Trazer de volta" aria-label="Trazer de volta" onClick={() => act('restore', { ids: [item.id] }, 'Notificação restaurada.')}>
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </section>
            ))}
            {list.data?.hasMore && (
              <button type="button" className="nr-btn nr-ni-more" onClick={() => setLimit(limit + PAGE)}>
                Mostrar mais
              </button>
            )}
          </div>
        )}
        </div>
      </Panel>

      {clearing && (
        <Confirm
          title="Limpar as notificações da tela?"
          description="Elas saem da sua lista, mas continuam na aba Limpas e para as outras pessoas da equipe. Nada é apagado."
          onClose={() => setClearing(false)}
          onConfirm={async () => {
            await act('clear', { all: true }, 'Notificações limpas.');
          }}
        />
      )}
    </>
  );
}
