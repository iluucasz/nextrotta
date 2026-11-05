'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Download, ExternalLink, FileSpreadsheet, FileText, ImageIcon, LifeBuoy, Loader2, LockKeyhole, LogOut, MessageCircle, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';
import { dataDeletionDate, LOCKED_DATA_RETENTION_MONTHS } from '@/lib/data-retention';

type Access = {
  name: string;
  status: string;
  since: string | null;
  readOnlyUntil: string | null;
  level: string;
  reason: string | null;
  support: { whatsapp: string | null; email: string | null };
  isAdmin: boolean;
  payment: { value: number; dueDate: string; invoiceUrl: string | null; description: string | null } | null;
  lastBackup: { id: string; kind: string; createdAt: string } | null;
};

const timeZone = 'America/Sao_Paulo';
const longDate = (value: string | null) => (value ? new Intl.DateTimeFormat('pt-BR', { timeZone, dateStyle: 'long' }).format(new Date(value)) : '—');
const shortDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const COLORS = { page: '#f6f8f6', ink: '#13261e', soft: '#425a50', line: '#dfe9e2', green: '#1f9d74', greenBg: '#f1f8f3', greenInk: '#2f5a46', warnBg: '#fff7e6', warnInk: '#8a5a00' };

/**
 * Where a suspended or canceled company lands: the system is locked, nothing was deleted. It can pay and come back (this
 * page notices the payment by itself), open a ticket with the administration and download the latest backup as a
 * spreadsheet. Everything else in the system is closed.
 */
