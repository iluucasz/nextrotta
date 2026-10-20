'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bug, ImagePlus, LifeBuoy, Lightbulb, Loader2, MessageSquare, Plus, Search, Send } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  formatTicketNumber,
  REPORT_TYPE_LABELS,
  reportStatusLabels,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_HINTS,
  SUPPORT_CATEGORY_LABELS,
  type ReportType,
  type SupportCategory,
} from '@/lib/reports';

/**
 * The organization's help desk: support tickets, bugs and suggestions — opened from the top bar's
 * "Reports" box or from the full page (/admin/suporte, /dashboard/suporte).
 */

export type TicketStatus = 'new' | 'investigating' | 'resolved' | 'not_reproduced';

export type TicketRow = {
  id: string;
  type: ReportType;
  ticketNumber: number | null;
  supportCategory: SupportCategory | null;
  title: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  userName: string | null;
  messagesCount: number;
};

type TicketDetail = {
  report: TicketRow & { description: string; hasScreenshot: boolean; pageUrl: string | null };
  messages: Array<{ id: string; authorName: string; fromOwner: boolean; text: string; createdAt: string }>;
};

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const TYPE_ICONS: Record<ReportType, typeof LifeBuoy> = { support: LifeBuoy, bug: Bug, suggestion: Lightbulb };

const TYPE_COPY: Record<ReportType, { title: string; titlePlaceholder: string; description: string; submit: string; sent: string }> = {
  support: {
    title: 'Assunto',
    titlePlaceholder: 'Ex.: como cadastrar um novo técnico?',
    description: 'Explique do que você precisa',
    submit: 'Abrir chamado',
    sent: 'Chamado aberto',
  },
  bug: {
    title: 'O que deu errado?',
    titlePlaceholder: 'Ex.: a folha de setembro não fecha',
    description: 'Conte o que você fez e o que aconteceu',
    submit: 'Enviar bug',
    sent: 'Bug recebido',
  },
  suggestion: {
    title: 'Qual é a sua ideia?',
    titlePlaceholder: 'Ex.: receber um resumo semanal da operação',
    description: 'Como essa melhoria ajudaria no seu dia a dia?',
    submit: 'Enviar sugestão',
    sent: 'Sugestão recebida',
  },
};

export const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '—';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Não foi possível concluir a ação.');
  return data as T;
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function statusTone(status: TicketStatus) {
  if (status === 'resolved') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'not_reproduced') return 'border-border bg-secondary text-muted-foreground';
  if (status === 'investigating') return 'border-sky-200 bg-sky-50 text-sky-800';
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

