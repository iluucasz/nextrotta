'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, Check, CheckCircle2, CreditCard, Loader2, ShieldCheck, Wrench, XCircle } from 'lucide-react';

/**
 * Self-service checkout: plan and billing day → company → access. Creates the account, sends the
 * customer to their own address already logged in, where the setup fee is paid and the platform is
 * prepared by the team. The first monthly (or annual) charge is only next month.
 */

type PlanOption = {
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  extraTechnicianPrice: number;
  setupFee: number;
  onRequest: boolean;
  featured: boolean;
  includedTechnicians: number;
};

/** "Monte o seu": the base plus modules the company ticks; the server prices every combination. */
type BuilderOption = PlanOption & {
  modules: Array<{
    key: string;
    name: string;
    description: string | null;
    monthlyPrice: number;
    annualPrice: number;
    setupFee: number;
  }>;
};

type Quote = {
  plan: { key: string; name: string };
  cycle: 'monthly' | 'annual';
  billingDay: number;
  billingDays: number[];
  modules?: Array<{ key: string; name: string; price: number; setupFee: number }>;
  setupFee: number;
  recurring: number;
  firstDueDate: string;
};

type SlugState = { status: 'idle' | 'checking' | 'available' | 'taken'; reason?: string | null };

const BILLING_DAYS = [5, 10, 15, 20, 25];
const STEPS = ['Plano', 'Empresa', 'Acesso'] as const;
const GREEN = '#327b56';
const MUTED = '#748171';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const longDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'long' }).format(new Date(`${value}T00:00:00Z`));
const onlyDigits = (value: string) => value.replace(/\D/g, '');

