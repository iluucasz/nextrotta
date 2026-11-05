'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Headset, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Message = { id: string; mine: boolean; senderName: string | null; body: string; kind: 'text' | 'media' | 'system'; createdAt: string };
type ChatState = { conversation: { id: string; status: 'open' | 'closed'; unread: number } | null; messages: Message[] };

const clock = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long' }).format(new Date(value));

/** While the chat is open the window asks for news every few seconds, and only while the tab is visible. */
const POLL_OPEN_MS = 4_000;
const POLL_IDLE_MS = 20_000;

/**
 * Live chat inside a support ticket, for urgent matters: the customer writes here and the platform's team answers from the panel
 * (or from WhatsApp). The chat starts with the first message; closing it keeps the ticket. Plain polling, no sockets.
 */
export function LiveChatPanel({ ticketId, ticketClosed, startOpen = false }: { ticketId: string; ticketClosed: boolean; startOpen?: boolean }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | null>(null);

  const apply = useCallback((next: ChatState, replace: boolean) => {
    setState((previous) => {
      const base = replace || !previous ? [] : previous.messages;
      const known = new Set(base.map((message) => message.id));
      const merged = [...base, ...next.messages.filter((message) => !known.has(message.id))];
      lastAt.current = merged.length ? merged[merged.length - 1].createdAt : null;
      return { conversation: next.conversation, messages: merged };
    });
  }, []);

  const refresh = useCallback(
    async (full = false) => {
      try {
        const response = await fetch(`/api/support/livechat/${ticketId}${!full && lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : ''}`, { cache: 'no-store' });
        if (!response.ok) return;
        apply((await response.json()) as ChatState, full);
      } catch {
        /* the next poll tries again */
      }
    },
    [ticketId, apply],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  const active = Boolean(state?.conversation);
  const live = state?.conversation?.status === 'open';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, live ? POLL_OPEN_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [active, live, refresh]);

  // A conversation that already exists (or an answer that just arrived) opens the window by itself.
  useEffect(() => {
    if (state?.conversation && (state.conversation.status === 'open' || state.conversation.unread > 0)) setOpen(true);
  }, [state?.conversation]);

  const count = state?.messages.length ?? 0;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count, open]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch(`/api/support/livechat/${ticketId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar.');
      setText('');
      apply(data as ChatState, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  async function close() {
    const response = await fetch(`/api/support/livechat/${ticketId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }) });
    if (response.ok) apply((await response.json()) as ChatState, true);
  }

  if (ticketClosed && !state?.conversation) return null;

  const closedChat = state?.conversation?.status === 'closed';
  let lastDay = '';
  return (
    <section className="rounded-xl border border-border bg-card" aria-label="Chat ao vivo">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Headset className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-tight">Chat ao vivo</h2>
            <p className="text-xs text-muted-foreground">{live ? 'Nossa equipe responde aqui, na hora que puder.' : 'Para urgências: fale agora com a nossa equipe.'}</p>
          </div>
        </div>
        {live ? (
          <button type="button" onClick={() => void close()} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Encerrar chat
          </button>
        ) : null}
      </header>

      {!open && !active ? (
        <div className="px-4 py-4">
          <Button type="button" onClick={() => setOpen(true)}>
            <Headset className="h-4 w-4" />
            Iniciar chat ao vivo
          </Button>
        </div>
      ) : (
        <>
          <div ref={listRef} className="max-h-[22rem] min-h-40 space-y-2 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
            {!count ? <p className="py-6 text-center text-sm text-muted-foreground">Escreva sua mensagem abaixo para chamar a equipe.</p> : null}
            {state?.messages.map((message) => {
              const header = day(message.createdAt);
              const showDay = header !== lastDay;
              lastDay = header;
              return (
                <div key={message.id}>
                  {showDay ? <p className="my-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">{header}</p> : null}
                  {message.kind === 'system' ? (
                    <p className="text-center text-xs text-muted-foreground">{message.body}</p>
                  ) : (
                    <div className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${message.mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-secondary'}`}>
                        {!message.mine ? <p className="mb-0.5 text-[11px] font-semibold text-primary">{message.senderName ?? 'Suporte NextRotta'}</p> : null}
                        <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        <p className={`mt-1 text-right text-[10px] ${message.mine ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{clock(message.createdAt)}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            {closedChat ? <p className="mb-2 text-xs text-muted-foreground">Este chat foi encerrado. Se escrever de novo, ele é reaberto.</p> : null}
            {error ? (
              <p className="mb-2 text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="Escreva sua mensagem"
                aria-label="Mensagem"
                className="min-h-10 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" disabled={!text.trim() || sending} aria-label="Enviar mensagem">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
