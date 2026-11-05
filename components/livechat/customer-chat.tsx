'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Headset, Loader2, MessageCircle, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PhoneInput } from '@/components/phone-input';
import { ATTACHMENT_TYPES, attachmentProblem } from '@/lib/livechat/rules';
import { formatPhoneInput, validatePhone } from '@/lib/whatsapp/phone';

type Attachment = { id: string; name: string; type: string; size: number; image: boolean };
type Message = { id: string; mine: boolean; senderName: string | null; body: string; kind: 'text' | 'media' | 'system'; attachment: Attachment | null; createdAt: string };
type ChatState = { conversation: { id: string; status: 'open' | 'closed'; unread: number; /** Digits with 55: where the team's answers are also sent. */ whatsapp: string | null } | null; messages: Message[] };

const nationalOf = (digits: string) => formatPhoneInput(digits.startsWith('55') && digits.length > 11 ? digits.slice(2) : digits);

const clock = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const day = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'long' }).format(new Date(value));
const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** While the chat is open the window asks for news every few seconds, and only while the tab is visible. */
const POLL_OPEN_MS = 4_000;
const POLL_IDLE_MS = 20_000;

const ACCEPT = Object.keys(ATTACHMENT_TYPES).join(',');

/**
 * Live chat of a ticket opened as a live chat, for urgent matters: the customer writes here (text, an attached file or a pasted
 * screenshot) and the platform's team answers from the panel or from WhatsApp. Plain polling, no sockets. The window uses the
 * height of the screen, so it is comfortable on a large monitor and on a phone.
 */
