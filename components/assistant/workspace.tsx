'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  ArrowDownLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  CalendarClock,
  Copy,
  Download,
  Gift,
  Hourglass,
  History,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { Markdown } from '@/components/markdown';
import './assistant.css';

type Status = {
  available: boolean;
  reason: string | null;
  balance: number;
  creditsPerUse: number;
  impersonating: boolean;
  /** Starter questions built from the organization's data (lib/ai/suggestions.ts). */
  suggestions?: string[];
  conversations: {
    id: string;
    title: string;
    updatedAt: string;
    messages: number;
  }[];
};
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolsUsed: string[];
  credits: number | null;
  /** Follow-up questions the assistant suggested with this answer. */
  suggestions?: string[];
  createdAt: string;
};
type Credits = {
  balance: number;
  monthlyCredits: number;
  planIncludesAi: boolean | null;
  packages: { id: string; name: string; credits: number; price: number }[];
  usage: { month: string; credits: number; uses: number }[];
  entries: {
    id: string;
    kind: string;
    kindLabel: string;
    quantity: number;
    description: string | null;
    createdAt: string;
  }[];
};
type Preferences = {
  enterToSend: boolean;
  showSources: boolean;
  largeText: boolean;
};
type Tab = 'chat' | 'history' | 'credits' | 'settings';
const DEFAULTS: Preferences = {
  enterToSend: true,
  showSources: true,
  largeText: false,
};
const PREF_KEY = 'nextrotta-assistant-preferences';
const tabs = [
  { id: 'chat', label: 'Conversa', icon: MessageCircle },
  { id: 'history', label: 'Histórico', icon: History },
  { id: 'credits', label: 'Consumo', icon: Wallet },
  { id: 'settings', label: 'Preferências', icon: Settings2 },
] as const;
/** While the status (with the organization's own starter questions) is loading. */
const FALLBACK_SUGGESTIONS = [
  'Quanto gastei com folha este mês?',
  'Qual técnico mais produziu este mês?',
  'Quais folhas precisam de atenção?',
  'Como está a escala da equipe?',
];
const toolLabels: Record<string, string> = {
  resumo_da_empresa: 'Empresa',
  listar_tecnicos: 'Técnicos',
  producao_por_tecnico: 'Produção',
  listar_os: 'Ordens de serviço',
  folha_da_competencia: 'Folha',
  horas_trabalhadas: 'Horas',
  robo_do_porto: 'Robô do Porto',
  escala: 'Escala',
  descontos_e_adiantamentos: 'Descontos',
  financeiro_do_mes: 'Financeiro',
};
const number = (value: number) => value.toLocaleString('pt-BR');
const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const monthName = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace('.', '');
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}/${String(year).slice(2)}`;
};
/** Icon per kind of credit movement in the statement. */
const ledgerIcons: Record<string, typeof Sparkles> = {
  consumption: MessageCircle,
  monthly: CalendarClock,
  bonus: Gift,
  purchase: ShoppingBag,
  adjustment: SlidersHorizontal,
  expiration: Hourglass,
};
const time = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
const monthKey = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
};
async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error || 'Não foi possível concluir a ação.');
  return data as T;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AssistantWorkspace({ compact = false }: { compact?: boolean }) {
  const [tab, setTab] = useState<Tab>('chat');
  const [status, setStatus] = useState<Status | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [creditsError, setCreditsError] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [opening, setOpening] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [entryKind, setEntryKind] = useState('all');
  const [buying, setBuying] = useState<string | null>(null);
  const [purchase, setPurchase] = useState<{ invoiceUrl: string | null } | null>(null);
  const [purchaseError, setPurchaseError] = useState('');
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const busy = useRef(false);
  const loadSequence = useRef(0);
  const refreshSequence = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const currentMonth = monthKey();
  const usage = credits?.usage?.find((item) => item.month === currentMonth);
  const title =
    status?.conversations.find((item) => item.id === conversationId)?.title ??
    (conversationId ? 'Conversa em andamento' : 'Nova conversa');

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    setRefreshing(true);
    await Promise.all([
      request<Status>('/api/assistant')
        .then((data) => {
          if (sequence === refreshSequence.current) setStatus(data);
        })
        .catch((reason) => {
          if (sequence === refreshSequence.current) setError(reason.message);
        }),
      request<Credits>('/api/organization/credits')
        .then((data) => {
          if (sequence !== refreshSequence.current) return;
          setCredits(data);
          setCreditsError('');
        })
        .catch((reason) => {
          if (sequence === refreshSequence.current)
            setCreditsError(reason.message);
        }),
    ]);
    if (sequence === refreshSequence.current) setRefreshing(false);
  }, []);
  useEffect(() => {
    void refresh();
    try {
      const value = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      setPrefs({
        enterToSend:
          typeof value.enterToSend === 'boolean' ? value.enterToSend : true,
        showSources:
          typeof value.showSources === 'boolean' ? value.showSources : true,
        largeText: value.largeText === true,
      });
    } catch {
      /* Defaults also work without storage. */
    }
  }, [refresh]);
  useEffect(() => {
    const area = scroll.current;
    if (area)
      area.scrollTo({
        top: messages.length || asking ? area.scrollHeight : 0,
        behavior: messages.length || asking ? 'smooth' : 'instant',
      });
  }, [messages, asking, tab]);

  function preference(key: keyof Preferences, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(next));
      setNotice('Preferências salvas neste navegador.');
    } catch {
      setNotice(
        'Preferências aplicadas nesta sessão. O navegador bloqueou o armazenamento.',
      );
    }
  }
  function startNew() {
    if (busy.current) return;
    loadSequence.current++;
    setOpening(false);
    setConversationId(null);
    setMessages([]);
    setQuestion('');
    setError('');
    setTab('chat');
    input.current?.focus();
  }
  async function open(id: string) {
    if (busy.current) return;
    const sequence = ++loadSequence.current;
    setOpening(true);
    setError('');
    try {
      const data = await request<{ id: string; messages: Message[] }>(
        `/api/assistant/${id}`,
      );
      if (sequence !== loadSequence.current) return;
      setConversationId(data.id);
      setMessages(data.messages);
      setQuestion('');
      setTab('chat');
    } catch (reason) {
      if (sequence === loadSequence.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Não foi possível abrir a conversa.',
        );
    } finally {
      if (sequence === loadSequence.current) setOpening(false);
    }
  }
  async function archive(id: string) {
    if (
      busy.current ||
      !window.confirm(
        'Arquivar esta conversa? Ela deixará de aparecer no seu histórico.',
      )
    )
      return;
    busy.current = true;
    setOpening(true);
    try {
      await request(`/api/assistant/${id}`, 'DELETE');
      loadSequence.current++;
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
      await refresh();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível arquivar.',
      );
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }
  /** Sends the typed question, or `text` when a suggestion was clicked (the typed one stays). */
  async function send(text?: string) {
    const content = (text ?? question).trim();
    if (!content || busy.current || opening || !status?.available) return;
    busy.current = true;
    setAsking(true);
    setError('');
    if (text === undefined) setQuestion('');
    const pending: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content,
      toolsUsed: [],
      credits: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, pending]);
    try {
      const result = await request<{
        conversationId: string;
        message: Message;
        balance: number;
      }>('/api/assistant', 'POST', { question: content, conversationId });
      setConversationId(result.conversationId);
      setMessages((current) => [...current, result.message]);
      setStatus((current) =>
        current ? { ...current, balance: result.balance } : current,
      );
      await refresh();
    } catch (reason) {
      setMessages((current) =>
        current.filter((message) => message.id !== pending.id),
      );
      if (text === undefined) setQuestion(content);
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível responder.',
      );
    } finally {
      busy.current = false;
      setAsking(false);
      input.current?.focus();
    }
  }
  /** Issues the charge for a credit package; the credits arrive once it's paid. */
  async function buy(packageId: string) {
    setBuying(packageId);
    setPurchase(null);
    setPurchaseError('');
    try {
      const result = await request<{ invoiceUrl: string | null }>('/api/organization/credits', 'POST', { packageId });
      setPurchase(result);
      if (result.invoiceUrl) window.open(result.invoiceUrl, '_blank', 'noopener');
      await refresh();
    } catch (reason) {
      setPurchaseError(reason instanceof Error ? reason.message : 'Não foi possível gerar a cobrança.');
    } finally {
      setBuying(null);
    }
  }
  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(message.id);
    } catch {
      setError(
        'Não foi possível copiar. Selecione o texto da resposta para copiar.',
      );
    }
  }

  const summary = (
    <div className="ai-summary">
      <button type="button" onClick={() => setTab('credits')}>
        <span>Créditos disponíveis</span>
        <strong>
          {status ? number(status.balance) : '—'} <Sparkles size={19} />
        </strong>
        <small>Seu saldo para novas consultas</small>
      </button>
      <button type="button" onClick={() => setTab('credits')}>
        <span>Consumo neste mês</span>
        <strong>
          {credits ? number(usage?.credits ?? 0) : '—'}{' '}
          <small>créditos</small>
        </strong>
        <small>
          {credits
            ? `${number(usage?.uses ?? 0)} uso(s) em ${currentMonth.split('-').reverse().join('/')}`
            : 'Carregando consumo…'}
        </small>
      </button>
      {!compact && (
        <div>
          <span>Por pergunta respondida</span>
          <strong>
            {status
              ? status.impersonating
                ? 'Sem débito'
                : number(status.creditsPerUse)
              : '—'}{' '}
            <small>{status?.impersonating ? '' : 'crédito(s)'}</small>
          </strong>
          <Link href="/admin/assinatura">
            Adicionar créditos <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
      </div>
  );

  return (
    <section
      className={`nr-assistant ${compact ? 'is-compact' : ''} ${prefs.largeText ? 'is-large-text' : ''}`}
      aria-label="Assistente de IA"
    >
      {!compact && (
        <header className="ai-page-heading">
          <div>
            <span className="ai-eyebrow">NEXTROTTA / INTELIGÊNCIA</span>
            <h1>Sua operação, em uma conversa.</h1>
            <p>
              Consulte os dados da empresa, encontre respostas e acompanhe seu
              uso de IA.
            </p>
          </div>
          <span className="ai-brand-icon">
            <Sparkles size={30} />
          </span>
        </header>
      )}
      {compact && summary}
      <div className="ai-workspace">
        <aside className="ai-navigation">
          <button
            className="ai-primary ai-new"
            disabled={asking || opening}
            onClick={startNew}
          >
            <Plus size={19} /> Nova conversa
          </button>
          <nav aria-label="Ferramentas do assistente">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => {
                  setTab(id);
                  setNotice('');
                }}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="ai-main">
          <header className="ai-panel-heading">
            <div>
              <h2>
                {tab === 'chat'
                  ? title
                  : tabs.find((item) => item.id === tab)?.label}
              </h2>
              <p>
                {tab === 'chat'
                  ? 'Assistente NextRotta'
                  : tab === 'history'
                    ? 'Retome suas últimas 50 conversas.'
                    : tab === 'credits'
                      ? 'Saldo e movimentações da empresa.'
                      : 'Deixe o assistente do seu jeito.'}
              </p>
            </div>
            <div className="ai-heading-actions">
              {compact && (
                <button
                  aria-label="Nova conversa"
                  title="Nova conversa"
                  disabled={asking || opening}
                  onClick={startNew}
                >
                  <Plus size={19} />
                </button>
              )}
              {tab === 'chat' && messages.length > 0 && (
                <button
                  title="Baixar conversa"
                  aria-label="Baixar conversa"
                  onClick={() =>
                    download(
                      'conversa-nextrotta.txt',
                      messages
                        .map(
                          (m) =>
                            `${m.role === 'user' ? 'Você' : 'NextRotta'} · ${time(m.createdAt)}\n${m.content}`,
                        )
                        .join('\n\n'),
                    )
                  }
                >
                  <Download size={19} />
                </button>
              )}
              <button
                title="Atualizar saldo e histórico"
                aria-label="Atualizar saldo e histórico"
                disabled={refreshing || asking}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  size={18}
                  className={refreshing ? 'animate-spin' : ''}
                />
              </button>
            </div>
          </header>
          {error && (
            <div role="alert" className="ai-error">
              {error}
              <button
                onClick={() => {
                  setError('');
                  void refresh();
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {status?.impersonating && (
            <p className="ai-notice">
              Acesso do dono: suas consultas não descontam créditos da empresa.
            </p>
          )}
          {tab === 'chat' && (
            <>
              {status && !status.available && (
                <p className="ai-notice">
                  {status.reason}{' '}
                  <Link href="/admin/assinatura">Ver assinatura</Link>
                </p>
              )}
              <div
                className="ai-messages"
                ref={scroll}
                aria-label="Mensagens da conversa"
                aria-busy={asking || opening}
              >
                {!messages.length && (
                  <div className="ai-welcome">
                    <span className="ai-welcome-icon">
                      <Sparkles size={32} />
                    </span>
                    <h3>O que vamos descobrir hoje?</h3>
                    <p>
                      {compact ? (
                        'Consulte os dados da sua empresa com uma pergunta.'
                      ) : (
                        <>
                          Comece com uma pergunta sobre sua operação.
                          <br />
                          Eu consulto os dados e organizo a resposta para você.
                        </>
                      )}
                    </p>
                    <div className="ai-suggestions">
                      {(status?.suggestions?.length ? status.suggestions : FALLBACK_SUGGESTIONS)
                        .slice(0, compact ? 4 : 6)
                        .map((text, index) => (
                          <button
                            key={text}
                            type="button"
                            disabled={!status?.available || asking}
                            onClick={() => void send(text)}
                          >
                            <span>0{index + 1}</span>
                            {text}
                            <ArrowUpRight size={17} />
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {messages.map((message, index) => (
                  <article
                    key={message.id}
                    className={`ai-message ${message.role === 'user' ? 'from-user' : 'from-assistant'}`}
                  >
                    <span className="ai-message-author">
                      {message.role === 'user' ? (
                        'Você'
                      ) : (
                        <>
                          <Sparkles size={16} /> NextRotta
                        </>
                      )}
                    </span>
                    <div className="ai-message-body">
                      {message.role === 'user' ? (
                        message.content
                      ) : (
                        <Markdown text={message.content} />
                      )}
                    </div>
                    <footer>
                      <span>
                        {time(message.createdAt)}
                        {message.role === 'assistant' &&
                        message.credits !== null
                          ? ` · ${message.credits} crédito(s)`
                          : ''}
                      </span>
                      {message.role === 'assistant' && (
                        <button
                          onClick={() => void copy(message)}
                          aria-label="Copiar resposta"
                        >
                          {copied === message.id ? (
                            <Check size={16} />
                          ) : (
                            <Copy size={16} />
                          )}
                          {copied === message.id ? 'Copiado' : 'Copiar'}
                        </button>
                      )}
                    </footer>
                    {prefs.showSources && message.toolsUsed.length > 0 && (
                      <div className="ai-sources">
                        Consultou:{' '}
                        {[
                          ...new Set(
                            message.toolsUsed.map(
                              (tool) => toolLabels[tool] ?? tool,
                            ),
                          ),
                        ].join(' · ')}
                      </div>
                    )}
                    {message.role === 'assistant' &&
                      index === messages.length - 1 &&
                      !asking &&
                      (message.suggestions?.length ?? 0) > 0 && (
                        <div className="ai-followups" aria-label="Sugestões de próximas perguntas">
                          {message.suggestions!.map((text) => (
                            <button
                              key={text}
                              type="button"
                              disabled={!status?.available || opening}
                              onClick={() => void send(text)}
                            >
                              {text}
                              <ArrowUpRight size={15} />
                            </button>
                          ))}
                        </div>
                      )}
                  </article>
                ))}
                {asking && (
                  <p className="ai-thinking" role="status">
                    <Loader2 className="animate-spin" size={19} /> Consultando
                    os dados da empresa…
                  </p>
                )}
              </div>
              <form
                className="ai-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <div>
                  <textarea
                    ref={input}
                    aria-label="Sua pergunta"
                    placeholder={
                      status?.available
                        ? 'Pergunte sobre sua operação…'
                        : 'Aguardando disponibilidade do assistente…'
                    }
                    value={question}
                    rows={2}
                    maxLength={2000}
                    disabled={!status?.available || asking || opening}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        prefs.enterToSend &&
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="ai-primary"
                    aria-label="Enviar pergunta"
                    disabled={
                      !status?.available ||
                      asking ||
                      opening ||
                      !question.trim()
                    }
                  >
                    {asking ? (
                      <Loader2 size={22} className="animate-spin" />
                    ) : (
                      <ArrowUp size={22} />
                    )}
                  </button>
                </div>
                <p>
                  <span>
                    {status?.impersonating
                      ? 'Sem consumo de créditos neste acesso'
                      : `${status?.creditsPerUse ?? '—'} crédito(s) por resposta`}
                  </span>
                  <span>{question.length}/2000</span>
                </p>
                <small>
                  O assistente consulta dados, sem alterá-los. Confira
                  informações importantes no sistema.
                </small>
              </form>
            </>
          )}
          {tab === 'history' && (
            <div className="ai-tab-content">
              <label className="ai-search">
                <Search size={19} />
                <input
                  aria-label="Buscar conversa"
                  placeholder="Buscar no histórico…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              {opening && <p role="status">Abrindo conversa…</p>}
              <div className="ai-history">
                {status?.conversations
                  .filter((item) =>
                    item.title
                      .toLocaleLowerCase()
                      .includes(search.toLocaleLowerCase()),
                  )
                  .map((item) => (
                    <div key={item.id}>
                      <button
                        disabled={asking || opening}
                        onClick={() => void open(item.id)}
                      >
                        <MessageCircle size={21} />
                        <span>
                          <strong>{item.title}</strong>
                          <small>
                            {time(item.updatedAt)} · {item.messages} mensagens
                          </small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                      <button
                        aria-label={`Arquivar ${item.title}`}
                        title="Arquivar conversa"
                        disabled={asking || opening}
                        onClick={() => void archive(item.id)}
                      >
                        <Archive size={18} />
                      </button>
                    </div>
                  ))}
              </div>
              {status &&
                !status.conversations.some((item) =>
                  item.title
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                ) && (
                  <p className="ai-empty">
                    {search
                      ? 'Nenhuma conversa encontrada.'
                      : 'Suas conversas salvas vão aparecer aqui.'}
                  </p>
                )}
            </div>
          )}
          {tab === 'credits' && (
            <div className="ai-tab-content ai-consumption">
              {creditsError && (
                <p className="ai-error" role="alert">
                  {creditsError}
                </p>
              )}
              {credits && status && (() => {
                const usedThisMonth = usage?.credits ?? 0;
                const quota = credits.monthlyCredits;
                const quotaPercent = quota ? Math.min(100, Math.round((usedThisMonth / quota) * 100)) : 0;
                const questionsLeft = status.creditsPerUse ? Math.floor(credits.balance / status.creditsPerUse) : 0;
                const months = Array.from({ length: 6 }, (_, index) => {
                  const [year, month] = currentMonth.split('-').map(Number);
                  const key = new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7);
                  const item = credits.usage?.find((row) => row.month === key);
                  return { key, credits: item?.credits ?? 0, uses: item?.uses ?? 0 };
                });
                const maxMonth = Math.max(1, ...months.map((item) => item.credits));
                const entries = credits.entries.filter(
                  (entry) => entryKind === 'all' || (entryKind === 'in' ? entry.quantity > 0 : entry.kind === entryKind),
                );
                return (
                  <>
                    <div className="ai-credit-cards">
                      <div className="is-balance">
                        <span>Créditos disponíveis</span>
                        <strong>{number(credits.balance)}</strong>
                        <small>
                          {status.impersonating
                            ? 'Seu acesso de dono não desconta créditos'
                            : `Dá para cerca de ${number(questionsLeft)} pergunta${questionsLeft === 1 ? '' : 's'}`}
                        </small>
                      </div>
                      <div>
                        <span>Usado neste mês</span>
                        <strong>
                          {number(usedThisMonth)} <small>créditos</small>
                        </strong>
                        <small>
                          {number(usage?.uses ?? 0)} pergunta{(usage?.uses ?? 0) === 1 ? '' : 's'} respondida{(usage?.uses ?? 0) === 1 ? '' : 's'}
                        </small>
                      </div>
                      <div>
                        <span>Cota do plano</span>
                        <strong>
                          {number(quota)} <small>por mês</small>
                        </strong>
                        <small>
                          {credits.planIncludesAi === false
                            ? 'O plano atual não inclui IA'
                            : 'Renova todo mês e não acumula'}
                        </small>
                      </div>
                      <div>
                        <span>Por pergunta</span>
                        <strong>
                          {status.impersonating ? 'Sem débito' : number(status.creditsPerUse)}{' '}
                          {!status.impersonating && <small>crédito{status.creditsPerUse === 1 ? '' : 's'}</small>}
                        </strong>
                        <small>Só é cobrada quando há resposta</small>
                      </div>
                    </div>

                    {quota > 0 && (
                      <section className="ai-consumption-section">
                        <div className="ai-section-heading">
                          <h3>Cota de {monthName(currentMonth)}</h3>
                          <span>
                            {number(usedThisMonth)} de {number(quota)} créditos · {quotaPercent}%
                          </span>
                        </div>
                        <div
                          className={`ai-quota ${quotaPercent >= 90 ? 'is-high' : ''}`}
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={quotaPercent}
                          aria-label="Uso da cota mensal"
                        >
                          <i style={{ width: `${quotaPercent}%` }} />
                        </div>
                        <p className="ai-muted">
                          A cota é usada primeiro. O que sobrar no fim do mês expira; créditos comprados não expiram.
                        </p>
                      </section>
                    )}

                    <section className="ai-consumption-section">
                      <div className="ai-section-heading">
                        <h3>Comprar créditos extras</h3>
                        <span>Pagamento por Pix, boleto ou cartão</span>
                      </div>
                      {credits.packages.length ? (
                        <div className="ai-packages">
                          {credits.packages.map((item) => (
                            <div key={item.id}>
                              <span>{item.name}</span>
                              <strong>
                                {number(item.credits)} <small>créditos</small>
                              </strong>
                              <small>
                                {money(item.price)} · {money(item.price / item.credits)} por crédito
                              </small>
                              <button
                                type="button"
                                className="ai-primary"
                                disabled={buying !== null || status.impersonating}
                                title={status.impersonating ? 'A compra é feita pelo administrador da empresa' : undefined}
                                onClick={() => void buy(item.id)}
                              >
                                {buying === item.id ? <Loader2 size={18} className="animate-spin" /> : <ShoppingBag size={18} />}
                                {buying === item.id ? 'Gerando cobrança…' : 'Comprar'}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="ai-muted">Nenhum pacote disponível no momento. Fale com o suporte do NextRotta.</p>
                      )}
                      {purchase && (
                        <p className="ai-notice ai-inline-notice" role="status">
                          Cobrança gerada. Os créditos entram assim que o pagamento for confirmado.{' '}
                          {purchase.invoiceUrl && (
                            <a href={purchase.invoiceUrl} target="_blank" rel="noopener noreferrer">
                              Abrir a fatura
                            </a>
                          )}
                        </p>
                      )}
                      {purchaseError && (
                        <p className="ai-error ai-inline-notice" role="alert">
                          {purchaseError}
                        </p>
                      )}
                    </section>

                    <section className="ai-consumption-section">
                      <div className="ai-section-heading">
                        <h3>Últimos 6 meses</h3>
                        <span>Créditos usados e perguntas respondidas</span>
                      </div>
                      <div className="ai-month-chart">
                        {months.map((item) => (
                          <div key={item.key} className={item.key === currentMonth ? 'is-current' : ''}>
                            <b>{number(item.credits)}</b>
                            <div>
                              <i style={{ height: `${Math.max(item.credits ? 6 : 0, (item.credits / maxMonth) * 100)}%` }} />
                            </div>
                            <span>{monthName(item.key)}</span>
                            <small>
                              {number(item.uses)} pergunta{item.uses === 1 ? '' : 's'}
                            </small>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="ai-consumption-section">
                      <div className="ai-section-heading">
                        <h3>Extrato de créditos</h3>
                        <select
                          aria-label="Filtrar movimentações"
                          value={entryKind}
                          onChange={(event) => setEntryKind(event.target.value)}
                        >
                          <option value="all">Todas as movimentações</option>
                          <option value="consumption">Consumo</option>
                          <option value="in">Créditos recebidos</option>
                          <option value="expiration">Expiração</option>
                        </select>
                      </div>
                      <div className="ai-ledger">
                        {entries.map((entry) => {
                          const Icon = ledgerIcons[entry.kind] ?? (entry.quantity > 0 ? ArrowDownLeft : Sparkles);
                          return (
                            <div key={entry.id}>
                              <span className={`ai-ledger-icon ${entry.quantity > 0 ? 'is-in' : ''}`}>
                                <Icon size={18} />
                              </span>
                              <span>
                                <strong>{entry.description || entry.kindLabel}</strong>
                                <small>
                                  {time(entry.createdAt)} · {entry.kindLabel}
                                </small>
                              </span>
                              <b className={entry.quantity > 0 ? 'ai-positive' : ''}>
                                {entry.quantity > 0 ? '+' : ''}
                                {number(entry.quantity)}
                              </b>
                            </div>
                          );
                        })}
                        {!entries.length && <p className="ai-empty">Nenhuma movimentação neste filtro.</p>}
                      </div>
                      <p className="ai-muted">Mostrando as últimas 200 movimentações.</p>
                    </section>
                  </>
                );
              })()}
              {(!credits || !status) && !creditsError && <p role="status">Carregando consumo…</p>}
            </div>
          )}
          {tab === 'settings' && (
            <div className="ai-tab-content">
              <h3>Preferências de conversa</h3>
              <p className="ai-muted">
                Estas opções ficam salvas apenas neste navegador.
              </p>
              {(
                [
                  {
                    key: 'enterToSend',
                    title: 'Enviar com Enter',
                    description:
                      'Use Shift + Enter para quebrar a linha. Desativado, envie pelo botão.',
                  },
                  {
                    key: 'showSources',
                    title: 'Mostrar dados consultados',
                    description:
                      'Veja quais áreas da empresa foram consultadas em cada resposta.',
                  },
                  {
                    key: 'largeText',
                    title: 'Texto ampliado',
                    description:
                      'Aumente o tamanho das mensagens para uma leitura mais confortável.',
                  },
                ] as const
              ).map((item) => (
                <label key={item.key} className="ai-preference">
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={prefs[item.key]}
                    onChange={(event) =>
                      preference(item.key, event.target.checked)
                    }
                  />
                </label>
              ))}
              {notice && (
                <p role="status" className="ai-notice">
                  {notice}
                </p>
              )}
              <div className="ai-settings-links">
                <Link href="/admin/assinatura">
                  <Wallet size={20} /> Gerenciar assinatura e créditos{' '}
                  <ArrowUpRight size={18} />
                </Link>
                <button onClick={() => setTab('history')}>
                  <History size={20} /> Consultar histórico de conversas{' '}
                  <ArrowUpRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
