'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, LifeBuoy, Maximize2, Megaphone, Wrench } from 'lucide-react';
import { dateTime, NewTicketForm, StatusPill, useTickets } from '@/components/support-center';
import { formatTicketNumber, REPORT_TYPE_LABELS } from '@/lib/reports';
import { stripSceneMarkers } from '@/lib/news-scenes';
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

const date = (value: string, time = false) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    ...(time ? { timeStyle: 'short' as const } : {}),
  }).format(new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value));

/** "## subtitle" and "**bold**", the same light markup the platform panel writes. */
function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-foreground/80">
      {stripSceneMarkers(text)
        .split('\n')
        .filter((line) => line.trim())
        .map((line, index) =>
          line.startsWith('## ') ? (
            <h4 key={index} className="pt-2 font-semibold text-foreground">
              {line.slice(3)}
            </h4>
          ) : line.startsWith('# ') ? (
            <h3 key={index} className="pt-2 text-base font-semibold text-foreground">
              {line.slice(2)}
            </h3>
          ) : (
            <p key={index}>
              {line.split(/(\*\*.*?\*\*)/g).map((part, partIndex) =>
                part.startsWith('**') ? (
                  <strong key={partIndex} className="font-semibold text-foreground">
                    {part.slice(2, -2)}
                  </strong>
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

/** A short plain-text summary: the first lines of the post, without markup, cut at a word. */
function excerpt(body: string, max = 180) {
  const plain = stripSceneMarkers(body)
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).replace(/\s+\S*$/, '')}…`;
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
  destination: 'site' | 'system' | 'both';
};
type NewsData = { posts: NewsPost[]; siteUrl: string | null };

const CATEGORY_LABELS = {
  feature: 'Novo recurso',
  improvement: 'Melhoria',
  fix: 'Correção',
};
const CATEGORY_STYLES = {
  feature: 'bg-emerald-100 text-emerald-800',
  improvement: 'bg-sky-100 text-sky-800',
  fix: 'bg-amber-100 text-amber-800',
};
const NEWS_SEEN_KEY = 'nextrotta-news-seen';

let cachedNews: Promise<NewsData> | null = null;

function loadNews(refresh = false) {
  if (refresh) cachedNews = null;
  if (!cachedNews) {
    cachedNews = fetch('/api/news', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { posts: [] }))
      .then((data: Partial<NewsData>) => ({
        posts: data.posts ?? [],
        siteUrl: data.siteUrl ?? null,
      }))
      .catch(() => ({ posts: [], siteUrl: null }));
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

/** The quiet look of the top bar: no border, a soft tint on hover, so the account stays the strongest thing there. */
const QUIET_BUTTON_CLASS =
  'h-10 gap-2 rounded-lg px-3.5 text-[15px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground';

/** One news summary. Posts that are also on the site open there (with the animated scenes); system-only ones expand in place. */
function NewsItem({ post, siteUrl }: { post: NewsPost; siteUrl: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const onSite = post.destination !== 'system' && Boolean(siteUrl);
  const header = (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${CATEGORY_STYLES[post.category]}`}
        >
          {CATEGORY_LABELS[post.category]}
        </span>
        <time dateTime={post.publishedOn} className="text-xs text-muted-foreground">
          {date(post.publishedOn)}
        </time>
      </div>
      <h3 className="mt-2.5 text-lg font-semibold leading-snug tracking-tight">
        {post.title}
      </h3>
    </>
  );
  const cardClass =
    'block w-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors';

  if (onSite) {
    return (
      <li>
        <a
          href={`${siteUrl}/novidades/${post.id}`}
          target="_blank"
          rel="noopener"
          className={`${cardClass} group hover:border-primary/40 hover:bg-secondary/40`}
        >
          {header}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {excerpt(post.body)}
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
            Ver novidade
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </span>
        </a>
      </li>
    );
  }

  return (
    <li className={cardClass}>
      {header}
      {expanded ? (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {post.imageUrl && <img src={post.imageUrl} alt="" className="mb-3 max-h-64 rounded-lg" />}
          <RichText text={post.body} />
        </div>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{excerpt(post.body)}</p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="mt-3 text-sm font-medium text-primary hover:underline"
      >
        {expanded ? 'Mostrar menos' : 'Ler mais'}
      </button>
    </li>
  );
}

function NewsButton({ compact, quiet }: { compact: boolean; quiet: boolean }) {
  const [data, setData] = useState<NewsData | null>(null);
  const posts = data?.posts ?? null;
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let active = true;
    loadNews(open).then((value) => {
      if (!active) return;
      setData(value);
      const latest = value.posts[0];
      const seen = readSeen();
      setUnread(Boolean(latest) && (!seen || latest.publishedOn > seen));
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
        variant={quiet ? 'ghost' : 'outline'}
        size="sm"
        onClick={show}
        className={quiet ? `relative ${QUIET_BUTTON_CLASS}` : 'relative'}
        title="Novidades"
      >
        <Megaphone className="h-4 w-4" />
        {!compact && <span>Novidades</span>}
        {unread && (
          <span
            className={`absolute h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-card ${quiet ? 'right-2.5 top-2' : '-right-1 -top-1'}`}
            aria-label="Há novidades"
          />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b border-border px-6 py-5 pr-14 sm:px-8">
            <DialogTitle className="text-xl font-semibold tracking-tight">
              Novidades do NextRotta
            </DialogTitle>
            <DialogDescription>
              Melhorias e novos recursos que chegaram ao sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto bg-secondary/30 px-4 py-5 sm:px-8">
            {!posts ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : posts.length ? (
              <ul className="space-y-3">
                {posts.map((post) => (
                  <NewsItem key={post.id} post={post} siteUrl={data?.siteUrl ?? null} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma novidade publicada ainda.
              </p>
            )}
          </div>
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

function ReportButton({ compact, basePath, quiet }: { compact: boolean; basePath: string; quiet: boolean }) {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  return (
    <>
      <Button
        type="button"
        variant={quiet ? 'ghost' : 'outline'}
        size="sm"
        onClick={() => setOpen(true)}
        title="Suporte"
        aria-label="Suporte"
        className={quiet ? QUIET_BUTTON_CLASS : undefined}
      >
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
  quiet = false,
  basePath = '/admin/suporte',
}: {
  compact?: boolean;
  /** Borderless buttons, for the desktop top bar. */
  quiet?: boolean;
  /** Where the support center lives for this user: /admin/suporte or /dashboard/suporte. */
  basePath?: string;
}): ReactNode {
  return (
    <div className={`flex items-center ${quiet ? 'gap-1' : 'gap-2'}`}>
      <NewsButton compact={compact} quiet={quiet} />
      <ReportButton compact={compact} basePath={basePath} quiet={quiet} />
    </div>
  );
}