export default function ClosedAccessPage() {
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [contactUrl, setContactUrl] = useState('/login');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/organization/access', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar.');
      setAccess(data);
      // Paid (or released by the team): the system is open again.
      if (data.level === 'full') window.location.assign('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.');
    }
  }, []);

  useEffect(() => {
    // The marketing site lives on the root domain (this page is on the organization's subdomain).
    setContactUrl(`${window.location.protocol}//${window.location.host.split('.').slice(1).join('.')}/contato`);
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  async function logout() {
    setLeaving(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.assign('/login');
  }

  // "Já paguei": asks the payment gateway now; once nothing is overdue the access is released and the page opens the system.
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<{ tone: 'ok' | 'wait' | 'error'; text: string } | null>(null);
  const verifyPayment = useCallback(
    async (manual: boolean) => {
      if (manual) {
        setChecking(true);
        setCheckMessage(null);
      }
      try {
        const response = await fetch('/api/organization/billing/verify', { method: 'POST' });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível verificar agora.');
        if (data.released) {
          setCheckMessage({ tone: 'ok', text: 'Pagamento confirmado! Abrindo o sistema…' });
          await load();
        } else if (manual) {
          setCheckMessage({ tone: 'wait', text: 'Ainda não identificamos o pagamento. Pix e cartão costumam confirmar em poucos minutos; boleto pode levar até 2 dias úteis. Se já pagou, tente de novo daqui a pouco.' });
        }
      } catch (reason) {
        if (manual) setCheckMessage({ tone: 'error', text: reason instanceof Error ? reason.message : 'Não foi possível verificar agora.' });
      } finally {
        if (manual) setChecking(false);
      }
    },
    [load],
  );
  const awaitingPayment = Boolean(access?.payment && access.isAdmin);
  useEffect(() => {
    if (!awaitingPayment) return;
    // Once on arrival (paid in another tab?) and then every minute while the page stays open.
    void verifyPayment(false);
    const timer = setInterval(() => void verifyPayment(false), 60_000);
    return () => clearInterval(timer);
  }, [awaitingPayment, verifyPayment]);

  const canceled = access?.status === 'canceled';
  const deletionDate = access?.since ? dataDeletionDate(access.since) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10" style={{ background: COLORS.page, color: COLORS.ink, minHeight: '100dvh' }}>
      <div className="w-full max-w-2xl rounded-2xl border bg-white p-6 sm:p-8" style={{ borderColor: COLORS.line, boxShadow: '0 14px 40px #12302410' }}>
        <BrandLogo className="h-12 w-auto" />
        <h1 className="mt-8 flex items-center gap-3 text-2xl font-semibold">
          <LockKeyhole className="h-6 w-6" style={{ color: COLORS.warnInk }} />
          {canceled ? 'Acesso encerrado' : 'Acesso bloqueado'}
        </h1>

        {error ? (
          <p className="mt-3 text-sm text-rose-700">{error}</p>
        ) : !access ? (
          <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <p className="mt-3 leading-relaxed" style={{ fontSize: 15, color: COLORS.soft }}>
              O acesso de <strong>{access.name}</strong> ao NextRotta foi {canceled ? 'encerrado' : 'bloqueado'} em {longDate(access.since)}
              {access.payment ? ' por falta de pagamento' : ''}. {access.reason && !access.payment ? `Motivo: ${access.reason}. ` : ''}
              Enquanto isso, ninguém consegue usar o sistema.
            </p>
            <div className="mt-4 flex items-start gap-3 rounded-xl p-4 text-sm" style={{ background: COLORS.greenBg, color: COLORS.greenInk }}>
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <span>Seus dados estão guardados e voltam assim que o acesso for liberado.</span>
            </div>
            {deletionDate ? (
              <div className="mt-3 flex items-start gap-3 rounded-xl p-4 text-sm leading-relaxed" style={{ background: COLORS.warnBg, color: COLORS.warnInk }}>
                <Scale className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <strong className="block">Prazo para não perder os dados</strong>
                  Conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), não guardamos dados de empresas sem contrato ativo.{' '}
                  {access.payment ? (
                    <>
                      Pagando a cobrança em aberto, o acesso volta na hora e nada se perde. Se até <strong>{longDate(deletionDate.toISOString())}</strong> ({LOCKED_DATA_RETENTION_MONTHS} meses após o
                      bloqueio) o pagamento não for feito, todos os dados da empresa e os backups serão <strong>excluídos de forma permanente e irreversível</strong>.
                    </>
                  ) : (
                    <>
                      Se até <strong>{longDate(deletionDate.toISOString())}</strong> ({LOCKED_DATA_RETENTION_MONTHS} meses após o bloqueio) o acesso não for reativado, todos os dados da empresa e os backups serão{' '}
                      <strong>excluídos de forma permanente e irreversível</strong>.
                    </>
                  )}{' '}
                  Depois disso não é possível reativar esta conta: será preciso criar uma conta completamente nova. Baixe seus dados abaixo enquanto há tempo.
                </div>
              </div>
            ) : null}

            <div className="mt-6 space-y-4">
              {access.payment ? (
                <Section icon={CreditCard} title="Voltar a usar agora" tone="primary">
                  <p>
                    {access.payment.description ? `${access.payment.description}: ` : 'Cobrança em aberto: '}
                    <strong>{money(access.payment.value)}</strong>, vencida em {shortDate(access.payment.dueDate)}.
                  </p>
                  <p className="mt-1" style={{ color: COLORS.soft }}>Pagou? O acesso volta na hora: clique em “Verificar pagamento” e o sistema abre sozinho.</p>
                  {access.isAdmin ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {access.payment.invoiceUrl ? (
                        <Button asChild size="lg" className="w-full text-white hover:opacity-90 sm:w-auto" style={{ background: COLORS.green }}>
                          <a href={access.payment.invoiceUrl} target="_blank" rel="noreferrer">
                            <CreditCard className="h-5 w-5" />
                            Pagar agora
                          </a>
                        </Button>
                      ) : null}
                      <Button type="button" size="lg" variant="outline" className="w-full sm:w-auto" onClick={() => void verifyPayment(true)} disabled={checking}>
                        {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
                        {checking ? 'Verificando…' : 'Verificar pagamento'}
                      </Button>
                    </div>
                  ) : null}
                  {checkMessage ? (
                    <p
                      role="status"
                      className="mt-3 rounded-lg p-3"
                      style={checkMessage.tone === 'ok' ? { background: COLORS.greenBg, color: COLORS.greenInk } : checkMessage.tone === 'error' ? { background: '#fef2f2', color: '#b91c1c' } : { background: COLORS.warnBg, color: COLORS.warnInk }}
                    >
                      {checkMessage.text}
                    </p>
                  ) : null}
                  {!access.isAdmin ? <p className="mt-2 text-sm" style={{ color: COLORS.soft }}>Peça ao administrador da sua empresa para pagar.</p> : null}
                </Section>
              ) : null}

              {access.isAdmin ? (
                <Section icon={LifeBuoy} title={access.payment ? 'Precisa de ajuda ou combinar o pagamento?' : 'Para voltar a usar o sistema'}>
                  <p style={{ color: COLORS.soft }}>Abra um chamado e a administração do NextRotta responde por aqui, no seu e-mail e no painel quando o acesso voltar.</p>
                  <TicketForm
                    company={access.name}
                    extra={
                      <a
                        href={access.support.whatsapp ? `https://wa.me/${access.support.whatsapp}?text=${encodeURIComponent(`Olá! Sou da ${access.name} e quero voltar a usar o NextRotta.`)}` : contactUrl}
                        target={access.support.whatsapp ? '_blank' : undefined}
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-[#f1f8f3]"
                        style={{ color: COLORS.green, borderColor: '#b9e3cc' }}
                      >
                        <MessageCircle className="h-4 w-4" />
                        Falar no WhatsApp
                      </a>
                    }
                  />
                </Section>
              ) : (
                <Section icon={LifeBuoy} title="Para voltar a usar o sistema">
                  <p style={{ color: COLORS.soft }}>Fale com o administrador da sua empresa.</p>
                </Section>
              )}

              {access.isAdmin ? (
                <Section icon={FileSpreadsheet} title="Seus dados">
                  {access.lastBackup ? (
                    <>
                      <p>
                        Último backup: <strong>{dateTime(access.lastBackup.createdAt)}</strong>
                        {access.lastBackup.kind === 'closing' ? ' (feito antes de bloquear, com os dados mais recentes)' : ''}.
                      </p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button asChild size="lg" className="w-full text-white hover:opacity-90 sm:w-auto" style={{ background: COLORS.green }}>
                          <a href="/api/organization/backups/ultimo/planilha">
                            <FileSpreadsheet className="h-5 w-5" />
                            Baixar planilha (Excel)
                          </a>
                        </Button>
                        <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                          <a href={`/api/organization/backups/${access.lastBackup.id}`}>
                            <Download className="h-5 w-5" />
                            Arquivo completo (.json.gz)
                          </a>
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p style={{ color: COLORS.soft }}>Não há um backup guardado. Podemos gerar agora a planilha com os dados como estão.</p>
                      <Button asChild size="lg" className="mt-3 w-full text-white hover:opacity-90 sm:w-auto" style={{ background: COLORS.green }}>
                        <a href="/api/organization/backups/atual/planilha">
                          <FileSpreadsheet className="h-5 w-5" />
                          Gerar e baixar a planilha
                        </a>
                      </Button>
                    </>
                  )}
                  <p className="mt-2 text-xs" style={{ color: COLORS.soft }}>
                    A planilha tem uma aba para cada assunto: técnicos, ordens de serviço, horas, escala, folhas, financeiro, peças e mais. Senhas não entram.
                  </p>
                </Section>
              ) : null}

              {access.isAdmin ? <FilesSection /> : null}
            </div>
          </>
        )}

        <div className="mt-8 flex items-center justify-end border-t pt-5 text-sm" style={{ borderColor: '#e7ede8' }}>
          <button type="button" onClick={() => void logout()} disabled={leaving} className="inline-flex items-center gap-2 hover:opacity-80" style={{ color: '#5c7268' }}>
            <LogOut className="h-4 w-4" />
            {leaving ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      </div>
    </main>
  );
}

function Section({ icon: Icon, title, tone, children }: { icon: typeof CreditCard; title: string; tone?: 'primary'; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4 text-sm leading-relaxed" style={{ borderColor: tone === 'primary' ? '#b9e3cc' : COLORS.line, background: tone === 'primary' ? '#f7fcf9' : '#fff' }}>
      <h2 className="mb-2 flex items-center gap-2 text-base font-semibold">
        <Icon className="h-5 w-5" style={{ color: COLORS.green }} />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A support ticket that works while the system is locked (the only write the company can still make). */
function TicketForm({ company, extra }: { company: string; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('Quero voltar a usar o sistema');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<number | null>(null);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'support', category: 'billing', title: subject, description: text || `A ${company} está com o acesso bloqueado e quer voltar a usar o sistema.`, pageUrl: '/acesso-encerrado' }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível abrir o chamado.');
      setSent(data.ticketNumber ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o chamado.');
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-lg p-3" style={{ background: COLORS.greenBg, color: COLORS.greenInk }}>
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        <span>Chamado{sent ? ` #${sent}` : ''} aberto. A administração do NextRotta vai responder.</span>
      </div>
    );
  }
  if (!open) {
    return (
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          <LifeBuoy className="h-4 w-4" />
          Abrir chamado
        </Button>
        {extra}
      </div>
    );
  }
  const field = 'mt-1 w-full rounded-md border bg-white px-3 py-2 text-sm outline-none focus:ring-2';
  return (
    <div className="mt-3 space-y-3">
      <label className="block">
        <span className="font-medium">Assunto</span>
        <input className={field} style={{ borderColor: COLORS.line }} value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} disabled={busy} />
      </label>
      <label className="block">
        <span className="font-medium">Mensagem</span>
        <textarea className={field} style={{ borderColor: COLORS.line }} rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Conte o que precisa: pagamento feito, combinar uma data, dúvida…" disabled={busy} />
      </label>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" onClick={() => void send()} disabled={busy || subject.trim().length < 3} className="w-full text-white hover:opacity-90 sm:w-auto" style={{ background: COLORS.green }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LifeBuoy className="h-4 w-4" />}
          {busy ? 'Enviando…' : 'Enviar chamado'}
        </Button>
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(false)} disabled={busy}>
          Cancelar
        </Button>
      </div>
      {extra ? <div className="flex flex-col sm:flex-row">{extra}</div> : null}
    </div>
  );
}

type CompanyFiles = {
  documents: Array<{ id: string; title: string; category: string | null; fileName: string | null; type: string | null; size: number | null }>;
  images: Array<{ id: string; name: string; size: number | null }>;
};

const sizeLabel = (bytes: number | null) => (bytes == null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** The private files of the company (library documents and the photos of the parts): the system is locked, but they can still be opened and downloaded. */
function FilesSection() {
  const [files, setFiles] = useState<CompanyFiles | null>(null);
  const [tab, setTab] = useState<'documents' | 'images'>('documents');

  useEffect(() => {
    fetch('/api/organization/files', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CompanyFiles | null) => {
        if (!data) return;
        setFiles(data);
        if (!data.documents.length && data.images.length) setTab('images');
      })
      .catch(() => null);
  }, []);

  if (!files || (!files.documents.length && !files.images.length)) return null;
  const tabs = [
    { key: 'documents' as const, label: 'Documentos', count: files.documents.length, icon: FileText },
    { key: 'images' as const, label: 'Fotos das peças', count: files.images.length, icon: ImageIcon },
  ].filter((item) => item.count > 0);

  return (
    <Section icon={FileText} title="Documentos e imagens">
      <p style={{ color: COLORS.soft }}>Os arquivos são privados e não vão na planilha. Abra ou baixe daqui.</p>
      {tabs.length > 1 ? (
        <div className="mt-3 inline-flex rounded-lg border p-1" style={{ borderColor: COLORS.line, background: COLORS.page }}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium"
              style={tab === item.key ? { background: '#fff', color: COLORS.ink, boxShadow: '0 1px 3px #12302420' } : { color: COLORS.soft }}
            >
              <item.icon className="h-4 w-4" />
              {item.label} ({item.count})
            </button>
          ))}
        </div>
      ) : null}
      <ul className="mt-3 max-h-80 divide-y overflow-y-auto rounded-lg border" style={{ borderColor: COLORS.line }}>
        {tab === 'documents'
          ? files.documents.map((doc) => (
              <FileRow key={doc.id} href={`/api/organization/files/documents/${doc.id}`} title={doc.title} meta={[doc.category, sizeLabel(doc.size)].filter(Boolean).join(' · ')} icon={<FileText className="h-5 w-5" style={{ color: COLORS.green }} />} />
            ))
          : files.images.map((image) => (
              <FileRow
                key={image.id}
                href={`/api/organization/files/images/${image.id}`}
                title={image.name}
                meta={sizeLabel(image.size)}
                icon={
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/organization/files/images/${image.id}`} alt="" loading="lazy" className="h-10 w-10 rounded-md border object-cover" style={{ borderColor: COLORS.line }} />
                }
              />
            ))}
      </ul>
    </Section>
  );
}

function FileRow({ href, title, meta, icon }: { href: string; title: string; meta: string; icon: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3" style={{ borderColor: COLORS.line }}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          {meta ? <span className="block truncate text-xs" style={{ color: COLORS.soft }}>{meta}</span> : null}
        </span>
      </div>
      <div className="flex gap-2 sm:shrink-0">
        <Button asChild size="sm" variant="outline" className="flex-1 sm:flex-none">
          <a href={href} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            Abrir
          </a>
        </Button>
        <Button asChild size="sm" variant="outline" className="flex-1 sm:flex-none">
          <a href={`${href}?download=1`}>
            <Download className="h-4 w-4" />
            Baixar
          </a>
        </Button>
      </div>
    </li>
  );
}
