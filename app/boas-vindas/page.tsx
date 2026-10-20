'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarClock, Check, CreditCard, ExternalLink, Loader2, LogOut, MessageCircle, RefreshCw, Wrench } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';

type Onboarding = {
  organizationName: string;
  status: 'awaiting_payment' | 'setup' | 'done';
  planName: string | null;
  cycle: 'monthly' | 'annual' | null;
  billingDay: number | null;
  firstDueDate: string | null;
  contact: { email: string | null; phone: string | null };
  setup: {
    fee: number;
    paid: boolean;
    charge: { status: string; value: number; dueDate: string; invoiceUrl: string | null } | null;
  };
  support: { whatsapp: string | null; email: string | null };
  isAdmin: boolean;
};

const GREEN = '#1f9d74';
const MUTED = '#5c7268';
const TEXT = '#425a50';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const day = (value: string | null) =>
  value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00Z`)) : '—';

type StepState = 'done' | 'current' | 'next';

function Step({ state, icon, title, children, last }: { state: StepState; icon: ReactNode; title: string; children?: ReactNode; last?: boolean }) {
  const color = state === 'next' ? '#b7c6be' : GREEN;
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: state === 'done' ? GREEN : state === 'current' ? '#e8f6ef' : '#f2f5f3',
            color: state === 'done' ? '#fff' : color,
            border: state === 'current' ? `2px solid ${GREEN}` : 'none',
          }}
        >
          {state === 'done' ? <Check className="h-4 w-4" /> : icon}
        </span>
        {!last && <span className="my-1 w-px flex-1" style={{ background: state === 'done' ? GREEN : '#e1e9e4', minHeight: 20 }} />}
      </div>
      <div className="min-w-0 pb-6">
        <p className="font-semibold" style={{ color: state === 'next' ? '#8a9b93' : '#13261e', fontSize: 15 }}>
          {title}
        </p>
        {children ? (
          <div className="mt-1 text-sm leading-relaxed" style={{ color: state === 'next' ? '#8a9b93' : TEXT }}>
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * First stop of a company that subscribed on the site: the account exists, the setup fee is paid
 * here, and the team sets the platform up before releasing it (the middleware keeps the company on
 * this page until then).
 */
export default function WelcomePage() {
  const [data, setData] = useState<Onboarding | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [contactUrl, setContactUrl] = useState('/login');

  const load = useCallback(async (method: 'GET' | 'POST' = 'GET', check = false) => {
    const response = await fetch(`/api/organization/onboarding${check ? '?check=1' : ''}`, { method, cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || 'Não foi possível carregar.');
    if (body.status === 'done') {
      window.location.assign('/');
      return;
    }
    setData(body);
    setError('');
  }, []);

  useEffect(() => {
    setContactUrl(`${window.location.protocol}//${window.location.host.split('.').slice(1).join('.')}/contato`);
    load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.'));
    // Payment confirmation and the release arrive from outside (gateway, platform team): keep checking.
    const timer = window.setInterval(() => void load().catch(() => null), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function regenerate() {
    setBusy(true);
    try {
      await load('POST');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível gerar a cobrança.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setLeaving(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.assign('/login');
  }

  const paid = data ? data.status !== 'awaiting_payment' || data.setup.paid : false;
  const charge = data?.setup.charge ?? null;
  const chargeOpen = charge ? ['PENDING', 'OVERDUE'].includes(charge.status) : false;
  const cycleText = data?.cycle === 'annual' ? 'anuidade' : 'mensalidade';

  return (
    <main className="flex items-center justify-center px-4 py-10" style={{ background: '#f6f8f6', color: '#13261e', minHeight: '100dvh' }}>
      <div className="w-full rounded-2xl border bg-white p-8" style={{ maxWidth: 620, borderColor: '#dfe9e2', boxShadow: '0 14px 40px #12302410' }}>
        <BrandLogo className="h-12 w-auto" />

        {!data ? (
          <p className="mt-8 text-sm" style={{ color: error ? '#be123c' : MUTED }}>
            {error || 'Carregando…'}
          </p>
        ) : (
          <>
            <h1 className="mt-8 font-semibold" style={{ fontSize: 26, lineHeight: 1.2 }}>
              Bem-vindo ao NextRotta, {data.organizationName}!
            </h1>
            <p className="mt-3 leading-relaxed" style={{ fontSize: 15, color: TEXT }}>
              {paid
                ? 'Sua plataforma está em preparação. Nossa equipe vai entrar em contato o mais rápido possível para iniciar as configurações com você.'
                : 'Sua conta foi criada. Falta só o pagamento da implantação para começarmos a preparar a sua plataforma.'}
            </p>

            {paid ? (
              <div className="mt-6">
                <Button asChild size="lg" className="w-full text-white hover:opacity-90" style={{ background: GREEN }}>
                  <a href={data.isAdmin ? '/admin' : '/dashboard'}>
                    Acessar a plataforma
                    <ArrowRight className="h-5 w-5" />
                  </a>
                </Button>
                <p className="mt-2 text-center text-xs" style={{ color: MUTED }}>
                  Já dá para conhecer o sistema. As alterações ficam liberadas quando a configuração terminar.
                </p>
              </div>
            ) : null}

            <ol className="mt-8">
              <Step state="done" icon={<Check className="h-4 w-4" />} title="Conta criada">
                Plano {data.planName ?? '—'} · {data.cycle === 'annual' ? 'anual' : 'mensal'}
              </Step>

              <Step state={paid ? 'done' : 'current'} icon={<CreditCard className="h-4 w-4" />} title="Pagamento da implantação">
                {paid ? (
                  data.setup.fee > 0 ? (
                    <>Pagamento de {money(data.setup.fee)} confirmado. Obrigado!</>
                  ) : (
                    <>Sem taxa de implantação.</>
                  )
                ) : (
                  <>
                    <p>
                      {money(charge?.value ?? data.setup.fee)} por Pix, boleto ou cartão
                      {chargeOpen && charge ? <>, com vencimento em {day(charge.dueDate)}</> : null}. A confirmação aparece aqui sozinha.
                    </p>
                    {data.isAdmin ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {chargeOpen && charge?.invoiceUrl ? (
                          <Button asChild className="text-white hover:opacity-90" style={{ background: GREEN }}>
                            <a href={charge.invoiceUrl} target="_blank" rel="noreferrer">
                              Pagar implantação
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        ) : (
                          <Button type="button" onClick={() => void regenerate()} disabled={busy} className="text-white hover:opacity-90" style={{ background: GREEN }}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Gerar cobrança da implantação
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          disabled={checking}
                          onClick={() => {
                            setChecking(true);
                            void load('GET', true)
                              .catch(() => null)
                              .finally(() => setChecking(false));
                          }}
                        >
                          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          Já paguei, verificar
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-2">O administrador da empresa faz o pagamento.</p>
                    )}
                    {error ? <p className="mt-2" style={{ color: '#be123c' }}>{error}</p> : null}
                  </>
                )}
              </Step>

              <Step state={paid ? 'current' : 'next'} icon={<Wrench className="h-4 w-4" />} title="Preparação da plataforma">
                Entraremos em contato o mais rápido possível
                {data.contact.phone || data.contact.email ? (
                  <> pelo {[data.contact.phone && `WhatsApp ${data.contact.phone}`, data.contact.email && `e-mail ${data.contact.email}`].filter(Boolean).join(' ou ')}</>
                ) : null}{' '}
                para configurar técnicos, regras da folha e integrações. Quando estiver tudo pronto, as alterações são liberadas no sistema.
              </Step>

              <Step state="next" icon={<CalendarClock className="h-4 w-4" />} title={`Primeira ${cycleText}`} last>
                {paid
                  ? data.cycle === 'annual'
                    ? <>Em {day(data.firstDueDate)} e depois uma vez por ano, na mesma data.</>
                    : <>Em {day(data.firstDueDate)}{data.billingDay ? <> e depois todo dia {data.billingDay}</> : null}.</>
                  : <>Só no mês seguinte ao pagamento da implantação, no dia {data.billingDay ?? '—'} que você escolheu.</>}
              </Step>
            </ol>
          </>
        )}

        <div className="mt-2 flex items-center justify-between border-t pt-5 text-sm" style={{ borderColor: '#e7ede8' }}>
          <a
            href={
              data?.support.whatsapp
                ? `https://wa.me/${data.support.whatsapp}?text=${encodeURIComponent(`Olá! Sou da ${data.organizationName} e acabei de contratar o NextRotta.`)}`
                : contactUrl
            }
            target={data?.support.whatsapp ? '_blank' : undefined}
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-medium hover:underline"
            style={{ color: GREEN }}
          >
            {data?.support.whatsapp ? <MessageCircle className="h-4 w-4" /> : null}
            Falar com a gente{data?.support.whatsapp ? ' no WhatsApp' : ''}
          </a>
          <button type="button" onClick={() => void logout()} disabled={leaving} className="inline-flex items-center gap-2 hover:opacity-80" style={{ color: MUTED }}>
            <LogOut className="h-4 w-4" />
            {leaving ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      </div>
    </main>
  );
}