function formatDocument(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function formatPhone(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const rest = d.slice(2);
  const split = rest.length === 9 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${rest.length > split ? `${rest.slice(0, split)}-${rest.slice(split)}` : rest}`;
}

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? 'wide' : ''}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function Choice({ selected, onClick, children, style }: { selected: boolean; onClick: () => void; children: ReactNode; style?: CSSProperties }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      style={{
        border: `1.5px solid ${selected ? GREEN : '#dce5de'}`,
        background: selected ? '#eef6ef' : '#fcfdf9',
        color: selected ? '#1c392e' : '#425a50',
        borderRadius: 10,
        padding: '10px 14px',
        textAlign: 'left',
        fontWeight: selected ? 600 : 500,
        cursor: 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SummaryRow({ icon, title, value, detail }: { icon: ReactNode; title: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '16px 0', borderTop: '1px solid #e7eee4' }}>
      <span style={{ color: GREEN, marginTop: 2 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <strong style={{ fontSize: 15, color: '#1c392e' }}>{title}</strong>
          <strong style={{ fontSize: 17, color: '#1c392e', whiteSpace: 'nowrap' }}>{value}</strong>
        </div>
        {detail ? <p style={{ marginTop: 4, fontSize: 13, color: MUTED, lineHeight: 1.6 }}>{detail}</p> : null}
      </div>
    </div>
  );
}

export function MarketingCheckout() {
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [builder, setBuilder] = useState<BuilderOption | null>(null);
  const [modules, setModules] = useState<string[]>([]);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState('');
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [billingDay, setBillingDay] = useState(10);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [values, setValues] = useState({
    company: '',
    legalName: '',
    document: '',
    companyEmail: '',
    phone: '',
    city: '',
    state: '',
    slug: '',
    adminName: '',
    adminEmail: '',
    password: '',
    confirm: '',
    website: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ status: 'idle' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [rootDomain, setRootDomain] = useState('nextrotta.com.br');
  const formRef = useRef<HTMLFormElement>(null);

  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const selectable = useMemo(
    () => [...(plans ?? []).filter((candidate) => !candidate.onRequest), ...(builder ? [{ ...builder, featured: false, onRequest: false }] : [])],
    [plans, builder],
  );
  const chosen = selectable.find((candidate) => candidate.key === plan) ?? null;
  const isBuilder = Boolean(builder && plan === builder.key);
  const toggleModule = (key: string) =>
    setModules((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  useEffect(() => {
    setRootDomain(window.location.host);
    fetch('/api/public/plans', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error())))
      .then((data: { plans: PlanOption[]; builder?: BuilderOption | null }) => {
        setPlans(data.plans);
        setBuilder(data.builder ?? null);
        const query = new URLSearchParams(window.location.search);
        const options = data.plans.filter((candidate) => !candidate.onRequest);
        const wanted = query.get('plano');
        const fromQuery = options.find((candidate) => candidate.key === wanted);
        if (data.builder && wanted === data.builder.key) {
          const offered = new Set(data.builder.modules.map((module) => module.key));
          setModules((query.get('modulos') ?? '').split(',').filter((key) => offered.has(key)));
          setPlan(data.builder.key);
        } else {
          setPlan((fromQuery ?? options.find((candidate) => candidate.featured) ?? options[0])?.key ?? '');
        }
        const queryCycle = query.get('ciclo');
        if (queryCycle === 'monthly' || queryCycle === 'annual') setCycle(queryCycle);
      })
      .catch(() => setLoadError('Não foi possível carregar os planos agora. Recarregue a página.'));
  }, []);

  // Today's charge and the first recurring one, always from the server (prices live in the panel).
  useEffect(() => {
    if (!plan) return;
    let active = true;
    const moduleQuery = isBuilder && modules.length ? `&modules=${modules.join(',')}` : '';
    fetch(`/api/public/signup?plan=${encodeURIComponent(plan)}&cycle=${cycle}&billingDay=${billingDay}${moduleQuery}`, { cache: 'no-store' })
      .then((response) => response.json().then((data) => (response.ok ? data : Promise.reject(new Error(data?.error)))))
      .then((data: Quote) => active && setQuote(data))
      .catch(() => active && setQuote(null));
    return () => {
      active = false;
    };
  }, [plan, cycle, billingDay, isBuilder, modules]);

  // The address follows the company name until the customer edits it.
  useEffect(() => {
    if (!slugTouched) setValues((current) => ({ ...current, slug: slugify(current.company) }));
  }, [values.company, slugTouched]);

  useEffect(() => {
    const slug = values.slug;
    if (!slug) {
      setSlugState({ status: 'idle' });
      return;
    }
    setSlugState({ status: 'checking' });
    const timer = window.setTimeout(() => {
      fetch(`/api/public/signup?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((data: { slug: string; available: boolean; reason: string | null }) => {
          if (data.slug !== slug) return;
          setSlugState({ status: data.available ? 'available' : 'taken', reason: data.reason });
        })
        .catch(() => setSlugState({ status: 'idle' }));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [values.slug]);

  function next() {
    setError('');
    if (!formRef.current?.reportValidity()) return;
    if (step === 0 && !chosen) return setError('Escolha um plano.');
    if (step === 1) {
      const documentDigits = onlyDigits(values.document);
      if (documentDigits.length !== 11 && documentDigits.length !== 14) return setError('Informe o CNPJ (ou CPF) completo.');
      if (onlyDigits(values.phone).length < 10) return setError('Informe o WhatsApp com DDD.');
      if (slugState.status === 'taken') return setError(slugState.reason || 'Este endereço já está em uso. Escolha outro.');
      if (slugState.status === 'checking') return setError('Aguarde a verificação do endereço.');
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  async function submit() {
    setError('');
    if (!formRef.current?.reportValidity()) return;
    if (values.password.length < 8) return setError('A senha precisa ter pelo menos 8 caracteres.');
    if (values.password !== values.confirm) return setError('As senhas não conferem.');
    if (!acceptTerms) return setError('Aceite os termos de uso e a política de privacidade para continuar.');
    setSending(true);
    try {
      const response = await fetch('/api/public/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, confirm: undefined, plan, cycle, billingDay, acceptTerms, ...(isBuilder ? { modules } : {}) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || 'Não foi possível concluir agora. Tente de novo.');
        setSending(false);
        return;
      }
      window.location.assign(data.redirectTo);
    } catch {
      setError('Não foi possível concluir agora. Verifique sua conexão e tente de novo.');
      setSending(false);
    }
  }

  const price = chosen ? (cycle === 'annual' ? chosen.annualPrice : chosen.monthlyPrice) : 0;
  const quotedModules = isBuilder ? (quote?.modules ?? []) : [];
  const recurring = quote?.recurring ?? price;
  const setupFee = quote?.setupFee ?? chosen?.setupFee ?? 0;
  const per = cycle === 'annual' ? 'ano' : 'mês';

  return (
    <section className="nr-public-section nr-contact">
      <div>
        <p className="nr-kicker">CONTRATAÇÃO</p>
        <h1>Assine agora e comece com a gente.</h1>
        <p>
          Crie a conta da sua empresa em poucos minutos. Você paga hoje só a implantação; a primeira {cycle === 'annual' ? 'anuidade' : 'mensalidade'} vem
          no mês seguinte, no dia que você escolher.
        </p>

        <div style={{ marginTop: 34, background: '#fff', border: '1px solid #e0e8d6', borderRadius: 14, padding: '6px 22px 6px' }}>
          <SummaryRow
            icon={<Check size={18} />}
            title={chosen ? `Plano ${chosen.name}` : 'Plano'}
            value={chosen ? `${money(recurring)}/${per}` : '—'}
            detail={
              chosen
                ? `Até ${chosen.includedTechnicians} técnicos incluídos${chosen.extraTechnicianPrice ? ` · técnico extra ${money(chosen.extraTechnicianPrice)}/mês` : ''}.${
                    isBuilder ? ` Módulos: ${quotedModules.length ? quotedModules.map((module) => module.name).join(', ') : 'nenhum além da base'}.` : ''
                  }`
                : undefined
            }
          />
          <SummaryRow
            icon={<CreditCard size={18} />}
            title="Hoje: implantação"
            value={setupFee > 0 ? money(setupFee) : 'Sem custo'}
            detail="Pix, boleto ou cartão. Pago uma única vez, no seu primeiro acesso."
          />
          <SummaryRow
            icon={<CalendarClock size={18} />}
            title={`Primeira ${cycle === 'annual' ? 'anuidade' : 'mensalidade'}`}
            value={quote ? longDate(quote.firstDueDate) : `dia ${billingDay}`}
            detail={`Só no mês seguinte ao pagamento da implantação. Depois, todo dia ${billingDay}${cycle === 'annual' ? ', uma vez por ano' : ''}.`}
          />
          <SummaryRow
            icon={<Wrench size={18} />}
            title="Preparação da plataforma"
            value=""
            detail="Assim que a implantação for paga, nossa equipe entra em contato para configurar o sistema com você."
          />
        </div>
        <p style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, fontSize: 13, color: MUTED }}>
          <ShieldCheck size={16} /> Sem fidelidade no plano mensal. Seus dados nunca são apagados.
        </p>
      </div>

      <div className="nr-contact-form">
        {loadError ? (
          <p className="nr-error" role="alert">
            {loadError}
          </p>
        ) : !plans ? (
          <p style={{ color: MUTED }}>Carregando planos…</p>
        ) : (
          <form
            ref={formRef}
            onSubmit={(event) => {
              event.preventDefault();
              if (step < STEPS.length - 1) next();
              else void submit();
            }}
          >
            <ol style={{ display: 'flex', gap: 8, marginBottom: 26, listStyle: 'none', padding: 0 }}>
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: 600,
                    color: index <= step ? '#1c392e' : '#a3b09f',
                    borderTop: `3px solid ${index <= step ? GREEN : '#e3eadf'}`,
                    paddingTop: 8,
                  }}
                >
                  {index + 1}. {label}
                </li>
              ))}
            </ol>

            {step === 0 && (
              <>
                <h2>Escolha o plano</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  {selectable.map((candidate) => (
                    <Choice key={candidate.key} selected={plan === candidate.key} onClick={() => setPlan(candidate.key)}>
                      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <span>
                          {candidate.name}
                          {candidate.featured ? <small style={{ marginLeft: 8, color: GREEN, fontWeight: 600 }}>O mais escolhido</small> : null}
                        </span>
                        <span>
                          {builder && candidate.key === builder.key ? 'a partir de ' : ''}
                          {money(cycle === 'annual' ? candidate.annualPrice : candidate.monthlyPrice)}/{per}
                        </span>
                      </span>
                      {candidate.description ? <small style={{ display: 'block', marginTop: 4, color: MUTED, fontWeight: 400 }}>{candidate.description}</small> : null}
                    </Choice>
                  ))}
                  <Link href="/contato" style={{ fontSize: 13, color: GREEN, textDecoration: 'underline' }}>
                    Ficou com dúvida sobre qual escolher? Fale com a gente.
                  </Link>
                </div>

                {isBuilder && builder ? (
                  <>
                    <p style={{ margin: '24px 0 10px', fontWeight: 600, fontSize: 15 }}>Módulos do seu plano</p>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {builder.modules.map((module) => (
                        <label
                          key={module.key}
                          style={{
                            display: 'flex',
                            gap: 12,
                            alignItems: 'flex-start',
                            border: `1.5px solid ${modules.includes(module.key) ? GREEN : '#dce5de'}`,
                            background: modules.includes(module.key) ? '#eef6ef' : '#fcfdf9',
                            borderRadius: 10,
                            padding: '10px 14px',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={modules.includes(module.key)}
                            onChange={() => toggleModule(module.key)}
                            style={{ marginTop: 4, accentColor: GREEN }}
                          />
                          <span style={{ flex: 1 }}>
                            <strong style={{ fontWeight: 600 }}>{module.name}</strong>
                            {module.description ? <small style={{ display: 'block', color: MUTED }}>{module.description}</small> : null}
                          </span>
                          <span style={{ whiteSpace: 'nowrap', color: GREEN, fontWeight: 600 }}>
                            +{money(cycle === 'annual' ? module.annualPrice : module.monthlyPrice)}/{per}
                          </span>
                        </label>
                      ))}
                    </div>
                    <small style={{ display: 'block', marginTop: 8, color: MUTED }}>
                      A base já inclui técnicos, OS, horas, escala e folha. Precisa de outro módulo depois? É só falar com a gente.
                    </small>
                  </>
                ) : null}

                <p style={{ margin: '24px 0 10px', fontWeight: 600, fontSize: 15 }}>Ciclo de cobrança</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Choice selected={cycle === 'monthly'} onClick={() => setCycle('monthly')}>
                    Mensal
                  </Choice>
                  <Choice selected={cycle === 'annual'} onClick={() => setCycle('annual')}>
                    Anual
                    {chosen && chosen.monthlyPrice * 12 > chosen.annualPrice ? (
                      <small style={{ display: 'block', color: GREEN, fontWeight: 500 }}>economize {money(chosen.monthlyPrice * 12 - chosen.annualPrice)}</small>
                    ) : null}
                  </Choice>
                </div>

                <p style={{ margin: '24px 0 10px', fontWeight: 600, fontSize: 15 }}>Dia do vencimento</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                  {(quote?.billingDays ?? BILLING_DAYS).map((day) => (
                    <Choice key={day} selected={billingDay === day} onClick={() => setBillingDay(day)} style={{ textAlign: 'center', padding: '10px 0' }}>
                      {day}
                    </Choice>
                  ))}
                </div>
                <small style={{ display: 'block', marginTop: 8, color: MUTED }}>
                  A {cycle === 'annual' ? 'anuidade' : 'mensalidade'} vence sempre nesse dia, a partir do mês seguinte à implantação.
                </small>
              </>
            )}

            {step === 1 && (
              <>
                <h2>Dados da empresa</h2>
                <div className="nr-form-grid">
                  <Field label="Nome da empresa *">
                    <input required value={values.company} onChange={(event) => set('company', event.target.value)} autoComplete="organization" />
                  </Field>
                  <Field label="CNPJ ou CPF *">
                    <input required inputMode="numeric" value={values.document} onChange={(event) => set('document', formatDocument(event.target.value))} />
                  </Field>
                  <Field label="Razão social" hint="Para a nota e a cobrança. Se vazio, usamos o nome da empresa." wide>
                    <input value={values.legalName} onChange={(event) => set('legalName', event.target.value)} />
                  </Field>
                  <Field label="E-mail da empresa *" hint="Recebe as cobranças.">
                    <input required type="email" value={values.companyEmail} onChange={(event) => set('companyEmail', event.target.value)} autoComplete="email" />
                  </Field>
                  <Field label="WhatsApp *" hint="Para combinarmos a implantação.">
                    <input required inputMode="tel" value={values.phone} onChange={(event) => set('phone', formatPhone(event.target.value))} autoComplete="tel" />
                  </Field>
                  <Field label="Cidade">
                    <input value={values.city} onChange={(event) => set('city', event.target.value)} autoComplete="address-level2" />
                  </Field>
                  <Field label="UF">
                    <input value={values.state} maxLength={2} onChange={(event) => set('state', event.target.value.toUpperCase())} autoComplete="address-level1" />
                  </Field>
                  <Field
                    wide
                    label="Endereço do seu sistema *"
                    hint={
                      slugState.status === 'checking' ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <Loader2 size={13} className="animate-spin" /> Verificando…
                        </span>
                      ) : slugState.status === 'available' ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: GREEN }}>
                          <CheckCircle2 size={13} /> Disponível
                        </span>
                      ) : slugState.status === 'taken' ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: '#b42318' }}>
                          <XCircle size={13} /> {slugState.reason || 'Indisponível'}
                        </span>
                      ) : (
                        'Letras minúsculas, números e hífen.'
                      )
                    }
                  >
                    <span style={{ display: 'flex', alignItems: 'center', border: '1px solid #dce5de', borderRadius: 6, background: '#fcfdf9', overflow: 'hidden' }}>
                      <input
                        required
                        value={values.slug}
                        onChange={(event) => {
                          setSlugTouched(true);
                          set('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63));
                        }}
                        style={{ border: 0, borderRadius: 0, flex: '1 0 50%', minWidth: 0 }}
                      />
                      <span style={{ padding: '0 12px 0 2px', color: MUTED, fontSize: 14, whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${values.slug}.${rootDomain}`}>.{rootDomain}</span>
                    </span>
                  </Field>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2>Seu acesso</h2>
                <div className="nr-form-grid">
                  <Field label="Seu nome *" wide>
                    <input required value={values.adminName} onChange={(event) => set('adminName', event.target.value)} autoComplete="name" />
                  </Field>
                  <Field label="E-mail de acesso *" hint="É com ele que você entra no sistema." wide>
                    <input required type="email" value={values.adminEmail} onChange={(event) => set('adminEmail', event.target.value)} autoComplete="username" />
                  </Field>
                  <Field label="Senha *" hint="Pelo menos 8 caracteres.">
                    <input required type="password" minLength={8} value={values.password} onChange={(event) => set('password', event.target.value)} autoComplete="new-password" />
                  </Field>
                  <Field label="Confirme a senha *">
                    <input required type="password" minLength={8} value={values.confirm} onChange={(event) => set('confirm', event.target.value)} autoComplete="new-password" />
                  </Field>
                </div>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 20, fontSize: 14, color: '#425a50' }}>
                  <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} style={{ marginTop: 3, width: 16, height: 16, accentColor: GREEN }} />
                  <span>
                    Li e aceito os{' '}
                    <Link href="/termos" target="_blank" style={{ textDecoration: 'underline' }}>
                      termos de uso
                    </Link>{' '}
                    e a{' '}
                    <Link href="/privacidade" target="_blank" style={{ textDecoration: 'underline' }}>
                      política de privacidade
                    </Link>
                    .
                  </span>
                </label>
                <p style={{ marginTop: 16, fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
                  Ao concluir, sua conta é criada e você entra direto em {values.slug || 'sua-empresa'}.{rootDomain}
                  {setupFee > 0 ? `, onde paga a implantação (${money(setupFee)})` : ''}.
                </p>
              </>
            )}

            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
              value={values.website}
              onChange={(event) => set('website', event.target.value)}
            />

            {error && (
              <p className="nr-error" role="alert" style={{ marginTop: 18 }}>
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 26 }}>
              {step > 0 && (
                <button type="button" className="nr-btn" onClick={() => (setError(''), setStep((current) => current - 1))} disabled={sending}>
                  <ArrowLeft size={16} />
                  Voltar
                </button>
              )}
              <button type="submit" className="nr-btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={sending || (step === 0 && !chosen)}>
                {sending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Criando sua conta…
                  </>
                ) : step < STEPS.length - 1 ? (
                  <>
                    Continuar <ArrowRight size={16} />
                  </>
                ) : (
                  <>
                    {setupFee > 0 ? 'Criar conta e ir para o pagamento' : 'Criar conta'} <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