export function StatusPill({ type, status }: { type: ReportType; status: TicketStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusTone(status)}`}>
      {reportStatusLabels(type)[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// New ticket
// ---------------------------------------------------------------------------------------------

export function NewTicketForm({
  initialType = 'support',
  basePath,
  onCreated,
}: {
  initialType?: ReportType;
  /** /admin/suporte or /dashboard/suporte — where the ticket page lives. */
  basePath: string;
  onCreated?: (ticket: { id: string; ticketNumber: number }) => void;
}) {
  const [type, setType] = useState<ReportType>(initialType);
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<{ name: string; dataUrl: string } | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [created, setCreated] = useState<{ id: string; ticketNumber: number; type: ReportType } | null>(null);
  const copy = TYPE_COPY[type];

  async function pickImage(file: File | undefined) {
    setError('');
    if (!file) return setScreenshot(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError('Envie uma imagem PNG, JPG ou WebP.');
    if (file.size > MAX_SCREENSHOT_BYTES) return setError('A imagem passa de 2 MB. Envie uma menor.');
    setScreenshot({ name: file.name, dataUrl: await readAsDataUrl(file) });
  }

  async function submit() {
    if (type === 'support' && !category) {
      setError('Escolha com o que você precisa de ajuda.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const ticket = await request<{ id: string; ticketNumber: number }>('/api/bug-reports', {
        type,
        category: type === 'support' ? category : undefined,
        title,
        description,
        screenshot: screenshot?.dataUrl ?? null,
        pageUrl: window.location.href,
        userAgent: navigator.userAgent,
        appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
      });
      setCreated({ ...ticket, type });
      setTitle('');
      setDescription('');
      setScreenshot(null);
      setCategory(null);
      onCreated?.(ticket);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  if (created) {
    return (
      <div className="space-y-3 py-6 text-center" role="status">
        <p className="text-sm font-medium text-muted-foreground">{TYPE_COPY[created.type].sent}</p>
        <p className="text-3xl font-semibold tracking-tight">{formatTicketNumber(created.ticketNumber)}</p>
        <p className="text-sm text-muted-foreground">Guarde este número. Nossa equipe responde por aqui e você acompanha tudo na central de suporte.</p>
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Button asChild>
            <Link href={`${basePath}/${created.id}`}>Acompanhar chamado</Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => setCreated(null)}>
            Abrir outro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo">
        {(['support', 'bug', 'suggestion'] as ReportType[]).map((option) => {
          const Icon = TYPE_ICONS[option];
          const active = option === type;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setType(option);
                setError('');
              }}
              className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
              }`}
            >
              <Icon className="h-4 w-4" />
              {REPORT_TYPE_LABELS[option]}
            </button>
          );
        })}
      </div>

      {type === 'support' ? (
        <div className="space-y-1.5">
          <Label>Com o que você precisa de ajuda?</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {SUPPORT_CATEGORIES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setCategory(option);
                  setError('');
                }}
                aria-pressed={category === option}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  category === option ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'
                }`}
              >
                <span className={`block text-sm font-medium ${category === option ? 'text-primary' : ''}`}>{SUPPORT_CATEGORY_LABELS[option]}</span>
                <span className="block text-xs text-muted-foreground">{SUPPORT_CATEGORY_HINTS[option]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor={`ticket-title-${type}`}>{copy.title}</Label>
        <Input
          id={`ticket-title-${type}`}
          required
          minLength={3}
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={copy.titlePlaceholder}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`ticket-description-${type}`}>{copy.description}</Label>
        <Textarea
          id={`ticket-description-${type}`}
          required
          minLength={10}
          maxLength={10000}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`ticket-screenshot-${type}`}>Captura de tela (opcional, até 2 MB)</Label>
        <label
          htmlFor={`ticket-screenshot-${type}`}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
        >
          <ImagePlus className="h-4 w-4" />
          {screenshot ? screenshot.name : 'Escolher imagem'}
        </label>
        <input
          id={`ticket-screenshot-${type}`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => void pickImage(event.target.files?.[0])}
        />
      </div>
      <p className="text-xs text-muted-foreground">Enviamos junto o endereço desta página, o navegador e a versão do sistema para entender melhor o seu caso.</p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={sending}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? 'Enviando…' : copy.submit}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Ticket list (full page)
// ---------------------------------------------------------------------------------------------

export function useTickets() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    request<{ bugs: TicketRow[] }>('/api/bug-reports')
      .then((data) => {
        setTickets(data.bugs);
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.'));
  }, []);
  useEffect(reload, [reload]);
  return { tickets, error, reload };
}

const STATUS_FILTERS: Array<{ value: 'all' | 'open' | 'closed'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'open', label: 'Em aberto' },
  { value: 'closed', label: 'Finalizados' },
];

export function SupportCenter({ basePath, showAuthor }: { basePath: string; showAuthor: boolean }) {
  const { tickets, error, reload } = useTickets();
  const [creating, setCreating] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | ReportType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [search, setSearch] = useState('');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase().replace(/^#/, '');
    return (tickets ?? []).filter((ticket) => {
      if (typeFilter !== 'all' && ticket.type !== typeFilter) return false;
      const closed = ticket.status === 'resolved' || ticket.status === 'not_reproduced';
      if (statusFilter === 'open' && closed) return false;
      if (statusFilter === 'closed' && !closed) return false;
      if (!term) return true;
      return `${ticket.ticketNumber ?? ''} ${ticket.title} ${ticket.userName ?? ''}`.toLowerCase().includes(term);
    });
  }, [tickets, typeFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const list = tickets ?? [];
    return {
      open: list.filter((ticket) => ticket.status === 'new').length,
      inProgress: list.filter((ticket) => ticket.status === 'investigating').length,
      done: list.filter((ticket) => ticket.status === 'resolved' || ticket.status === 'not_reproduced').length,
    };
  }, [tickets]);

  return (
    <>
      <PageHeader eyebrow="Atendimento" title="Suporte" description="Abra chamados de suporte, reporte bugs e envie sugestões. Acompanhe cada um pelo número.">
        <Button type="button" onClick={() => setCreating((value) => !value)}>
          <Plus className="h-4 w-4" />
          {creating ? 'Fechar formulário' : 'Novo chamado'}
        </Button>
      </PageHeader>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Abertos', value: counts.open, hint: 'Aguardando a nossa equipe' },
          { label: 'Em atendimento', value: counts.inProgress, hint: 'Nossa equipe está cuidando' },
          { label: 'Finalizados', value: counts.done, hint: 'Resolvidos ou encerrados' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{tickets ? card.value : '—'}</p>
            <p className="text-xs text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>

      {creating ? (
        <DataPanel title="Novo chamado" description="Escolha o tipo e conte o que você precisa." className="mb-4">
          <NewTicketForm basePath={basePath} onCreated={reload} />
        </DataPanel>
      ) : null}

      <DataPanel title="Seus chamados" description={showAuthor ? 'Todos os chamados abertos pela sua empresa.' : 'Os chamados que você abriu.'}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="flex min-w-56 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por número ou assunto"
              className="min-h-10 w-full bg-transparent text-sm outline-none"
              aria-label="Buscar chamados"
            />
          </label>
          <select
            aria-label="Tipo"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as 'all' | ReportType)}
            className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="all">Todos os tipos</option>
            {(['support', 'bug', 'suggestion'] as ReportType[]).map((type) => (
              <option key={type} value={type}>
                {REPORT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-input p-0.5" role="group" aria-label="Situação">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatusFilter(option.value)}
                className={`rounded px-3 py-1.5 text-sm ${statusFilter === option.value ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !tickets ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando chamados…
          </p>
        ) : !visible.length ? (
          <div className="py-10 text-center">
            <LifeBuoy className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">{tickets.length ? 'Nenhum chamado neste filtro.' : 'Você ainda não abriu nenhum chamado.'}</p>
            {!tickets.length ? (
              <Button type="button" variant="outline" className="mt-3" onClick={() => setCreating(true)}>
                Abrir o primeiro chamado
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Nº</th>
                  <th className="py-2 pr-3 font-medium">Assunto</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  {showAuthor ? <th className="py-2 pr-3 font-medium">Aberto por</th> : null}
                  <th className="py-2 pr-3 font-medium">Aberto em</th>
                  <th className="py-2 pr-3 font-medium">Atualizado</th>
                  <th className="py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((ticket) => (
                  <tr key={ticket.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                    <td className="py-3 pr-3 font-mono font-medium">
                      <Link href={`${basePath}/${ticket.id}`}>{formatTicketNumber(ticket.ticketNumber)}</Link>
                    </td>
                    <td className="max-w-80 py-3 pr-3">
                      <Link href={`${basePath}/${ticket.id}`} className="block truncate font-medium hover:underline">
                        {ticket.title}
                      </Link>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" /> {ticket.messagesCount} mensagem(ns)
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      {REPORT_TYPE_LABELS[ticket.type]}
                      {ticket.supportCategory ? <span className="block text-xs text-muted-foreground">{SUPPORT_CATEGORY_LABELS[ticket.supportCategory]}</span> : null}
                    </td>
                    {showAuthor ? <td className="py-3 pr-3">{ticket.userName ?? '—'}</td> : null}
                    <td className="py-3 pr-3 tabular-nums">{dateTime(ticket.createdAt)}</td>
                    <td className="py-3 pr-3 tabular-nums">{dateTime(ticket.updatedAt)}</td>
                    <td className="py-3">
                      <StatusPill type={ticket.type} status={ticket.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// One ticket (full page)
// ---------------------------------------------------------------------------------------------

export function TicketPage({ id, basePath }: { id: string; basePath: string }) {
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState('');

  const load = useCallback(() => {
    request<TicketDetail>(`/api/bug-reports/${id}`)
      .then(setDetail)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Chamado não encontrado.'));
  }, [id]);
  useEffect(load, [load]);

  async function reply() {
    setSending(true);
    setReplyError('');
    try {
      setDetail(await request<TicketDetail>(`/api/bug-reports/${id}`, { text }));
      setText('');
    } catch (reason) {
      setReplyError(reason instanceof Error ? reason.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  const back = (
    <Link href={basePath} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Voltar aos chamados
    </Link>
  );

  if (error) {
    return (
      <>
        {back}
        <p className="text-sm text-destructive">{error}</p>
      </>
    );
  }
  if (!detail) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando chamado…
      </p>
    );
  }

  const { report, messages } = detail;
  const closed = report.status === 'resolved' || report.status === 'not_reproduced';
  const facts: Array<[string, React.ReactNode]> = [
    ['Número', <span key="n" className="font-mono">{formatTicketNumber(report.ticketNumber)}</span>],
    ['Tipo', REPORT_TYPE_LABELS[report.type]],
    ...(report.supportCategory ? ([['Assunto', SUPPORT_CATEGORY_LABELS[report.supportCategory]]] as Array<[string, React.ReactNode]>) : []),
    ['Situação', <StatusPill key="s" type={report.type} status={report.status} />],
    ['Aberto em', dateTime(report.createdAt)],
    ['Aberto por', report.userName ?? '—'],
    ['Última atualização', dateTime(report.updatedAt)],
    ...(report.resolvedAt ? ([['Finalizado em', dateTime(report.resolvedAt)]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <>
      {back}
      <PageHeader eyebrow={`Chamado ${formatTicketNumber(report.ticketNumber)}`} title={report.title} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="space-y-4">
          <DataPanel title="Descrição">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{report.description}</p>
            {report.hasScreenshot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/bug-reports/${id}/screenshot`} alt="Captura de tela enviada" className="mt-4 max-h-96 rounded-md border" />
            ) : null}
          </DataPanel>

          <DataPanel title="Conversa" description="As respostas da equipe NextRotta aparecem aqui.">
            <ol className="space-y-3">
              {messages.map((message) => (
                <li
                  key={message.id}
                  className={`rounded-lg border px-4 py-3 text-sm ${message.fromOwner ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-secondary/40'}`}
                >
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {message.fromOwner ? 'Equipe NextRotta' : message.authorName} · {dateTime(message.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                </li>
              ))}
              {!messages.length ? <li className="text-sm text-muted-foreground">Nossa equipe ainda não respondeu. Você recebe a resposta por aqui.</li> : null}
            </ol>

            <form
              className="mt-4 space-y-2 border-t border-border pt-4"
              onSubmit={(event) => {
                event.preventDefault();
                void reply();
              }}
            >
              <Label htmlFor="ticket-reply">{closed ? 'Responder (reabre o chamado)' : 'Responder'}</Label>
              <Textarea id="ticket-reply" rows={4} value={text} onChange={(event) => setText(event.target.value)} />
              {replyError ? <p className="text-sm text-destructive">{replyError}</p> : null}
              <div className="flex justify-end">
                <Button type="submit" disabled={!text.trim() || sending}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? 'Enviando…' : 'Enviar resposta'}
                </Button>
              </div>
            </form>
          </DataPanel>
        </div>

        <DataPanel title="Detalhes do chamado">
          <dl className="space-y-3 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </DataPanel>
      </div>
    </>
  );
}
