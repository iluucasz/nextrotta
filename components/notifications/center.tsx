'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCheck, CheckCircle2, CircleHelp, Eraser, Info, LoaderCircle, OctagonAlert, RotateCcw, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpDot, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, SegmentedControl } from '@/components/modal-kit';
import { Panel, SelectFilter } from '@/components/management-ui';
import { brasiliaDateKey } from '@/lib/formatters';
import { kindLabel, SEVERITY_HELP, SEVERITY_LABEL, SEVERITY_ORDER } from '@/lib/notification-meta';
import type { NotificationItem, NotificationSeverity, NotificationSummary } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import './notifications.css';

const PAGE_SIZE = 30;

const SEVERITY_ICON: Record<NotificationSeverity, LucideIcon> = {
  critical: OctagonAlert,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

type State = 'active' | 'cleared';

type Response = { items: NotificationItem[]; unread: number; hasMore: boolean; summary?: NotificationSummary };

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });

/** "Hoje", "Ontem" or the date, in Brasília time. */
function dayLabel(iso: string, now: Date) {
  const key = brasiliaDateKey(new Date(iso));
  if (key === brasiliaDateKey(now)) return 'Hoje';
  if (key === brasiliaDateKey(new Date(now.getTime() - 86_400_000))) return 'Ontem';
  return `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}`;
}

/**
 * The company's notifications in one place: what is critical, what needs attention, what was concluded and what is
 * only a notice. Each person clears their own list (nothing is deleted: "Limpas" brings it back).
 */
