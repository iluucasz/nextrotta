'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { LifeBuoy, Maximize2, Megaphone, Wrench } from 'lucide-react';
import { dateTime, NewTicketForm, StatusPill, useTickets } from '@/components/support-center';
import { formatTicketNumber, REPORT_TYPE_LABELS } from '@/lib/reports';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/** Shown to every user of every organization while the platform owner has maintenance on. */
export function MaintenanceBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-sky-300 bg-sky-50 px-4 py-2 text-sm text-sky-950"
      role="status"
    >
      <Wrench className="h-4 w-4 shrink-0" />
      <span>
        <strong className="font-semibold">Manutenção programada.</strong>{' '}
        {message}
      </span>
    </div>
  );
}

const MODULE_STATUS_POLL_MS = 2 * 60_000;

type ModuleStatus = { porto: string; whatsapp: string };

/**
 * Admin-only notice while a VPS module (Porto robot, WhatsApp) doesn't answer — says which ones are
 * under maintenance and what stops meanwhile (lib/system-status.ts).
 */
export function ModuleStatusBanner() {
  const [status, setStatus] = useState<ModuleStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch('/api/system-status', { cache: 'no-store' });
        if (!response.ok) return;
        const data = (await response.json()) as ModuleStatus;
        if (!cancelled) setStatus(data);
      } catch {
        // The app itself being unreachable is not what this notice is about.
      }
    }

    void load();
    const intervalId = window.setInterval(() => void load(), MODULE_STATUS_POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', load);
    };
  }, []);

  const portoDown = status?.porto === 'down';
  const whatsappDown = status?.whatsapp === 'down';
  if (!portoDown && !whatsappDown) return null;

  const title = portoDown && whatsappDown ? 'Módulos Porto e WhatsApp em manutenção' : `Módulo ${portoDown ? 'Porto' : 'WhatsApp'} em manutenção`;
  const effects = [portoDown ? 'a importação de horas e escala do Porto' : null, whatsappDown ? 'os envios de WhatsApp' : null].filter(Boolean);

  return (
    <div className="mb-4 flex gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
      <Wrench className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5">
          O servidor da automação não está respondendo. Enquanto isso, {effects.join(' e ')}{' '}
          {whatsappDown ? 'ficam parados' : 'fica parada'}. O resto do sistema funciona normalmente.
        </p>
      </div>
    </div>
  );
}

const date = (value: string, time = false) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    ...(time ? { timeStyle: 'short' as const } : {}),
  }).format(new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value));