export function LiveChatPanel({ ticketId, newChatHref, onStatusChange }: { ticketId: string; /** Where to start another live chat once this one has ended. */ newChatHref: string; /** Called when the chat opens or ends, so the page around it (the ticket status) can refresh. */ onStatusChange?: (status: 'open' | 'closed') => void }) {
  const [state, setState] = useState<ChatState | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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
  const status = state?.conversation?.status ?? null;
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (status && lastStatus.current && lastStatus.current !== status) onStatusChange?.(status);
    lastStatus.current = status;
  }, [status, onStatusChange]);
  const live = state?.conversation?.status === 'open';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, live ? POLL_OPEN_MS : POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [active, live, refresh]);

  const count = state?.messages.length ?? 0;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  // The picture shown before sending a pasted or chosen image.
  useEffect(() => {
    if (!pending || !pending.type.startsWith('image/')) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(pending);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending]);

  function pick(file: File | undefined | null) {
    if (!file) return;
    const problem = attachmentProblem({ type: file.type, size: file.size });
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setPending(file);
  }

  async function send() {
    const body = text.trim();
    if ((!body && !pending) || sending) return;
    setSending(true);
    setError('');
    try {
      let response: Response;
      if (pending) {
        const form = new FormData();
        form.append('file', pending, pending.name || 'print.png');
        form.append('text', body);
        response = await fetch(`/api/support/livechat/${ticketId}/upload`, { method: 'POST', body: form });
      } else {
        response = await fetch(`/api/support/livechat/${ticketId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body }) });
      }
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar.');
      setText('');
      setPending(null);
      if (fileRef.current) fileRef.current.value = '';
      apply(data as ChatState, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar.');
    } finally {
      setSending(false);
    }
  }

  async function savePhone(value: string) {
    setPhoneBusy(true);
    setPhoneError('');
    try {
      const response = await fetch(`/api/support/livechat/${ticketId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'phone', phone: value }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar o WhatsApp.');
      apply(data as ChatState, true);
      setEditingPhone(false);
      try {
        if (value) window.localStorage.setItem('nr-support-whatsapp', value);
      } catch {
        /* nothing to remember */
      }
    } catch (reason) {
      setPhoneError(reason instanceof Error ? reason.message : 'Não foi possível salvar o WhatsApp.');
    } finally {
      setPhoneBusy(false);
    }
  }

  async function close() {
    const response = await fetch(`/api/support/livechat/${ticketId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close' }) });
    if (response.ok) apply((await response.json()) as ChatState, true);
  }

  const closedChat = state?.conversation?.status === 'closed';
  const fileUrl = (attachment: Attachment, download = false) => `/api/support/livechat/${ticketId}/files/${attachment.id}${download ? '?download=1' : ''}`;
  let lastDay = '';
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card" aria-label="Chat ao vivo">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Headset className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight sm:text-base">Chat ao vivo</h2>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">{closedChat ? 'Este atendimento foi encerrado.' : 'Nossa equipe responde aqui, na hora que puder.'}</p>
          </div>
        </div>
        {live ? (
          <button type="button" onClick={() => void close()} className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:bg-secondary hover:underline sm:text-sm">
            Encerrar chat
          </button>
        ) : null}
      </header>

      {live && state?.conversation ? (
        <div className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5 sm:text-sm">
          {state.conversation.whatsapp && !editingPhone ? (
            <p className="leading-relaxed">
              <MessageCircle className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom text-primary" />
              As respostas também chegam no WhatsApp <strong className="text-foreground">{nationalOf(state.conversation.whatsapp)}</strong>. O que você escrever lá cai aqui.
              <button
                type="button"
                className="ml-2 underline-offset-2 hover:underline"
                onClick={() => {
                  setPhoneValue(nationalOf(state.conversation!.whatsapp!));
                  setEditingPhone(true);
                }}
              >
                Alterar
              </button>
              <button type="button" className="ml-2 underline-offset-2 hover:underline" disabled={phoneBusy} onClick={() => void savePhone('')}>
                Remover
              </button>
            </p>
          ) : editingPhone ? (
            <form
              className="max-w-sm space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void savePhone(phoneValue);
              }}
            >
              <p className="font-medium text-foreground">Seu WhatsApp, para a equipe também responder por lá</p>
              <PhoneInput value={phoneValue} onChange={setPhoneValue} hint={null} />
              {phoneError ? <p className="text-destructive">{phoneError}</p> : null}
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={phoneBusy || validatePhone(phoneValue).status !== 'valid'}>
                  {phoneBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Salvar
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditingPhone(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
              onClick={() => {
                setPhoneValue(typeof window !== 'undefined' ? (() => { try { return window.localStorage.getItem('nr-support-whatsapp') ?? ''; } catch { return ''; } })() : '');
                setEditingPhone(true);
              }}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Receber as respostas também no WhatsApp
            </button>
          )}
        </div>
      ) : null}

      <div ref={listRef} className="h-[clamp(18rem,calc(100dvh-33rem),44rem)] overflow-y-auto px-3 py-4 sm:px-5" role="log" aria-live="polite">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {!count ? <p className="py-10 text-center text-sm text-muted-foreground">Escreva sua mensagem abaixo para chamar a equipe.</p> : null}
          {state?.messages.map((message) => {
            const header = day(message.createdAt);
            const showDay = header !== lastDay;
            lastDay = header;
            return (
              <div key={message.id}>
                {showDay ? <p className="my-3 text-center text-[11px] uppercase tracking-wide text-muted-foreground">{header}</p> : null}
                {message.kind === 'system' ? (
                  <p className="text-center text-xs text-muted-foreground sm:text-sm">{message.body}</p>
                ) : (
                  <div className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed sm:max-w-[75%] ${message.mine ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm bg-secondary'}`}>
                      {!message.mine ? <p className="mb-0.5 text-xs font-semibold text-primary">{message.senderName ?? 'Suporte NextRotta'}</p> : null}
                      {message.attachment ? (
                        message.attachment.image ? (
                          <a href={fileUrl(message.attachment)} target="_blank" rel="noreferrer" className="mb-1 block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(message.attachment)} alt={message.attachment.name} loading="lazy" className="max-h-72 w-full rounded-lg object-cover" />
                          </a>
                        ) : (
                          <a
                            href={fileUrl(message.attachment, true)}
                            className={`mb-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${message.mine ? 'border-primary-foreground/30 hover:bg-primary-foreground/10' : 'border-border hover:bg-background'}`}
                          >
                            <FileText className="h-5 w-5 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{message.attachment.name}</span>
                              <span className="block text-xs opacity-75">{sizeLabel(message.attachment.size)} · baixar</span>
                            </span>
                          </a>
                        )
                      ) : null}
                      {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                      <p className={`mt-1 text-right text-[11px] ${message.mine ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{clock(message.createdAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {closedChat ? (
        <div className="space-y-3 border-t border-border p-4 text-sm sm:px-5">
          <p className="text-muted-foreground">Este chat foi encerrado. Se precisar de mais ajuda, inicie um novo chat ao vivo ou abra um chamado por escrito.</p>
          <Button asChild>
            <a href={newChatHref}>
              <Headset className="h-4 w-4" />
              Iniciar novo chat ao vivo
            </a>
          </Button>
        </div>
      ) : (
        <form
          className="border-t border-border p-3 sm:px-5"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="mx-auto w-full max-w-3xl">
            {error ? (
              <p className="mb-2 text-xs text-destructive sm:text-sm" role="alert">
                {error}
              </p>
            ) : null}
            {pending ? (
              <div className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-secondary/50 p-2">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt="" className="h-14 w-14 rounded-md object-cover" />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-md bg-background">
                    <FileText className="h-6 w-6 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{pending.name || 'print.png'}</span>
                  <span className="block text-xs text-muted-foreground">{sizeLabel(pending.size)} · será enviado com a mensagem</span>
                </span>
                <button
                  type="button"
                  aria-label="Remover o anexo"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-background"
                  onClick={() => {
                    setPending(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Escolher arquivo" onChange={(event) => pick(event.target.files?.[0])} />
              <Button type="button" variant="outline" size="icon" aria-label="Anexar arquivo" title="Anexar arquivo ou imagem" disabled={sending} onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4" />
              </Button>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                onPaste={(event) => {
                  // A screenshot pasted (Ctrl+V) becomes the attachment.
                  const file = Array.from(event.clipboardData.files)[0];
                  if (file) {
                    event.preventDefault();
                    pick(file);
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="Escreva sua mensagem ou cole um print"
                aria-label="Mensagem"
                className="min-h-11 flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" disabled={(!text.trim() && !pending) || sending} aria-label="Enviar mensagem">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
