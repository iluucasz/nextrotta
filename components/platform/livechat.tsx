'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, CheckCheck, Headset, LoaderCircle, MessageCircle, QrCode, Search, Send, Ticket, Unplug } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { api, errorMessage } from './api';
import { useNotify } from './notice';
import './livechat.css';

type Conversation = {
  id: string;
  channel: 'web' | 'whatsapp';
  organizationId: string | null;
  organizationName: string | null;
  ticketId: string | null;
  ticketNumber: number | null;
  ticketTitle: string | null;
  userName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: 'open' | 'closed';
  urgent: boolean;
  unreadOwner: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
};
type Message = { id: string; direction: 'in' | 'out'; senderName: string | null; body: string; kind: 'text' | 'media' | 'system'; createdAt: string };
type WhatsAppStatus = { serverConfigured: boolean; instanceName: string; created: boolean; state: 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown'; number: string | null; webhookUrl: string | null; error: string | null };

const TZ = 'America/Sao_Paulo';
const clock = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const dayLabel = (value: string) => {
  const date = new Date(value);
  const key = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
  const now = new Date();
  if (key(date) === key(now)) return 'Hoje';
  if (key(date) === key(new Date(now.getTime() - 86_400_000))) return 'Ontem';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'long', year: 'numeric' }).format(date);
};
const listTime = (value: string) => {
  const label = dayLabel(value);
  return label === 'Hoje' ? clock(value) : label === 'Ontem' ? 'Ontem' : new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(value));
};
const phoneLabel = (digits: string | null) => {
  if (!digits) return '';
  const national = digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits;
  return national.length === 11 ? `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}` : national.length === 10 ? `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}` : `+${digits}`;
};
const titleOf = (c: Conversation) => (c.channel === 'web' ? c.organizationName ?? 'Cliente' : c.contactName || phoneLabel(c.contactPhone) || 'Contato');
const subtitleOf = (c: Conversation) =>
  c.channel === 'web'
    ? [c.userName, c.ticketNumber ? `Chamado #${c.ticketNumber}` : null].filter(Boolean).join(' · ')
    : [c.contactName ? phoneLabel(c.contactPhone) : null, c.organizationName].filter(Boolean).join(' · ');
const initials = (text: string) => text.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';

const LIST_POLL_MS = 6_000;
const THREAD_POLL_MS = 3_000;