/** "## subtitle" and "**bold**", the same light markup the platform panel writes. */
function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {text.split('\n').map((line, index) =>
        line.startsWith('## ') ? (
          <h4 key={index} className="pt-2 font-semibold">
            {line.slice(3)}
          </h4>
        ) : line.startsWith('# ') ? (
          <h3 key={index} className="pt-2 text-base font-semibold">
            {line.slice(2)}
          </h3>
        ) : (
          <p key={index}>
            {line
              .split(/(\*\*.*?\*\*)/g)
              .map((part, partIndex) =>
                part.startsWith('**') ? (
                  <strong key={partIndex}>{part.slice(2, -2)}</strong>
                ) : (
                  part
                ),
              )}
          </p>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------------------------

type NewsPost = {
  id: string;
  title: string;
  publishedOn: string;
  category: 'feature' | 'improvement' | 'fix';
  body: string;
  imageUrl: string | null;
};

const CATEGORY_LABELS = {
  feature: 'Novo recurso',
  improvement: 'Melhoria',
  fix: 'Correção',
};
const NEWS_SEEN_KEY = 'nextrotta-news-seen';

let cachedNews: Promise<NewsPost[]> | null = null;

function loadNews(refresh = false) {
  if (refresh) cachedNews = null;
  if (!cachedNews) {
    cachedNews = fetch('/api/news', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { posts: [] }))
      .then((data: { posts: NewsPost[] }) => data.posts)
      .catch(() => []);
  }
  return cachedNews;
}

function readSeen() {
  try {
    return window.localStorage.getItem(NEWS_SEEN_KEY);
  } catch {
    return null;
  }
}

function NewsButton({ compact }: { compact: boolean }) {
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let active = true;
    loadNews(open).then((value) => {
      if (!active) return;
      setPosts(value);
      const seen = readSeen();
      setUnread(Boolean(value[0]) && (!seen || value[0].publishedOn > seen));
    });
    return () => {
      active = false;
    };
  }, [open]);

  function show() {
    setOpen(true);
    setUnread(false);
    try {
      if (posts?.[0])
        window.localStorage.setItem(NEWS_SEEN_KEY, posts[0].publishedOn);
    } catch {
      // Private mode: the dot just shows again next time.
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={show}
        className="relative"
        title="Novidades"
      >
        <Megaphone className="h-4 w-4" />
        {!compact && <span>Novidades</span>}
        {unread && (
          <span
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-500"
            aria-label="Há novidades"
          />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novidades do NextRotta</DialogTitle>
            <DialogDescription>
              Melhorias e novos recursos que chegaram ao sistema.
            </DialogDescription>
          </DialogHeader>
          {!posts ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : posts.length ? (
            <div className="space-y-6">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="border-b border-border pb-6 last:border-b-0"
                >
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[post.category]} · {date(post.publishedOn)}
                  </p>
                  <h3 className="mt-1 text-base font-semibold">{post.title}</h3>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {post.imageUrl && (
                    <img
                      src={post.imageUrl}
                      alt=""
                      className="mt-3 max-h-64 rounded-md"
                    />
                  )}
                  <div className="mt-3">
                    <RichText text={post.body} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma novidade publicada ainda.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Reports: support tickets, bugs and suggestions (the full page lives at <basePath>)
// ---------------------------------------------------------------------------------------------

function RecentTickets({ basePath, version }: { basePath: string; version: number }) {
  const { tickets, error, reload } = useTickets();
  useEffect(() => {
    if (version) reload();
  }, [version, reload]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!tickets) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!tickets.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Você ainda não abriu nenhum chamado.</p>;
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {tickets.slice(0, 8).map((ticket) => (
          <li key={ticket.id}>
            <Link href={`${basePath}/${ticket.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-secondary/40">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  <span className="font-mono text-muted-foreground">{formatTicketNumber(ticket.ticketNumber)}</span> {ticket.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {REPORT_TYPE_LABELS[ticket.type]} · {dateTime(ticket.createdAt)} · {ticket.messagesCount} mensagem(ns)
                </span>
              </span>
              <StatusPill type={ticket.type} status={ticket.status} />
            </Link>
          </li>
        ))}
      </ul>
      {tickets.length > 8 ? (
        <p className="text-center text-xs text-muted-foreground">Mostrando os 8 mais recentes. Veja todos na central de suporte.</p>
      ) : null}
    </div>
  );
}

function ReportButton({ compact, basePath }: { compact: boolean; basePath: string }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} title="Suporte" aria-label="Suporte">
        <LifeBuoy className="h-4 w-4" />
        {!compact && <span>Suporte</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3 pr-6">
              <div>
                <DialogTitle>Suporte</DialogTitle>
                <DialogDescription>Abra um chamado de suporte, reporte um bug ou envie uma sugestão.</DialogDescription>
              </div>
              <Button asChild variant="outline" size="sm" onClick={() => setOpen(false)}>
                <Link href={basePath}>
                  <Maximize2 className="h-4 w-4" />
                  Abrir central de suporte
                </Link>
              </Button>
            </div>
          </DialogHeader>
          <Tabs defaultValue="new">
            <TabsList>
              <TabsTrigger value="new">Novo chamado</TabsTrigger>
              <TabsTrigger value="mine">Meus chamados</TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="pt-4">
              <NewTicketForm basePath={basePath} onCreated={() => setVersion((value) => value + 1)} />
            </TabsContent>
            <TabsContent value="mine" className="pt-4">
              <RecentTickets basePath={basePath} version={version} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** News and support, in the organization system's top bar. */
export function SupportActions({
  compact = false,
  basePath = '/admin/suporte',
}: {
  compact?: boolean;
  /** Where the support center lives for this user: /admin/suporte or /dashboard/suporte. */
  basePath?: string;
}): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <NewsButton compact={compact} />
      <ReportButton compact={compact} basePath={basePath} />
    </div>
  );
}
