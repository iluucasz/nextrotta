'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, Eraser, Info, OctagonAlert, type LucideIcon } from 'lucide-react';
import { SegmentedControl } from '@/components/modal-kit';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { kindLabel, SEVERITY_LABEL } from '@/lib/notification-meta';
import type { NotificationItem, NotificationSeverity } from '@/lib/notifications';

type Filter = 'all' | 'company' | 'system';

const SEVERITY_STYLE: Record<NotificationSeverity, { icon: LucideIcon; circle: string }> = {
  info: { icon: Info, circle: 'bg-sky-100 text-sky-700' },
  success: { icon: CheckCircle2, circle: 'bg-emerald-100 text-emerald-700' },
  warning: { icon: AlertTriangle, circle: 'bg-amber-100 text-amber-700' },
  critical: { icon: OctagonAlert, circle: 'bg-rose-100 text-rose-700' },
};

const POLL_MS = 60_000;
/** The system looks for things worth telling (modules down, folha left open...) this often while the page stays open. */
const CHECK_MS = 5 * 60_000;

function timeAgo(iso: string) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'agora';
}

/**
 * The bell in the top bar: what is going on in the company (charges, support, the Porto robot, the escala running
 * out) and the notices from the NextRotta for everyone. Opens a short list; reading one marks it as read.
 */
export function NotificationsBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (check = false) => {
    try {
      const response = await fetch(`/api/notifications${check ? '?check=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { items: NotificationItem[]; unread: number };
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // Offline or signed out: the bell just keeps what it had.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load(true);
    let lastCheck = Date.now();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const due = Date.now() - lastCheck >= CHECK_MS;
      if (due) lastCheck = Date.now();
      load(due);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function markRead(ids: string[] | 'all') {
    const unreadIds = ids === 'all' ? items.filter((item) => !item.read).map((item) => item.id) : ids.filter((id) => items.some((item) => item.id === id && !item.read));
    if (!unreadIds.length && ids !== 'all') return;

    // Optimistic: the dot goes away at once; the next load confirms it.
    setItems((current) => current.map((item) => (ids === 'all' || ids.includes(item.id) ? { ...item, read: true } : item)));
    setUnread((current) => (ids === 'all' ? 0 : Math.max(0, current - unreadIds.length)));

    await fetch('/api/notifications/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
    }).catch(() => undefined);
  }

  /** Clears from the bell only (nothing is deleted); the notifications page keeps them in "Limpas". */
  async function clear(ids: string[] | 'all') {
    const cleared = ids === 'all' ? items.map((item) => item.id) : ids;
    setItems((current) => current.filter((item) => !cleared.includes(item.id)));
    setUnread((current) => Math.max(0, current - items.filter((item) => cleared.includes(item.id) && !item.read).length));

    await fetch('/api/notifications/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
    }).catch(() => undefined);
    load();
  }

  const visible = items.filter((item) => filter === 'all' || item.scope === filter);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary"
          aria-label={unread ? `Notificações: ${unread} não ${unread === 1 ? 'lida' : 'lidas'}` : 'Notificações'}
          title="Notificações"
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-card">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Notificações</p>
          <button
            type="button"
            onClick={() => markRead('all')}
            disabled={!unread}
            className="text-[13px] font-medium text-primary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:no-underline"
          >
            Marcar todas como lidas
          </button>
        </div>

        <div className="border-b border-border px-4 py-2.5">
          <SegmentedControl
            label="Quais notificações mostrar"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'Todas' },
              { value: 'company', label: 'Da empresa' },
              { value: 'system', label: 'Do NextRotta' },
            ]}
          />
        </div>

        <div className="max-h-[22rem] overflow-y-auto">
          {visible.length ? (
            <ul>
              {visible.map((item) => {
                const style = SEVERITY_STYLE[item.severity];
                const Icon = style.icon;
                const content = (
                  <>
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${style.circle}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm leading-snug ${item.read ? 'text-foreground' : 'font-semibold text-foreground'}`}>
                        <span className="sr-only">{SEVERITY_LABEL[item.severity]}: </span>
                        {item.title}
                      </span>
                      {item.body ? <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-muted-foreground">{item.body}</span> : null}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.scope === 'system' ? 'NextRotta' : kindLabel(item.kind)} · {timeAgo(item.createdAt)}
                      </span>
                    </span>
                    {item.read ? null : <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Não lida" />}
                  </>
                );
                const className = 'flex w-full items-start gap-3 border-b border-border py-3 pl-4 pr-10 text-left transition-colors last:border-b-0 hover:bg-secondary/60';

                return (
                  <li key={item.id} className="group relative">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className={className}
                        onClick={() => {
                          markRead([item.id]);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </Link>
                    ) : (
                      <button type="button" className={className} onClick={() => markRead([item.id])}>
                        {content}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => clear([item.id])}
                      className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      aria-label="Limpar esta notificação"
                      title="Limpar"
                    >
                      <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-6 py-10 text-center">
              <Bell className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">{loaded ? 'Nenhuma notificação por aqui' : 'Carregando...'}</p>
              {loaded ? (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {filter === 'system' ? 'Os avisos do NextRotta aparecem aqui.' : filter === 'company' ? 'Cobranças, chamados e avisos da sua empresa aparecem aqui.' : 'Quando algo precisar da sua atenção, aparece aqui.'}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={() => clear('all')}
            disabled={!items.length}
            className="text-[13px] font-medium text-muted-foreground hover:text-foreground hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-50"
          >
            Limpar todas
          </button>
          <Link href="/admin/notificacoes" onClick={() => setOpen(false)} className="text-[13px] font-medium text-primary hover:underline">
            Ver todas
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