/** The platform's live chat inbox: the web chats opened from tickets and the conversations of the official WhatsApp number. */
export function Livechat({ initialId = null }: { initialId?: string | null }) {
  const notify = useNotify();
  // Coming from a ticket, the conversation may be closed: start on "Todas" so it is in the list.
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>(initialId ? 'all' : 'open');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<Conversation[] | null>(null);
  const [unread, setUnread] = useState({ conversations: 0, messages: 0 });
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<string | null>(initialId);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState(0);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const loadList = useCallback(async () => {
    try {
      const data = await api<{ conversations: Conversation[]; unread: { conversations: number; messages: number } }>(`/livechat?status=${filter}&q=${encodeURIComponent(search.trim())}`);
      setList(data.conversations);
      setUnread(data.unread);
      setListError('');
    } catch (reason) {
      setListError(errorMessage(reason));
    }
  }, [filter, search]);

  useEffect(() => {
    void loadList();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadList();
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [loadList]);

  const loadStatus = useCallback(async () => {
    try {
      setWhatsapp(await api<WhatsAppStatus>('/livechat/whatsapp'));
    } catch {
      /* the chip keeps its last state */
    }
  }, []);
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // While the QR code is on screen: check every 4 s whether it was read, and ask for a new code every 18 s
  // (WhatsApp renews it about every 20 s; an old one is refused by the phone as "could not connect the device").
  const open = Boolean(qr);
  useEffect(() => {
    if (!open) return;
    let ticks = 0;
    const timer = setInterval(async () => {
      ticks += 1;
      try {
        if (ticks % 4 === 0) {
          const fresh = await api<{ status: WhatsAppStatus; qr: { base64: string | null; pairingCode: string | null } | null }>('/livechat/whatsapp', { method: 'PUT' });
          setWhatsapp(fresh.status);
          if (fresh.qr?.base64) {
            setQr(fresh.qr.base64);
            setPairing(fresh.qr.pairingCode);
            setQrAt(Date.now());
          }
          if (fresh.status.state === 'connected') {
            setQr(null);
            notify('WhatsApp conectado. As mensagens do número oficial chegam aqui.');
          }
          return;
        }
        const status = await api<WhatsAppStatus>('/livechat/whatsapp');
        setWhatsapp(status);
        if (status.state === 'connected') {
          setQr(null);
          notify('WhatsApp conectado. As mensagens do número oficial chegam aqui.');
        }
      } catch {
        /* try again on the next tick */
      }
    }, 4_500);
    return () => clearInterval(timer);
  }, [open, notify]);

  async function connect() {
    setConnecting(true);
    try {
      const result = await api<{ status: WhatsAppStatus; qr: { base64: string | null; pairingCode: string | null } | null }>('/livechat/whatsapp', { method: 'POST' });
      setWhatsapp(result.status);
      if (result.status.state === 'connected' || !result.qr?.base64) notify(result.status.state === 'connected' ? 'O WhatsApp já está conectado.' : 'O servidor não devolveu o QR Code. Tente de novo.');
      else {
        setQr(result.qr.base64);
        setPairing(result.qr.pairingCode);
        setQrAt(Date.now());
      }
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setConnecting(false);
    }
  }

  // The tab title shows what is waiting, so a message is noticed from another window.
  useEffect(() => {
    const original = document.title.replace(/^\(\d+\)\s/, '');
    document.title = unread.messages ? `(${unread.messages}) ${original}` : original;
    return () => {
      document.title = original;
    };
  }, [unread.messages]);

  const current = list?.find((conversation) => conversation.id === selected) ?? null;
  const connected = whatsapp?.state === 'connected';

  return (
    <div className="lc-root">
      <div className="lc-status" role="status">
        <span className={`lc-dot ${connected ? 'on' : !whatsapp || whatsapp.state === 'connecting' ? 'wait' : 'off'}`} />
        <span>
          {!whatsapp
            ? 'Verificando o WhatsApp…'
            : connected
              ? `WhatsApp oficial conectado${whatsapp.number ? ` · ${phoneLabel(whatsapp.number)}` : ''}`
              : !whatsapp.serverConfigured
                ? 'Servidor do WhatsApp não configurado'
                : whatsapp.error
                  ? /401/.test(whatsapp.error)
                    ? 'O servidor do WhatsApp recusou a chave de acesso'
                    : 'Sem conexão com o servidor do WhatsApp'
                  : 'WhatsApp oficial desconectado: só o chat dos chamados chega aqui'}
        </span>
        {whatsapp?.error ? (
          <small title={whatsapp.error}>{/401/.test(whatsapp.error) ? 'A chave EVOLUTION_API_KEY deste ambiente não é a do servidor. Atualize a chave no ambiente (Vercel e .env) e recarregue.' : whatsapp.error.length > 90 ? `${whatsapp.error.slice(0, 90)}…` : whatsapp.error}</small>
        ) : null}
        {whatsapp && !whatsapp.webhookUrl && whatsapp.serverConfigured && !whatsapp.error ? <small>Sem endereço público: o recebimento de mensagens só funciona no site publicado.</small> : null}
        <span className="lc-status-actions">
          {connected ? (
            <button className="nr-btn" onClick={() => setConfirmDisconnect(true)}>
              <Unplug size={16} />
              Desconectar
            </button>
          ) : (
            <button className="nr-btn primary" disabled={connecting || !whatsapp?.serverConfigured} onClick={() => void connect()}>
              {connecting ? <LoaderCircle size={16} className="animate-spin" /> : <QrCode size={16} />}
              Conectar WhatsApp
            </button>
          )}
        </span>
      </div>

      <div className={`lc-shell ${current ? 'has-thread' : ''}`}>
        <aside className="lc-list" aria-label="Conversas">
          <div className="lc-list-head">
            <label className="lc-search">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, empresa ou número" aria-label="Buscar conversas" />
            </label>
            <div className="lc-filters" role="tablist" aria-label="Situação">
              {(['open', 'closed', 'all'] as const).map((value) => (
                <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>
                  {value === 'open' ? 'Abertas' : value === 'closed' ? 'Encerradas' : 'Todas'}
                  {value === 'open' && unread.conversations ? <b>{unread.conversations}</b> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="lc-list-body">
            {listError ? <p className="lc-empty" role="alert">{listError}</p> : null}
            {!list && !listError ? <p className="lc-empty"><LoaderCircle size={18} className="animate-spin" /></p> : null}
            {list && !list.length && !listError ? (
              <p className="lc-empty">
                <MessageCircle size={28} />
                {search ? 'Nenhuma conversa encontrada.' : filter === 'open' ? 'Nenhuma conversa aberta. Quando um cliente chamar no chat ou escrever para o WhatsApp oficial, aparece aqui.' : 'Nenhuma conversa.'}
              </p>
            ) : null}
            {list?.map((conversation) => (
              <button key={conversation.id} className={`lc-item ${selected === conversation.id ? 'active' : ''}`} onClick={() => setSelected(conversation.id)}>
                <span className={`lc-avatar ${conversation.channel}`}>{initials(titleOf(conversation))}</span>
                <span className="lc-item-main">
                  <span className="lc-item-top">
                    <strong>{titleOf(conversation)}</strong>
                    <time>{listTime(conversation.lastMessageAt)}</time>
                  </span>
                  <span className="lc-item-bottom">
                    <span className="lc-preview">
                      {conversation.urgent && conversation.status === 'open' ? <em className="lc-urgent">Urgente</em> : null}
                      {conversation.status === 'closed' ? <em className="lc-closed">Encerrada</em> : null}
                      {conversation.lastMessagePreview ?? subtitleOf(conversation)}
                    </span>
                    {conversation.unreadOwner ? <b className="lc-unread">{conversation.unreadOwner}</b> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="lc-thread" aria-label="Conversa">
          {current ? <Thread key={current.id} conversation={current} onBack={() => setSelected(null)} onChanged={() => void loadList()} /> : (
            <div className="lc-placeholder">
              <Headset size={46} />
              <h3>Livechat NextRotta</h3>
              <p>Escolha uma conversa para ler e responder, sem abrir o WhatsApp Web.</p>
            </div>
          )}
        </section>
      </div>

      {qr ? (
        <Dialog open onOpenChange={(open) => !open && setQr(null)}>
          <DialogContent className="nr-dialog sm:max-w-lg">
            <DialogTitle>Conectar o WhatsApp oficial</DialogTitle>
            <DialogDescription>No celular do número oficial: WhatsApp → Dispositivos conectados → Conectar dispositivo, e aponte para o código. O código se renova sozinho a cada poucos segundos e esta janela fecha quando conectar.</DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={qrAt} src={qr} alt="QR Code para conectar o WhatsApp oficial" className="mx-auto h-64 w-64 rounded-lg border bg-white p-2" />
            {pairing ? (
              <div className="lc-pairing">
                <small>Se o celular recusar o QR Code, use o código: no WhatsApp, Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone.</small>
                <strong>{pairing.length === 8 ? `${pairing.slice(0, 4)}-${pairing.slice(4)}` : pairing}</strong>
              </div>
            ) : null}
            <div className="nr-dialog-actions">
              <button className="nr-btn" onClick={() => setQr(null)}>Fechar</button>
              <button className="nr-btn primary" disabled={connecting} onClick={() => void connect()}>Gerar novo código</button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {confirmDisconnect ? (
        <Dialog open onOpenChange={(open) => !open && setConfirmDisconnect(false)}>
          <DialogContent className="nr-dialog sm:max-w-lg">
            <DialogTitle>Desconectar o WhatsApp oficial</DialogTitle>
            <DialogDescription>O número é desconectado do Livechat. As conversas continuam aqui, mas nada chega nem sai pelo WhatsApp até ler o QR Code de novo.</DialogDescription>
            <div className="nr-dialog-actions">
              <button className="nr-btn" onClick={() => setConfirmDisconnect(false)}>Voltar</button>
              <button
                className="nr-btn danger"
                onClick={async () => {
                  try {
                    setWhatsapp(await api<WhatsAppStatus>('/livechat/whatsapp', { method: 'DELETE' }));
                    notify('Número desconectado.');
                  } catch (reason) {
                    notify(errorMessage(reason));
                  }
                  setConfirmDisconnect(false);
                }}
              >
                Desconectar
              </button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function Thread({ conversation, onBack, onChanged }: { conversation: Conversation; onBack: () => void; onChanged: () => void }) {
  const notify = useNotify();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | null>(null);

  const merge = useCallback((incoming: Message[], replace = false) => {
    setMessages((previous) => {
      const base = replace || !previous ? [] : previous;
      const known = new Set(base.map((message) => message.id));
      const merged = [...base, ...incoming.filter((message) => !known.has(message.id))];
      lastAt.current = merged.length ? merged[merged.length - 1].createdAt : null;
      return merged;
    });
  }, []);

  const refresh = useCallback(
    async (full: boolean) => {
      try {
        const data = await api<{ messages: Message[] }>(`/livechat/${conversation.id}?read=1${!full && lastAt.current ? `&after=${encodeURIComponent(lastAt.current)}` : ''}`);
        merge(data.messages, full);
      } catch {
        /* the next poll tries again */
      }
    },
    [conversation.id, merge],
  );

  useEffect(() => {
    void refresh(true).then(onChanged);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(false);
    }, THREAD_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const count = messages?.length ?? 0;
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [count]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const data = await api<{ messages: Message[] }>(`/livechat/${conversation.id}`, { method: 'POST', body: { text: body } });
      setText('');
      merge(data.messages, true);
      onChanged();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: 'open' | 'closed') {
    try {
      await api(`/livechat/${conversation.id}`, { method: 'PATCH', body: { status } });
      notify(status === 'closed' ? 'Conversa encerrada.' : 'Conversa reaberta.');
      await refresh(true);
      onChanged();
    } catch (reason) {
      notify(errorMessage(reason));
    }
  }

  let lastDay = '';
  const title = titleOf(conversation);
  return (
    <>
      <header className="lc-thread-head">
        <button className="lc-back" onClick={onBack} aria-label="Voltar para as conversas">
          <ArrowLeft size={20} />
        </button>
        <span className={`lc-avatar ${conversation.channel}`}>{initials(title)}</span>
        <div className="lc-thread-title">
          <strong>{title}</strong>
          <small>
            {conversation.channel === 'whatsapp' ? 'WhatsApp' : 'Chat do chamado'}
            {subtitleOf(conversation) ? ` · ${subtitleOf(conversation)}` : ''}
          </small>
        </div>
        <div className="lc-thread-actions">
          {conversation.organizationId ? (
            <Link className="nr-btn" href={`/plataforma/organizacoes/${conversation.organizationId}`}>
              <Building2 size={16} />
              <span className="lc-btn-text">Empresa</span>
            </Link>
          ) : null}
          {conversation.ticketId ? (
            <Link className="nr-btn" href={`/plataforma/reports/${conversation.ticketId}`}>
              <Ticket size={16} />
              <span className="lc-btn-text">Chamado</span>
            </Link>
          ) : null}
          {conversation.status === 'open' ? (
            <button className="nr-btn" onClick={() => void setStatus('closed')}>
              <CheckCheck size={16} />
              <span className="lc-btn-text">Encerrar</span>
            </button>
          ) : (
            <button className="nr-btn" onClick={() => void setStatus('open')}>Reabrir</button>
          )}
        </div>
      </header>

      <div className="lc-messages" ref={bodyRef} role="log" aria-live="polite">
        {!messages ? <p className="lc-empty"><LoaderCircle size={18} className="animate-spin" /></p> : null}
        {messages?.map((message) => {
          const label = dayLabel(message.createdAt);
          const showDay = label !== lastDay;
          lastDay = label;
          return (
            <div key={message.id}>
              {showDay ? <p className="lc-day"><span>{label}</span></p> : null}
              {message.kind === 'system' ? (
                <p className="lc-system"><span>{message.body}</span></p>
              ) : (
                <div className={`lc-row ${message.direction}`}>
                  <div className={`lc-bubble ${message.direction} ${message.kind === 'media' ? 'media' : ''}`}>
                    {message.direction === 'in' && conversation.channel === 'web' && message.senderName ? <span className="lc-sender">{message.senderName}</span> : null}
                    <span className="lc-text">{message.body}</span>
                    <time>{clock(message.createdAt)}</time>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {messages && conversation.channel === 'whatsapp' && messages.some((message) => message.kind === 'media') ? <p className="lc-hint">Fotos, áudios e documentos aparecem só como aviso aqui. Abra o WhatsApp do número oficial para vê-los.</p> : null}
      </div>

      <form
        className="lc-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {error ? <p className="lc-error" role="alert">{error}</p> : null}
        <div className="lc-composer-row">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={2000}
            aria-label="Mensagem"
            placeholder={conversation.status === 'closed' ? 'Escrever reabre a conversa' : conversation.channel === 'whatsapp' ? 'Responder pelo WhatsApp oficial' : 'Responder no chat do chamado'}
          />
          <button className="lc-send" disabled={!text.trim() || sending} aria-label="Enviar mensagem">
            {sending ? <LoaderCircle size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      </form>
    </>
  );
}