export function NotificationsCenter() {
  const [state, setState] = useState<State>('active');
  const [severity, setSeverity] = useState<NotificationSeverity | ''>('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const query = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ state, limit: String(PAGE_SIZE), offset: String(offset) });
      if (severity) params.set('severity', severity);
      if (kind) params.set('kind', kind);
      if (offset === 0) params.set('summary', '1');
      return `/api/notifications?${params.toString()}`;
    },
    [state, severity, kind],
  );

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(query(0), { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar as notificações.');
      const data = (await response.json()) as Response;
      if (id !== request.current) return;
      setItems(data.items);
      setHasMore(data.hasMore);
      if (data.summary) setSummary(data.summary);
    } catch (reason) {
      if (id === request.current) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const response = await fetch(query(items.length), { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as Response;
      setItems((current) => [...current, ...data.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setHasMore(data.hasMore);
    } catch {
      setError('Não foi possível carregar mais.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error();
      await load();
    } catch {
      setError('Não foi possível concluir. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  const filters = { ...(severity ? { severity } : {}), ...(kind ? { kind } : {}) };
  const clearOne = (id: string) => post('/api/notifications/clear', { ids: [id] });
  const restoreOne = (id: string) => post('/api/notifications/clear', { ids: [id], restore: true });
  const markAllRead = () => post('/api/notifications/read', { all: true });
  async function clearAll() {
    await post('/api/notifications/clear', state === 'cleared' ? { all: true, restore: true, ...filters } : { all: true, ...filters });
    setConfirmClear(false);
  }

  function open(item: NotificationItem) {
    if (!item.read) {
      setItems((current) => current.map((known) => (known.id === item.id ? { ...known, read: true } : known)));
      void fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [item.id] }) }).catch(() => undefined);
    }
  }

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: NotificationItem[] }> = [];
    for (const item of items) {
      const label = dayLabel(item.createdAt, now);
      const last = result[result.length - 1];
      if (last?.label === label) last.items.push(item);
      else result.push({ label, items: [item] });
    }
    return result;
  }, [items, now]);

  const kinds = useMemo(() => {
    const known = Object.keys(summary?.byKind ?? {});
    if (kind && !known.includes(kind)) known.push(kind);
    return known.sort((a, b) => kindLabel(a).localeCompare(kindLabel(b), 'pt-BR'));
  }, [summary, kind]);

  const shown = state === 'active' ? summary?.active ?? 0 : summary?.cleared ?? 0;
  const help = SEVERITY_ORDER.map((level) => `${SEVERITY_LABEL[level]}: ${SEVERITY_HELP[level]}`).join('\n\n');
  const filtered = Boolean(severity || kind);

  return (
    <div className="mg-dashboard nc">
      <header className="mg-page-heading">
        <div>
          <div className="mg-eyebrow">
            <span /> CENTRAL <span className="mg-eyebrow-divider">/</span> NEXTROTTA
          </div>
          <h1>
            Notificações<span>.</span>
          </h1>
          <p>O que aconteceu na sua empresa e o que precisa de você.</p>
        </div>
        <div className="mg-header-actions nc-actions">
          <button type="button" className="mg-button" onClick={() => void markAllRead()} disabled={busy || !summary?.unread}>
            <CheckCheck size={16} /> Marcar todas como lidas
          </button>
        </div>
      </header>

      <div className="nc-counts" role="group" aria-label="Filtrar por importância">
        {SEVERITY_ORDER.map((level) => {
          const Icon = SEVERITY_ICON[level];
          const selected = severity === level;
          return (
            <button
              key={level}
              type="button"
              className={cn('nc-count', `is-${level}`, selected && 'is-selected')}
              aria-pressed={selected}
              onClick={() => {
                setState('active');
                setSeverity(selected ? '' : level);
              }}
            >
              <span className="nc-count-icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <span className="nc-count-label">{SEVERITY_LABEL[level]}</span>
              <strong>{summary?.bySeverity[level] ?? 0}</strong>
            </button>
          );
        })}
      </div>

      <Panel title="Lista" help={help}>
        <div className="nc-toolbar">
          <SegmentedControl
            label="Quais notificações mostrar"
            value={state}
            onChange={(next) => setState(next)}
            options={[
              { value: 'active', label: `Ativas${summary ? ` (${summary.active})` : ''}` },
              { value: 'cleared', label: `Limpas${summary ? ` (${summary.cleared})` : ''}` },
            ]}
          />
          <SelectFilter label="Área" value={kind} onChange={setKind}>
            <option value="">Todas as áreas</option>
            {kinds.map((value) => (
              <option key={value} value={value}>
                {kindLabel(value)}
              </option>
            ))}
          </SelectFilter>
          <button
            type="button"
            className="mg-button nc-clear-all"
            onClick={() => (state === 'cleared' ? void clearAll() : setConfirmClear(true))}
            disabled={busy || !items.length}
          >
            {state === 'cleared' ? <RotateCcw size={16} /> : <Eraser size={16} />}
            {state === 'cleared' ? 'Restaurar' : 'Limpar'} {filtered ? 'as filtradas' : 'todas'}
          </button>
        </div>

        {error ? (
          <div className="mg-error" role="alert">
            <CircleHelp size={20} />
            <div>
              <strong>{error}</strong>
            </div>
            <button type="button" className="mg-button" onClick={() => void load()}>
              Tentar de novo
            </button>
          </div>
        ) : null}

        {loading && !items.length ? (
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={22} />
            <strong>Carregando</strong>
          </div>
        ) : !items.length ? (
          <p className="nc-empty">{state === 'cleared' ? 'Nenhuma notificação limpa.' : filtered ? 'Nada com esse filtro.' : 'Tudo em dia: nenhuma notificação.'}</p>
        ) : (
          <div className="nc-list" aria-busy={loading}>
            {groups.map((group) => (
              <section key={group.label}>
                <h4 className="nc-day">{group.label}</h4>
                <ul>
                  {group.items.map((item) => {
                    const Icon = SEVERITY_ICON[item.severity];
                    return (
                      <li key={item.id} className={cn('nc-item', `is-${item.severity}`, !item.read && 'is-unread')}>
                        <span className="nc-item-icon" title={SEVERITY_LABEL[item.severity]}>
                          <Icon size={18} aria-hidden="true" />
                          <span className="sr-only">{SEVERITY_LABEL[item.severity]}</span>
                        </span>
                        <div className="nc-item-text">
                          <strong>{item.title}</strong>
                          {item.body ? <p>{item.body}</p> : null}
                          <span className="nc-item-meta">
                            {item.scope === 'system' ? 'NextRotta' : kindLabel(item.kind)} · {clock(item.createdAt)}
                            {!item.read && state === 'active' ? <i aria-label="Não lida" /> : null}
                          </span>
                        </div>
                        <div className="nc-item-actions">
                          {item.href ? (
                            <Link href={item.href} className="mg-button" onClick={() => open(item)}>
                              Abrir
                            </Link>
                          ) : null}
                          {state === 'active' ? (
                            <button type="button" className="mg-button mg-button-icon" onClick={() => void clearOne(item.id)} disabled={busy} aria-label="Limpar esta notificação" title="Limpar">
                              <Eraser size={16} />
                            </button>
                          ) : (
                            <button type="button" className="mg-button mg-button-icon" onClick={() => void restoreOne(item.id)} disabled={busy} aria-label="Restaurar esta notificação" title="Restaurar">
                              <RotateCcw size={16} />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {hasMore ? (
              <button type="button" className="mg-button nc-more" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? 'Carregando…' : 'Mostrar mais'}
              </button>
            ) : null}
          </div>
        )}
        {shown === 0 && state === 'active' && summary && !filtered && summary.cleared > 0 ? (
          <p className="nc-hint">Você limpou {summary.cleared} — veja em “Limpas”.</p>
        ) : null}
      </Panel>

      {confirmClear ? (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirmClear(false)}>
          <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
            <DialogHeader className={MODAL_HEADER_CLASS}>
              <DialogTitle className={MODAL_TITLE_CLASS}>Limpar {filtered ? 'as notificações filtradas' : 'todas as notificações'}?</DialogTitle>
              <DialogDescription className={MODAL_DESCRIPTION_CLASS}>Elas saem da sua lista e do sino. Dá para ver e restaurar em “Limpas”.</DialogDescription>
            </DialogHeader>
            <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
              <Button type="button" variant="outline" onClick={() => setConfirmClear(false)} disabled={busy}>
                Voltar
              </Button>
              <Button type="button" onClick={() => void clearAll()} disabled={busy}>
                {busy ? 'Limpando…' : 'Sim, limpar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
