'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy, ExternalLink, LoaderCircle } from 'lucide-react';
import type { OrganizationSettings } from '@/lib/organization-settings';
import type { Plan, PlanLimits } from '@/lib/plans';
import {
  api,
  CHARGE_KIND_LABELS,
  chargeStatusLabel,
  CYCLE_LABELS,
  date,
  errorMessage,
  money,
  ORGANIZATION_STATUS_LABELS,
  ROLE_LABELS,
  slugify,
  useOrganizationHost,
  useResource,
  type OrganizationStatusKey,
} from './api';
import { AuditTable } from './audit';
import { CouponPanel, CreditsTab, CustomFeaturesPanel, DataTab, OrganizationBugsTab } from './organization-tabs';
import { OrganizationCostsTab } from './organization-costs';
import { OrganizationStoragePanel } from './organization-storage';
import {
  Badge,
  Confirm,
  DataTable,
  Editor,
  Empty,
  ErrorState,
  Fields,
  Loading,
  Metric,
  NewLink,
  Panel,
  Title,
  options,
  type Field,
  type FormValues,
} from './ui';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useNotify } from './notice';

// ---------------------------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------------------------

/** Companies that subscribed on the site: setup fee → preparation by the team → released. */
type OnboardingStatus = 'awaiting_payment' | 'setup' | 'done';
const ONBOARDING_LABELS: Record<OnboardingStatus, string> = {
  awaiting_payment: 'Aguardando implantação',
  setup: 'Em preparação',
  done: 'Liberada',
};

type OrganizationListItem = {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  status: OrganizationStatusKey;
  onboardingStatus: OnboardingStatus | null;
  createdAt: string;
  activeTechnicians: number;
  activeUsers: number;
  subscription: {
    planId: string;
    planName: string;
    cycle: 'monthly' | 'annual';
    includedTechnicians: number;
    nextDueDate: string | null;
    value: number;
  } | null;
};

type Organization = {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  slug: string;
  status: OrganizationStatusKey;
  statusReason: string | null;
  createdAt: string;
  activatedAt: string | null;
  onboardingStatus: OnboardingStatus | null;
  signupSource: 'owner' | 'self_service' | null;
};

type Subscription = {
  plan: { id: string; key: string; name: string };
  cycle: 'monthly' | 'annual';
  basePrice: number;
  extraTechnicianPrice: number;
  includedTechnicians: number;
  discountPercent: number;
  discountAmount: number;
  activeTechnicians: number;
  extraTechnicians: number;
  value: number;
  setupFee: number;
  setupFeeStatus: 'none' | 'pending' | 'paid' | 'waived';
  graceDays: number;
  limitOverrides: Partial<PlanLimits>;
  nextDueDate: string | null;
  asaas: { customerId: string | null; subscriptionId: string | null };
};

type ProvisioningStep = {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  note: string | null;
};

type Provisioning = { steps: ProvisioningStep[]; startedAt: string; finishedAt: string | null };

type OrganizationDetailData = {
  organization: Organization;
  access: { level: 'full' | 'read_only' | 'export_only'; readOnlyUntil: string | null; since: string | null } | null;
  usage: {
    activeTechnicians: number;
    activeUsers: number;
    storageBytes: number;
    whatsappSentThisMonth: number;
    portoRunsThisMonth: number;
  };
  integrations: {
    porto: {
      configured: boolean;
      automationEnabled: boolean;
      dryRunOnly?: boolean;
      lastHoursImportAt?: string | null;
      lastHoursImportStatus?: string | null;
      lastScheduleCheckAt?: string | null;
      lastScheduleImportStatus?: string | null;
      lastError?: string | null;
    };
    whatsapp: { enabled: boolean; instance?: string | null; state?: string | null; number?: string | null; checkedAt?: string | null };
  };
  settings: OrganizationSettings;
  provisioning: Provisioning | null;
  subscription: Subscription | null;
};

type Charge = {
  id: string;
  kind: string;
  description: string | null;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl: string | null;
};

type OrganizationUser = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'technician';
  status: 'active' | 'inactive';
  lastLoginAt: string | null;
  technicianId: string | null;
};

type Note = { id: string; text: string; createdAt: string; authorName: string };

type PlanWithUsage = Plan & { activeSubscriptions: number };

const statusLabel = (status: OrganizationStatusKey) => ORGANIZATION_STATUS_LABELS[status] ?? status;
const SETUP_LABELS: Record<Subscription['setupFeeStatus'], string> = {
  none: 'Sem implantação',
  pending: 'Pendente',
  paid: 'Paga',
  waived: 'Dispensada',
};
const LIMIT_LABELS: Record<keyof PlanLimits, string> = {
  maxUsers: 'Usuários ativos',
  storageMb: 'Armazenamento (MB)',
  whatsappMessagesMonth: 'WhatsApp / mês',
  portoRunsMonth: 'Execuções Porto / mês',
};
const unlimited = (value: number | null | undefined) => (value === null || value === undefined ? 'Ilimitado' : String(value));

const companyFields: Field[] = [
  { key: 'name', label: 'Nome fantasia', required: true },
  { key: 'legalName', label: 'Razão social' },
  { key: 'document', label: 'CNPJ', hint: 'Obrigatório para ativar a cobrança.' },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'phone', label: 'Telefone / WhatsApp' },
  { key: 'city', label: 'Cidade' },
  { key: 'state', label: 'UF' },
];

const text = (value: unknown) => String(value ?? '').trim();

/** "Empresa Zeta" → "EZ": initials of the first and last words. */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`).toUpperCase();
}

/** Shows a temporary password the API returned once — it isn't stored anywhere readable. */
function SecretNotice({ title, description, secret, onClose }: { title: string; description: string; secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="nr-dialog sm:max-w-lg">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <div className="nr-note">
          <code className="text-base">{secret}</code>
          <button
            className="nr-btn mt-3"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copiada' : 'Copiar senha'}
          </button>
          <small>Esta senha aparece só agora. Se perder, use “Redefinir senha” na aba Usuários.</small>
        </div>
        <div className="nr-dialog-actions">
          <button className="nr-btn primary" onClick={onClose}>
            Já anotei
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

export function Organizations() {
  const { data, error, loading, reload } = useResource<{ organizations: OrganizationListItem[] }>('/organizations');
  const notify = useNotify();
  const host = useOrganizationHost();
  const [enter, setEnter] = useState<OrganizationListItem | null>(null);

  const rows = (data?.organizations ?? []).map((organization) => ({
    ...organization,
    statusText: statusLabel(organization.status),
    plan: organization.subscription?.planName ?? 'Sem plano',
    cycle: organization.subscription ? CYCLE_LABELS[organization.subscription.cycle] : '—',
    value: organization.subscription?.value ?? 0,
    nextBilling: organization.subscription?.nextDueDate ?? '',
  }));

  return (
    <>
      <Title
        title="Organizações"
        description="Cada empresa tem seu próprio endereço. Acompanhe todas por aqui."
        action={<NewLink href="/plataforma/organizacoes/nova">Nova organização</NewLink>}
      />
      <div className="nr-metrics">
        {(['active', 'past_due', 'suspended', 'provisioning'] as OrganizationStatusKey[]).map((status) => (
          <Metric key={status} label={statusLabel(status)} value={rows.filter((row) => row.status === status).length} detail="organizações" />
        ))}
      </div>
      <Panel title="Sua base de clientes">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : (
          <DataTable
            rows={rows}
            defaultSort="createdAt"
            defaultDescending
            filters={[
              { key: 'plan', label: 'Plano', options: [...new Set(rows.map((row) => row.plan))] },
              { key: 'statusText', label: 'Estado', options: Object.values(ORGANIZATION_STATUS_LABELS) },
              { key: 'cycle', label: 'Ciclo', options: ['Mensal', 'Anual'] },
            ]}
            columns={[
              {
                key: 'name',
                label: 'Organização',
                render: (row) => (
                  <Link className="nr-company" href={`/plataforma/organizacoes/${row.id}`}>
                    <span className="nr-avatar">{initials(row.name)}</span>
                    <span>
                      {row.name}
                      <small>{host(row.slug)}</small>
                    </span>
                  </Link>
                ),
              },
              { key: 'plan', label: 'Plano' },
              { key: 'cycle', label: 'Ciclo' },
              {
                key: 'statusText',
                label: 'Estado',
                render: (row) => (
                  <span>
                    <Badge>{row.statusText}</Badge>
                    {row.onboardingStatus && row.onboardingStatus !== 'done' ? <small className="block">{ONBOARDING_LABELS[row.onboardingStatus]}</small> : null}
                  </span>
                ),
              },
              {
                key: 'activeTechnicians',
                label: 'Técnicos',
                render: (row) => {
                  const included = row.subscription?.includedTechnicians;
                  if (!included) return String(row.activeTechnicians);
                  return (
                    <div>
                      {row.activeTechnicians} / {included}
                      <div className="nr-progress">
                        <span style={{ width: `${Math.min(100, (row.activeTechnicians / included) * 100)}%` }} />
                      </div>
                    </div>
                  );
                },
              },
              { key: 'value', label: 'Valor do ciclo', render: (row) => (row.subscription ? money(row.value) : '—') },
              { key: 'nextBilling', label: 'Próxima cobrança', render: (row) => date(row.nextBilling) },
              { key: 'createdAt', label: 'Criada em', render: (row) => date(row.createdAt) },
            ]}
            actions={(row) => (
              <>
                <Link href={`/plataforma/organizacoes/${row.id}`}>Detalhes</Link>
                <button aria-label={`Entrar na conta de ${row.name}`} disabled={row.status === 'provisioning'} onClick={() => setEnter(row)}>
                  <ExternalLink size={14} />
                </button>
                <button
                  aria-label={`Copiar link de ${row.name}`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${window.location.protocol}//${host(row.slug)}`);
                      notify('Link copiado.');
                    } catch {
                      notify('Não foi possível copiar o link.');
                    }
                  }}
                >
                  <Copy size={14} />
                </button>
              </>
            )}
            emptyText="Nenhuma organização ainda. Crie a primeira pelo botão “Nova organização”."
          />
        )}
      </Panel>
      {enter && <EnterOrganization organization={enter} onClose={() => setEnter(null)} />}
    </>
  );
}

/** Opens a real, audited, 2-hour session inside the organization's own system. */
/** Goes straight into the organization's system as the owner (no confirmation; always audited). */
function EnterOrganization({ organization, onClose }: { organization: { id: string; name: string }; onClose: () => void }) {
  const notify = useNotify();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<{ redirectTo: string }>(`/organizations/${organization.id}/impersonate`, { body: {} })
      .then(({ redirectTo }) => window.location.assign(redirectTo))
      .catch((reason) => {
        notify(errorMessage(reason));
        onClose();
      });
  }, [organization.id, notify, onClose]);

  return (
    <div className="nr-entering" role="status">
      <LoaderCircle className="animate-spin" size={28} />
      Entrando em {organization.name}…
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Creation wizard
// ---------------------------------------------------------------------------------------------

export function OrganizationWizard() {
  const router = useRouter();
  const host = useOrganizationHost();
  const plansResource = useResource<{ plans: PlanWithUsage[] }>('/plans');
  const plans = (plansResource.data?.plans ?? []).filter((plan) => !plan.archived);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [slugStatus, setSlugStatus] = useState<{ slug: string; available: boolean; reason: string | null } | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>({
    name: '',
    legalName: '',
    document: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    slug: '',
    planId: '',
    cycle: 'monthly',
    discountPercent: 0,
    discountAmount: 0,
    chargeSetupFee: true,
    setupFee: 0,
    adminName: '',
    adminEmail: '',
  });

  // "Converter em organização": start from what the lead told us on the site.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('lead');
    if (!id) return;
    api<{ lead: { id: string; name: string; company: string; email: string; phone: string | null; planId: string | null; cycle: string | null } }>(`/leads/${id}`)
      .then(({ lead }) => {
        setLeadId(lead.id);
        setValues((current) => ({
          ...current,
          name: lead.company,
          legalName: lead.company,
          email: lead.email,
          phone: lead.phone ?? '',
          slug: slugify(lead.company),
          adminName: lead.name,
          adminEmail: lead.email,
          ...(lead.planId ? { planId: lead.planId, setupFee: plans.find((plan) => plan.id === lead.planId)?.setupFee ?? current.setupFee } : {}),
          ...(lead.cycle === 'monthly' || lead.cycle === 'annual' ? { cycle: lead.cycle } : {}),
        }));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plansResource.data]);

  // Default to the featured plan once plans arrive.
  useEffect(() => {
    if (values.planId || !plans.length) return;
    const initial = plans.find((plan) => plan.featured) ?? plans[0];
    setValues((current) => ({ ...current, planId: initial.id, setupFee: initial.setupFee }));
  }, [plans, values.planId]);

  // Live availability check of the subdomain, debounced.
  useEffect(() => {
    const slug = text(values.slug);
    if (!slug) {
      setSlugStatus(null);
      return;
    }
    const timer = setTimeout(() => {
      api<{ slug: string; available: boolean; reason: string | null }>(`/organizations/slug?slug=${encodeURIComponent(slug)}`)
        .then(setSlugStatus)
        .catch(() => setSlugStatus(null));
    }, 350);
    return () => clearTimeout(timer);
  }, [values.slug]);

  const plan = plans.find((candidate) => candidate.id === values.planId);
  const basePrice = plan ? (values.cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice) : 0;
  const cycleValue = Math.max(0, basePrice * (1 - Number(values.discountPercent || 0) / 100) - Number(values.discountAmount || 0));
  const setupFee = values.chargeSetupFee ? Number(values.setupFee || 0) : 0;
  const steps = ['Empresa', 'Subdomínio', 'Plano', 'Administrador', 'Revisão'];
  const slugOk = slugStatus?.slug === text(values.slug) && slugStatus.available;

  async function create() {
    setSaving(true);
    setError('');
    try {
      const { organization } = await api<{ organization: { id: string } }>('/organizations', {
        body: {
          name: text(values.name),
          legalName: text(values.legalName),
          document: text(values.document),
          email: text(values.email),
          phone: text(values.phone),
          city: text(values.city),
          state: text(values.state),
          slug: text(values.slug),
          admin: { name: text(values.adminName), email: text(values.adminEmail) },
          ...(leadId ? { leadId } : {}),
          subscription: plan
            ? {
                planId: plan.id,
                cycle: values.cycle,
                discountPercent: Number(values.discountPercent || 0),
                discountAmount: Number(values.discountAmount || 0),
                setupFee: Number(values.setupFee || 0),
                chargeSetupFee: Boolean(values.chargeSetupFee),
              }
            : undefined,
        },
      });
      router.push(`/plataforma/organizacoes/${organization.id}/provisionamento`);
    } catch (reason) {
      setError(errorMessage(reason));
      setSaving(false);
    }
  }

  if (plansResource.loading && !plansResource.data) return <Loading />;
  if (plansResource.error) return <ErrorState message={plansResource.error} onRetry={plansResource.reload} />;

  return (
    <>
      <Title title="Uma nova organização começa aqui." description="Configure a empresa, escolha o plano e prepare o primeiro acesso." />
      <div className="nr-tabs" role="tablist">
        {steps.map((label, index) => (
          <button role="tab" aria-selected={index === step} disabled={index > step} key={label} onClick={() => setStep(index)}>
            {index + 1}. {label}
          </button>
        ))}
      </div>
      <Panel title={`${step + 1}. ${steps[step]}`} description="Os campos marcados com * são obrigatórios.">
        <form
          className="nr-pad"
          onSubmit={(event) => {
            event.preventDefault();
            setError('');
            if (step === 1 && !slugOk) {
              setError(slugStatus?.reason ?? 'Aguarde a verificação do subdomínio.');
              return;
            }
            if (step < steps.length - 1) setStep(step + 1);
            else void create();
          }}
        >
          {step === 0 && (
            <Fields
              fields={companyFields}
              values={values}
              setValues={(next) =>
                setValues({ ...next, slug: values.name !== next.name && (!values.slug || values.slug === slugify(String(values.name))) ? slugify(String(next.name)) : next.slug })
              }
            />
          )}
          {step === 1 && (
            <>
              <Fields fields={[{ key: 'slug', label: 'Subdomínio', required: true, hint: 'Letras minúsculas, números e hífen. Não muda depois.' }]} values={values} setValues={setValues} />
              <div className="nr-note">
                {host(text(values.slug) || 'sua-empresa')}
                <small role="status">
                  {!text(values.slug) ? 'Escolha o endereço da empresa.' : !slugStatus || slugStatus.slug !== text(values.slug) ? 'Verificando…' : slugStatus.available ? '✓ Subdomínio disponível' : slugStatus.reason}
                </small>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <Fields
                fields={[
                  { key: 'planId', label: 'Plano', type: 'select', required: true, options: plans.map((candidate) => ({ value: candidate.id, label: candidate.name })) },
                  { key: 'cycle', label: 'Ciclo', type: 'select', required: true, options: [{ value: 'monthly', label: 'Mensal' }, { value: 'annual', label: 'Anual' }] },
                  { key: 'discountPercent', label: 'Desconto (%)', type: 'number' },
                  { key: 'discountAmount', label: 'Desconto (R$)', type: 'number' },
                  { key: 'chargeSetupFee', label: 'Cobrar implantação', type: 'checkbox' },
                  { key: 'setupFee', label: 'Valor da implantação (R$)', type: 'number' },
                ]}
                values={values}
                setValues={(next) =>
                  setValues({ ...next, setupFee: next.planId !== values.planId ? plans.find((candidate) => candidate.id === next.planId)?.setupFee ?? 0 : next.setupFee })
                }
              />
              <div className="nr-note">
                Primeira cobrança: <strong>{money(cycleValue + setupFee)}</strong>
                <small>
                  {CYCLE_LABELS[String(values.cycle)]} {money(basePrice)} − descontos + implantação {money(setupFee)}. A cobrança é ativada depois, na aba Assinatura.
                </small>
              </div>
            </>
          )}
          {step === 3 && (
            <Fields
              fields={[
                { key: 'adminName', label: 'Nome do administrador', required: true },
                { key: 'adminEmail', label: 'E-mail do administrador', type: 'email', required: true, hint: 'É o login dele. A senha temporária aparece ao final do provisionamento.' },
              ]}
              values={values}
              setValues={setValues}
            />
          )}
          {step === 4 && (
            <div className="nr-info-grid">
              {[
                ['Empresa', values.name],
                ['Razão social', values.legalName || '—'],
                ['CNPJ', values.document || '—'],
                ['Contato', [values.email, values.phone].filter(Boolean).join(' · ') || '—'],
                ['Cidade', [values.city, values.state].filter(Boolean).join(' / ') || '—'],
                ['Subdomínio', host(text(values.slug))],
                ['Plano / ciclo', plan ? `${plan.name} / ${CYCLE_LABELS[String(values.cycle)]}` : '—'],
                ['Valor do ciclo', money(cycleValue)],
                ['Implantação', values.chargeSetupFee ? money(setupFee) : 'Dispensada'],
                ['Administrador', `${values.adminName} · ${values.adminEmail}`],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </div>
          )}
          {error && (
            <p className="nr-error" role="alert">
              {error}
            </p>
          )}
          <div className="nr-dialog-actions">
            {step > 0 && (
              <button type="button" className="nr-btn" onClick={() => setStep(step - 1)}>
                Voltar
              </button>
            )}
            <button className="nr-btn primary" disabled={saving}>
              {step === steps.length - 1 ? (saving ? 'Criando…' : 'Criar organização') : 'Continuar'}
            </button>
          </div>
        </form>
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Provisioning progress
// ---------------------------------------------------------------------------------------------

function stepDuration(step: ProvisioningStep) {
  if (!step.startedAt || !step.finishedAt) return null;
  const seconds = (new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()) / 1000;
  return `${seconds.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;
}

const STEP_STATUS_LABELS: Record<ProvisioningStep['status'], string> = {
  pending: 'Aguardando',
  running: 'Em andamento',
  done: 'Concluída',
  skipped: 'Pulada',
  error: 'Erro',
};

export function Provisioning({ id }: { id: string }) {
  const host = useOrganizationHost();
  const detail = useResource<OrganizationDetailData>(`/organizations/${id}`);
  const [provisioning, setProvisioning] = useState<Provisioning | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState<string | null>(null);
  const [enter, setEnter] = useState(false);
  const started = useRef(false);

  async function run() {
    setRunning(true);
    setError('');
    // The run answers when it ends; meanwhile poll so each step shows up as it happens.
    const poll = setInterval(() => {
      api<{ provisioning: Provisioning }>(`/organizations/${id}/provisioning`)
        .then((value) => setProvisioning(value.provisioning))
        .catch(() => undefined);
    }, 700);
    try {
      const result = await api<{ provisioning: Provisioning; finished: boolean; adminTemporaryPassword: string | null }>(
        `/organizations/${id}/provisioning`,
        { method: 'POST' },
      );
      setProvisioning(result.provisioning);
      if (result.adminTemporaryPassword) setPassword(result.adminTemporaryPassword);
      if (result.finished) detail.reload();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      clearInterval(poll);
      setRunning(false);
    }
  }

  // Start automatically on a fresh organization; an earlier failure waits for "Tentar novamente".
  useEffect(() => {
    if (!detail.data || started.current) return;
    started.current = true;
    const current = detail.data.provisioning;
    setProvisioning(current);
    if (current && !current.finishedAt && !current.steps.some((step) => step.status === 'error')) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data]);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  const organization = detail.data!.organization;
  const steps = provisioning?.steps ?? [];
  const finished = Boolean(provisioning?.finishedAt) || (steps.length > 0 && steps.every((step) => step.status === 'done' || step.status === 'skipped'));
  const failed = steps.find((step) => step.status === 'error');

  return (
    <>
      <Title
        title={`Preparando ${organization.name}`}
        description="Você pode sair desta tela e voltar. O provisionamento retoma de onde parou."
        action={
          <Link className="nr-btn" href="/plataforma/organizacoes">
            Voltar às organizações
          </Link>
        }
      />
      <Panel title={finished ? 'Tudo pronto para começar.' : 'Provisionamento em andamento'} description="Cada etapa é executada de verdade e fica registrada.">
        <div className="nr-pad nr-step-list">
          {!steps.length && <Empty title="Sem provisionamento" text="Esta organização não foi criada pelo assistente." />}
          {steps.map((step, index) => (
            <div className="nr-step" key={step.key}>
              <span>
                {step.status === 'done' || step.status === 'skipped' ? (
                  <Check size={17} />
                ) : step.status === 'running' || (running && step.status === 'pending' && index === steps.findIndex((s) => s.status === 'pending')) ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  index + 1
                )}
              </span>
              <div>
                {step.label}
                <small>{step.error ?? step.note ?? stepDuration(step) ?? (step.status === 'pending' ? 'Ainda não iniciada' : '')}</small>
              </div>
              <Badge>{STEP_STATUS_LABELS[step.status]}</Badge>
            </div>
          ))}
          {(failed || error) && !running && (
            <div className="nr-alert mt-5">
              {failed?.error ?? error}
              <button className="nr-btn mt-3" onClick={() => void run()}>
                Tentar novamente a partir desta etapa
              </button>
            </div>
          )}
          {finished && (
            <div className="mt-6">
              <p>{host(organization.slug)}</p>
              <div className="nr-actions mt-4">
                <Link className="nr-btn primary" href={`/plataforma/organizacoes/${id}`}>
                  Abrir organização
                </Link>
                <button className="nr-btn" onClick={() => setEnter(true)}>
                  Entrar na conta
                </button>
              </div>
            </div>
          )}
        </div>
      </Panel>
      {password && (
        <SecretNotice
          title="Senha temporária do administrador"
          description="Envie ao administrador junto com o endereço da empresa. No primeiro acesso, ele entra em nextrotta.com.br com o e-mail dele e esta senha."
          secret={password}
          onClose={() => setPassword(null)}
        />
      )}
      {enter && <EnterOrganization organization={organization} onClose={() => setEnter(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------

type ActionForm = {
  title: string;
  description?: string;
  fields: Field[];
  initial: FormValues;
  reason?: boolean;
  strong?: string;
  submit?: string;
  save: (values: FormValues, reason: string) => Promise<void>;
  validate?: (values: FormValues) => string;
};

/** "80:250; 160:600" ⇄ award tiers, for editing them in a single field. */
const tiersToText = (tiers: OrganizationSettings['serviceAwardTiers']) => tiers.map((tier) => `${tier.minServices}:${tier.amount}`).join('; ');
function textToTiers(value: string) {
  return value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [minServices, amount] = part.split(':').map((piece) => Number(piece.trim().replace(',', '.')));
      return { minServices, amount };
    });
}

export function OrganizationDetail({ id }: { id: string; access?: boolean }) {
  const notify = useNotify();
  const host = useOrganizationHost();
  const detail = useResource<OrganizationDetailData>(`/organizations/${id}`);
  const plans = useResource<{ plans: PlanWithUsage[] }>('/plans');
  const features = useResource<{ features: Array<{ key: string; name: string; core: boolean }> }>('/features');
  const [tab, setTab] = useState('Resumo');
  const [editor, setEditor] = useState<ActionForm | null>(null);
  const [enter, setEnter] = useState(false);
  const [secret, setSecret] = useState<{ title: string; description: string; secret: string } | null>(null);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;

  const { organization, usage, integrations, settings, subscription, access } = detail.data!;
  const plan = plans.data?.plans.find((candidate) => candidate.id === subscription?.plan.id);
  const featureName = (key: string) => features.data?.features.find((feature) => feature.key === key)?.name ?? key;
  const readOnly = organization.status === 'suspended' || organization.status === 'canceled';

  async function act(action: () => Promise<unknown>, message: string) {
    await action();
    notify(message);
    detail.reload();
  }

  const subscriptionBody = (changes: Record<string, unknown>) => ({
    planId: subscription!.plan.id,
    cycle: subscription!.cycle,
    ...changes,
  });

  async function saveSubscription(changes: Record<string, unknown>, message: string) {
    const result = await api<{ syncWarning: string | null }>(`/organizations/${id}/subscription`, {
      method: 'PUT',
      body: subscriptionBody(changes),
    });
    notify(result.syncWarning ? `${message} Atenção: o Asaas recusou o novo valor — ${result.syncWarning}` : message);
    detail.reload();
  }

  const onboarding = organization.onboardingStatus && organization.onboardingStatus !== 'done' ? organization.onboardingStatus : null;

  function releaseAction() {
    setEditor({
      title: 'Liberar plataforma',
      description:
        onboarding === 'awaiting_payment'
          ? 'A implantação ainda não foi paga. Liberar abre o sistema para a empresa agora e já cria a assinatura no Asaas, com a primeira cobrança no mês seguinte, no dia escolhido.'
          : 'A empresa sai da tela "em preparação" e passa a usar o sistema normalmente.',
      fields: [],
      initial: {},
      submit: 'Liberar',
      save: () => act(() => api(`/organizations/${id}/onboarding`, { body: { action: 'release' } }), 'Plataforma liberada para a empresa.'),
    });
  }

  function statusAction(action: 'suspend' | 'reactivate' | 'cancel') {
    const titles = { suspend: 'Suspender organização', reactivate: 'Reativar organização', cancel: 'Cancelar assinatura' };
    setEditor({
      title: titles[action],
      description:
        action === 'reactivate'
          ? 'A organização volta a poder editar normalmente.'
          : action === 'cancel'
            ? 'Encerra a assinatura no Asaas. Nada é apagado: a empresa fica somente leitura pelo prazo de consulta (Configurações) e depois só consegue baixar os dados.'
            : 'Nada é apagado: a empresa fica somente leitura pelo prazo de consulta (Configurações) e depois só consegue baixar os dados, até ser reativada.',
      fields: [],
      initial: {},
      reason: action !== 'reactivate',
      submit: titles[action].split(' ')[0],
      save: (_, reason) => act(() => api(`/organizations/${id}/status`, { body: { action, reason } }), 'Estado da organização atualizado.'),
    });
  }

  const editCompany = () =>
    setEditor({
      title: 'Editar empresa',
      fields: companyFields,
      initial: {
        name: organization.name,
        legalName: organization.legalName ?? '',
        document: organization.document ?? '',
        email: organization.email ?? '',
        phone: organization.phone ?? '',
        city: organization.city ?? '',
        state: organization.state ?? '',
      },
      save: (values) =>
        act(
          () =>
            api(`/organizations/${id}`, {
              method: 'PATCH',
              body: Object.fromEntries(companyFields.map((field) => [field.key, text(values[field.key])])),
            }),
          'Dados da empresa salvos.',
        ),
    });

  const tabs = ['Resumo', 'Assinatura', 'Limites e recursos', 'Custos', 'Créditos de IA', 'Usuários', 'Configurações', 'Integrações', 'Dados', 'Auditoria', 'Reports', 'Anotações'];
  const storageMb = Math.round((Number(usage.storageBytes) / (1024 * 1024)) * 10) / 10;

  return (
    <>
      <div className="nr-sticky">
        <Title
          title={organization.name}
          description={`${host(organization.slug)} · ${subscription ? `${subscription.plan.name} / ${CYCLE_LABELS[subscription.cycle]}` : 'Sem plano'}`}
          action={
            <div className="nr-actions">
              <Badge>{statusLabel(organization.status)}</Badge>
              <button className="nr-btn" disabled={organization.status === 'provisioning'} onClick={() => setEnter(true)}>
                Entrar na conta
              </button>
              {organization.status !== 'provisioning' && (
                <button className="nr-btn" onClick={() => statusAction(readOnly ? 'reactivate' : 'suspend')}>
                  {readOnly ? 'Reativar' : 'Suspender'}
                </button>
              )}
            </div>
          }
        />
        {organization.status === 'provisioning' && (
          <Link className="nr-btn mb-4" href={`/plataforma/organizacoes/${id}/provisionamento`}>
            Acompanhar provisionamento
          </Link>
        )}
        {organization.statusReason && readOnly && <div className="nr-alert mb-4">Motivo: {organization.statusReason}</div>}
        {onboarding && (
          <div className="nr-alert mb-4">
            <strong>{ONBOARDING_LABELS[onboarding]}.</strong>{' '}
            {onboarding === 'awaiting_payment'
              ? 'Contratou pelo site e ainda não pagou a implantação. Enquanto isso, a empresa só vê a tela de boas-vindas com o link de pagamento.'
              : 'Implantação paga. A empresa vê a tela "em preparação" até você liberar — entre na conta para configurar e combine o início com ela.'}{' '}
            <button className="nr-btn" onClick={releaseAction}>
              Liberar plataforma
            </button>
          </div>
        )}
        <div className="nr-tabs" role="tablist">
          {tabs.map((name) => (
            <button role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      {access && access.level !== 'full' && (
        <div className="nr-alert">
          {access.level === 'read_only'
            ? `Somente leitura até ${date(access.readOnlyUntil)}: a empresa vê e exporta tudo, mas não altera nada. Depois dessa data, só poderá baixar os dados.`
            : `Acesso encerrado desde ${date(access.readOnlyUntil)}: a empresa só consegue baixar os dados.`}{' '}
          Nada foi apagado — reativar devolve o acesso completo na hora.
        </div>
      )}

      {tab === 'Resumo' && (
        <>
          <div className="nr-metrics">
            <Metric label="Técnicos ativos" value={subscription ? `${usage.activeTechnicians} / ${subscription.includedTechnicians}` : usage.activeTechnicians} detail={subscription?.extraTechnicians ? `${subscription.extraTechnicians} extra(s) cobrado(s)` : 'incluídos no plano'} />
            <Metric label="Valor do ciclo" value={subscription ? money(subscription.value) : '—'} detail={subscription ? CYCLE_LABELS[subscription.cycle] : 'sem plano'} />
            <Metric label="Usuários ativos" value={usage.activeUsers} />
            <Metric label="Armazenamento" value={`${storageMb} MB`} detail={plan?.limits.storageMb ? `Limite: ${plan.limits.storageMb} MB` : undefined} />
          </div>
          <Panel title="Dados da empresa" action={<button className="nr-btn" onClick={editCompany}>Editar empresa</button>}>
            <div className="nr-pad nr-info-grid">
              {[
                ['Razão social', organization.legalName ?? '—'],
                ['CNPJ', organization.document ?? '—'],
                ['E-mail', organization.email ?? '—'],
                ['WhatsApp', organization.phone ?? '—'],
                ['Cidade / UF', [organization.city, organization.state].filter(Boolean).join(' / ') || '—'],
                ['Endereço', host(organization.slug)],
                ['Criada em', date(organization.createdAt)],
                ['Ativada em', date(organization.activatedAt)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {tab === 'Assinatura' && (
        <SubscriptionTab
          organizationId={id}
          subscription={subscription}
          plans={plans.data?.plans ?? []}
          onEditor={setEditor}
          onSave={saveSubscription}
          onCancel={() => statusAction('cancel')}
          canCancel={organization.status !== 'canceled' && organization.status !== 'provisioning'}
          onChanged={detail.reload}
        />
      )}

      {tab === 'Limites e recursos' && (
        <>
          {subscription && plan && <OrganizationStoragePanel organizationId={id} planMb={plan.limits.storageMb} onChanged={detail.reload} />}
          {subscription && plan ? (
            <Panel
              title="Outros limites"
              description="Deixe o valor personalizado vazio para usar o limite do plano. Técnicos além dos incluídos são cobrados como extras, não bloqueados. Mensagens de WhatsApp são ilimitadas em todos os planos: cada empresa envia pelo próprio número."
            >
              <DataTable
                rows={(['maxUsers', 'portoRunsMonth'] as Array<keyof PlanLimits>).map((key) => ({
                  id: key,
                  name: LIMIT_LABELS[key],
                  planValue: unlimited(plan.limits[key]),
                  override: key in subscription.limitOverrides ? unlimited(subscription.limitOverrides[key]) : '—',
                  usage: {
                    maxUsers: usage.activeUsers,
                    storageMb,
                    whatsappMessagesMonth: usage.whatsappSentThisMonth,
                    portoRunsMonth: usage.portoRunsThisMonth,
                  }[key],
                })).concat({
                  id: 'whatsappMessagesMonth',
                  name: 'WhatsApp / mês',
                  planValue: 'Ilimitado',
                  override: '—',
                  usage: usage.whatsappSentThisMonth,
                })}
                columns={[
                  { key: 'name', label: 'Limite' },
                  { key: 'planValue', label: 'Plano' },
                  { key: 'override', label: 'Personalizado' },
                  { key: 'usage', label: 'Uso atual' },
                ]}
                actions={(row) => row.id === 'whatsappMessagesMonth' ? <span className="text-[#7a897e]">Sempre ilimitado</span> : (
                  <button
                    onClick={() =>
                      setEditor({
                        title: `Editar limite · ${row.name}`,
                        description: 'Vazio = usa o limite do plano. "ilimitado" = sem limite para esta organização.',
                        fields: [{ key: 'value', label: 'Valor personalizado' }],
                        initial: { value: row.id in subscription.limitOverrides ? (subscription.limitOverrides[row.id as keyof PlanLimits] ?? 'ilimitado') : '' },
                        validate: (values) => {
                          const raw = text(values.value).toLowerCase();
                          return !raw || raw === 'ilimitado' || (Number.isInteger(Number(raw)) && Number(raw) >= 0) ? '' : 'Use um número inteiro, "ilimitado" ou deixe vazio.';
                        },
                        save: async (values) => {
                          const raw = text(values.value).toLowerCase();
                          const overrides: Partial<PlanLimits> = { ...subscription.limitOverrides };
                          const key = row.id as keyof PlanLimits;
                          if (!raw) delete overrides[key];
                          else overrides[key] = raw === 'ilimitado' ? null : Number(raw);
                          await saveSubscription({ limitOverrides: overrides }, 'Limite atualizado.');
                        },
                      })
                    }
                  >
                    Editar
                  </button>
                )}
              />
            </Panel>
          ) : (
            <Empty title="Sem plano" text="Escolha um plano na aba Assinatura para definir limites e recursos." />
          )}
          {plan && (
            <Panel title="Recursos do plano">
              <div className="nr-pad flex flex-wrap gap-2">
                {plan.features.map((feature) => (
                  <Badge key={feature}>{featureName(feature)}</Badge>
                ))}
              </div>
            </Panel>
          )}
          <CustomFeaturesPanel organizationId={id} />
        </>
      )}

      {tab === 'Custos' && <OrganizationCostsTab organizationId={id} />}

      {tab === 'Créditos de IA' && <CreditsTab organizationId={id} />}

      {tab === 'Usuários' && <UsersTab organizationId={id} onEditor={setEditor} onSecret={setSecret} />}

      {tab === 'Configurações' && (
        <Panel
          title="Regras da organização"
          description="As mesmas regras que o administrador vê em Configurações, no sistema da empresa."
          action={
            <button
              className="nr-btn"
              onClick={() =>
                setEditor({
                  title: 'Configurações da organização',
                  fields: [
                    { key: 'commissionPercentage', label: 'Comissão (%)', type: 'number' },
                    { key: 'baseSalary', label: 'Salário base (R$)', type: 'number' },
                    { key: 'vaAllowance', label: 'Vale-alimentação (R$)', type: 'number' },
                    { key: 'vrAllowance', label: 'Vale-refeição (R$)', type: 'number' },
                    { key: 'monthlyHours', label: 'Jornada mensal (h)', type: 'number' },
                    { key: 'overtimePercent', label: 'Adicional de hora extra (%)', type: 'number' },
                    { key: 'dailyBreakMinutes', label: 'Intervalo diário (min)', type: 'number' },
                    { key: 'tiers', label: 'Prêmio por produção', hint: 'Formato "OS:valor", separados por ";". Ex.: 80:250; 160:600. Vazio = sem prêmio.' },
                  ],
                  initial: {
                    commissionPercentage: settings.commissionPercentage,
                    baseSalary: settings.baseSalary,
                    vaAllowance: settings.vaAllowance,
                    vrAllowance: settings.vrAllowance,
                    monthlyHours: settings.monthlyHours,
                    overtimePercent: Math.round((settings.overtimeMultiplier - 1) * 10000) / 100,
                    dailyBreakMinutes: settings.dailyBreakMinutes,
                    tiers: tiersToText(settings.serviceAwardTiers),
                  },
                  save: (values) =>
                    act(
                      () =>
                        api(`/organizations/${id}/settings`, {
                          method: 'PUT',
                          body: {
                            commissionPercentage: Number(values.commissionPercentage),
                            baseSalary: Number(values.baseSalary),
                            vaAllowance: Number(values.vaAllowance),
                            vrAllowance: Number(values.vrAllowance),
                            monthlyHours: Number(values.monthlyHours),
                            overtimeMultiplier: 1 + Number(values.overtimePercent) / 100,
                            dailyBreakMinutes: Number(values.dailyBreakMinutes),
                            serviceAwardTiers: textToTiers(String(values.tiers ?? '')),
                          },
                        }),
                      'Configurações salvas.',
                    ),
                })
              }
            >
              Editar regras
            </button>
          }
        >
          <div className="nr-pad nr-info-grid">
            {[
              ['Comissão padrão', `${settings.commissionPercentage}%`],
              ['Salário base padrão', money(settings.baseSalary)],
              ['Vale-alimentação', money(settings.vaAllowance)],
              ['Vale-refeição', money(settings.vrAllowance)],
              ['Jornada mensal', `${settings.monthlyHours} horas`],
              ['Hora extra', `+${Math.round((settings.overtimeMultiplier - 1) * 100)}%`],
              ['Intervalo diário', `${settings.dailyBreakMinutes} min`],
              ['Prêmio por produção', settings.serviceAwardTiers.length ? settings.serviceAwardTiers.map((tier) => `${tier.minServices} OS: ${money(tier.amount)}`).join(' · ') : 'Sem prêmio'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'Integrações' && (
        <div className="nr-grid-3">
          <Panel title="Porto Seguro">
            <div className="nr-pad">
              <Badge>{integrations.porto.configured ? 'Configurada' : 'Não configurada'}</Badge>
              <p className="my-4 text-xs">
                Automação: {integrations.porto.automationEnabled ? (integrations.porto.dryRunOnly ? 'ligada (modo teste)' : 'ligada') : 'desligada'}
                <br />
                Última importação de horas: {date(integrations.porto.lastHoursImportAt, true)} {integrations.porto.lastHoursImportStatus ? `(${integrations.porto.lastHoursImportStatus})` : ''}
                <br />
                Última checagem de escala: {date(integrations.porto.lastScheduleCheckAt, true)}
                <br />
                Execuções no mês: {usage.portoRunsThisMonth}
              </p>
              {integrations.porto.lastError && <p className="nr-error text-xs">{integrations.porto.lastError}</p>}
            </div>
          </Panel>
          <Panel title="WhatsApp">
            <div className="nr-pad">
              <Badge>{integrations.whatsapp.state === 'connected' ? 'Conectado' : integrations.whatsapp.instance ? 'Desconectado' : 'Não conectado'}</Badge>
              <p className="my-4 text-xs">
                Instância: {integrations.whatsapp.instance ?? 'ainda não criada'}
                <br />
                Número: {integrations.whatsapp.number ? `+${integrations.whatsapp.number}` : '—'}
                <br />
                Automação: {integrations.whatsapp.enabled ? 'ligada' : 'desligada'}
                <br />
                {usage.whatsappSentThisMonth} mensagens enviadas no mês
                {integrations.whatsapp.checkedAt ? (
                  <>
                    <br />
                    Última verificação: {date(integrations.whatsapp.checkedAt, true)}
                  </>
                ) : null}
              </p>
            </div>
          </Panel>
          <Panel title="Armazenamento">
            <div className="nr-pad">
              <strong className="text-3xl">{storageMb} MB</strong>
              <p>{plan?.limits.storageMb ? `de ${plan.limits.storageMb} MB` : 'sem limite definido'}</p>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'Dados' && <DataTab organizationId={id} />}

      {tab === 'Auditoria' && (
        <Panel title="Auditoria da organização">
          <AuditTable organizationId={id} />
        </Panel>
      )}

      {tab === 'Reports' && <OrganizationBugsTab organizationId={id} />}

      {tab === 'Anotações' && <NotesTab organizationId={id} />}

      {editor && <Editor {...editor} onSave={editor.save} onClose={() => setEditor(null)} />}
      {enter && <EnterOrganization organization={organization} onClose={() => setEnter(false)} />}
      {secret && <SecretNotice {...secret} onClose={() => setSecret(null)} />}
    </>
  );
}

function SubscriptionTab({
  organizationId,
  subscription,
  plans,
  onEditor,
  onSave,
  onCancel,
  canCancel,
  onChanged,
}: {
  organizationId: string;
  subscription: Subscription | null;
  plans: PlanWithUsage[];
  onEditor: (form: ActionForm) => void;
  onSave: (changes: Record<string, unknown>, message: string) => Promise<void>;
  onCancel: () => void;
  canCancel: boolean;
  onChanged: () => void;
}) {
  const notify = useNotify();
  const billing = useResource<{ charges: Charge[] }>(`/organizations/${organizationId}/billing`);
  const activePlans = plans.filter((plan) => !plan.archived);
  const billingActive = Boolean(subscription?.asaas.subscriptionId);

  async function billingAction(body: Record<string, unknown>, message: string) {
    await api(`/organizations/${organizationId}/billing`, { body });
    notify(message);
    billing.reload();
    onChanged();
  }

  const choosePlan = () =>
    onEditor({
      title: subscription ? 'Trocar plano / ciclo' : 'Escolher plano',
      description: subscription
        ? 'O novo preço vale a partir de agora; se a cobrança estiver ativa, o Asaas é atualizado. A implantação não é cobrada de novo.'
        : 'Define o plano desta organização. A cobrança é ativada separadamente.',
      fields: [
        { key: 'planId', label: 'Plano', type: 'select', required: true, options: activePlans.map((plan) => ({ value: plan.id, label: plan.name })) },
        { key: 'cycle', label: 'Ciclo', type: 'select', required: true, options: [{ value: 'monthly', label: 'Mensal' }, { value: 'annual', label: 'Anual' }] },
        ...(!subscription ? [{ key: 'chargeSetupFee', label: 'Cobrar implantação', type: 'checkbox' as const }] : []),
      ],
      initial: { planId: subscription?.plan.id ?? activePlans[0]?.id ?? '', cycle: subscription?.cycle ?? 'monthly', chargeSetupFee: true },
      save: async (values) => {
        await api(`/organizations/${organizationId}/subscription`, {
          method: 'PUT',
          body: { planId: values.planId, cycle: values.cycle, ...(!subscription ? { chargeSetupFee: Boolean(values.chargeSetupFee) } : {}) },
        });
        notify('Assinatura salva.');
        onChanged();
      },
    });

  if (!subscription) {
    return (
      <Panel title="Assinatura" action={<button className="nr-btn primary" onClick={choosePlan}>Escolher plano</button>}>
        <Empty title="Esta organização ainda não tem plano" text="Sem plano, nada é cobrado e nenhum recurso é restringido." />
      </Panel>
    );
  }

  return (
    <>
      <div className="nr-alert">Suspender ou cancelar não apaga dados: a empresa fica somente leitura pelo prazo definido nas Configurações (90 dias por padrão) e, depois disso, só consegue baixar os dados. Reativar devolve o acesso completo.</div>
      <Panel title="Assinatura e cobrança">
        <div className="nr-pad">
          <div className="nr-info-grid">
            {[
              ['Plano', subscription.plan.name],
              ['Ciclo', CYCLE_LABELS[subscription.cycle]],
              ['Valor do plano', money(subscription.basePrice)],
              ['Técnicos extras', subscription.extraTechnicians ? `${subscription.extraTechnicians} × ${money(subscription.extraTechnicianPrice)}/mês` : 'Nenhum'],
              ['Desconto', [subscription.discountPercent ? `${subscription.discountPercent}%` : '', subscription.discountAmount ? money(subscription.discountAmount) : ''].filter(Boolean).join(' + ') || 'Nenhum'],
              ['Valor do ciclo', money(subscription.value)],
              ['Implantação', `${subscription.setupFee ? `${money(subscription.setupFee)} · ` : ''}${SETUP_LABELS[subscription.setupFeeStatus]}`],
              ['Próximo vencimento', date(subscription.nextDueDate)],
              ['Carência', `${subscription.graceDays} dias`],
              ['Cobrança no Asaas', billingActive ? 'Ativa' : 'Não ativada'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </div>
          <div className="nr-actions mt-6">
            {!billingActive && (
              <button
                className="nr-btn primary"
                onClick={() =>
                  onEditor({
                    title: 'Ativar cobrança no Asaas',
                    description: 'Cria o cliente, a cobrança da implantação (se pendente) e a assinatura recorrente. O cliente paga pelo link (Pix, boleto ou cartão). Exige o CNPJ da empresa.',
                    fields: [{ key: 'firstDueDate', label: 'Primeiro vencimento', type: 'date', required: true }],
                    initial: { firstDueDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) },
                    submit: 'Ativar cobrança',
                    save: (values) => billingAction({ action: 'activate', firstDueDate: values.firstDueDate }, 'Cobrança ativada no Asaas.'),
                  })
                }
              >
                Ativar cobrança
              </button>
            )}
            <button className="nr-btn" onClick={choosePlan}>
              Trocar plano / ciclo
            </button>
            <button
              className="nr-btn"
              onClick={() =>
                onEditor({
                  title: 'Desconto',
                  description: 'Vale para os próximos ciclos. 0 remove o desconto.',
                  fields: [
                    { key: 'discountPercent', label: 'Desconto (%)', type: 'number' },
                    { key: 'discountAmount', label: 'Desconto (R$)', type: 'number' },
                  ],
                  initial: { discountPercent: subscription.discountPercent, discountAmount: subscription.discountAmount },
                  save: (values) => onSave({ discountPercent: Number(values.discountPercent || 0), discountAmount: Number(values.discountAmount || 0) }, 'Desconto atualizado.'),
                })
              }
            >
              Desconto
            </button>
            <button
              className="nr-btn"
              onClick={() =>
                onEditor({
                  title: 'Carência',
                  description: 'Dias que a organização continua com acesso normal após uma cobrança vencer, antes de ficar somente leitura.',
                  fields: [{ key: 'graceDays', label: 'Dias de carência', type: 'number', required: true }],
                  initial: { graceDays: subscription.graceDays },
                  save: (values) => onSave({ graceDays: Number(values.graceDays) }, 'Carência atualizada.'),
                })
              }
            >
              Carência
            </button>
            {billingActive && (
              <button className="nr-btn" onClick={() => void billingAction({ action: 'sync' }, 'Cobranças sincronizadas com o Asaas.').catch((reason) => notify(errorMessage(reason)))}>
                Sincronizar com o Asaas
              </button>
            )}
            {canCancel && (
              <button className="nr-btn danger" onClick={onCancel}>
                Cancelar assinatura
              </button>
            )}
          </div>
        </div>
      </Panel>
      <CouponPanel organizationId={organizationId} onChanged={onChanged} />
      <Panel title="Cobranças" description="Espelho das cobranças do Asaas, atualizado pelos avisos de pagamento.">
        {billing.loading && !billing.data ? (
          <Loading />
        ) : billing.error ? (
          <ErrorState message={billing.error} onRetry={billing.reload} />
        ) : (
          <DataTable
            rows={(billing.data?.charges ?? []).map((charge) => ({ ...charge, kindText: CHARGE_KIND_LABELS[charge.kind] ?? charge.kind, statusText: chargeStatusLabel(charge.status) }))}
            defaultSort="dueDate"
            defaultDescending
            filters={[
              { key: 'statusText', label: 'Estado', options: ['Paga', 'Pendente', 'Vencida', 'Cancelada', 'Estornada'] },
              { key: 'kindText', label: 'Tipo', options: ['Mensalidade', 'Implantação', 'Avulsa', 'Créditos de IA'] },
            ]}
            columns={[
              { key: 'dueDate', label: 'Vencimento', render: (row) => date(row.dueDate) },
              { key: 'kindText', label: 'Tipo' },
              { key: 'value', label: 'Valor', render: (row) => money(row.value) },
              { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
            ]}
            actions={(row) =>
              row.invoiceUrl ? (
                <a href={row.invoiceUrl} target="_blank" rel="noopener noreferrer">
                  Abrir fatura
                </a>
              ) : null
            }
            emptyText="Nenhuma cobrança ainda. Elas aparecem depois de ativar a cobrança."
          />
        )}
      </Panel>
    </>
  );
}

function UsersTab({
  organizationId,
  onEditor,
  onSecret,
}: {
  organizationId: string;
  onEditor: (form: ActionForm) => void;
  onSecret: (secret: { title: string; description: string; secret: string }) => void;
}) {
  const notify = useNotify();
  const users = useResource<{ users: OrganizationUser[] }>(`/organizations/${organizationId}/users`);

  async function patch(userId: string, body: Record<string, unknown>, message: string) {
    const result = await api<{ temporaryPassword: string | null }>(`/organizations/${organizationId}/users/${userId}`, { method: 'PATCH', body });
    notify(message);
    users.reload();
    return result;
  }

  return (
    <Panel
      title="Usuários da organização"
      action={
        <button
          className="nr-btn primary"
          onClick={() =>
            onEditor({
              title: 'Criar administrador',
              fields: [
                { key: 'name', label: 'Nome', required: true },
                { key: 'email', label: 'E-mail', type: 'email', required: true },
              ],
              initial: {},
              save: async (values) => {
                const result = await api<{ temporaryPassword: string }>(`/organizations/${organizationId}/users`, {
                  body: { name: text(values.name), email: text(values.email) },
                });
                users.reload();
                onSecret({ title: 'Administrador criado', description: `Senha temporária de ${text(values.email)}.`, secret: result.temporaryPassword });
              },
            })
          }
        >
          Criar admin
        </button>
      }
    >
      {users.loading && !users.data ? (
        <Loading />
      ) : users.error ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : (
        <DataTable
          rows={(users.data?.users ?? []).map((user) => ({ ...user, roleText: ROLE_LABELS[user.role] ?? user.role, statusText: user.status === 'active' ? 'Ativo' : 'Inativo' }))}
          filters={[
            { key: 'statusText', label: 'Estado', options: ['Ativo', 'Inativo'] },
            { key: 'roleText', label: 'Papel', options: ['Administrador', 'Técnico'] },
          ]}
          columns={[
            { key: 'name', label: 'Nome' },
            { key: 'email', label: 'E-mail' },
            { key: 'roleText', label: 'Papel' },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
            { key: 'lastLoginAt', label: 'Último acesso', render: (row) => date(row.lastLoginAt, true) },
          ]}
          actions={(row) => (
            <>
              <button
                onClick={() =>
                  onEditor({
                    title: 'Alterar papel',
                    description: 'Para virar técnico, o usuário precisa ter um cadastro de técnico.',
                    fields: [{ key: 'role', label: 'Papel', type: 'select', required: true, options: options(['Administrador', 'Técnico']) }],
                    initial: { role: row.roleText },
                    save: async (values) => {
                      await patch(row.id, { role: values.role === 'Administrador' ? 'admin' : 'technician' }, 'Papel alterado.');
                    },
                  })
                }
              >
                Papel
              </button>
              <button
                onClick={() =>
                  onEditor({
                    title: 'Redefinir senha',
                    description: `Gera uma nova senha temporária para ${row.email}. A senha atual deixa de funcionar.`,
                    fields: [],
                    initial: {},
                    submit: 'Redefinir',
                    save: async () => {
                      const result = await patch(row.id, { resetPassword: true }, 'Senha redefinida.');
                      if (result.temporaryPassword) onSecret({ title: 'Senha redefinida', description: `Nova senha temporária de ${row.email}.`, secret: result.temporaryPassword });
                    },
                  })
                }
              >
                Redefinir senha
              </button>
              <button onClick={() => void patch(row.id, { status: row.status === 'active' ? 'inactive' : 'active' }, row.status === 'active' ? 'Usuário desativado.' : 'Usuário reativado.').catch((reason) => notify(errorMessage(reason)))}>
                {row.status === 'active' ? 'Desativar' : 'Reativar'}
              </button>
            </>
          )}
          emptyText="Nenhum usuário nesta organização."
        />
      )}
    </Panel>
  );
}

function NotesTab({ organizationId }: { organizationId: string }) {
  const notify = useNotify();
  const notes = useResource<{ notes: Note[] }>(`/organizations/${organizationId}/notes`);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Panel title="Anotações internas" description="Somente o dono da plataforma vê estas notas.">
      <div className="nr-pad">
        {notes.loading && !notes.data ? (
          <Loading />
        ) : notes.error ? (
          <ErrorState message={notes.error} onRetry={notes.reload} />
        ) : notes.data?.notes.length ? (
          notes.data.notes.map((item) => (
            <div className="nr-note" key={item.id}>
              {item.text}
              <small>
                {date(item.createdAt, true)} · {item.authorName}{' '}
                <button
                  className="underline"
                  onClick={() =>
                    void api(`/organizations/${organizationId}/notes?noteId=${item.id}`, { method: 'DELETE' })
                      .then(() => {
                        notify('Anotação arquivada.');
                        notes.reload();
                      })
                      .catch((reason) => notify(errorMessage(reason)))
                  }
                >
                  Arquivar
                </button>
              </small>
            </div>
          ))
        ) : (
          <Empty title="A história deste cliente começa aqui" text="Registre acordos, próximos passos ou pontos de atenção." />
        )}
        <label className="nr-field">
          Nova anotação
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <button
          className="nr-btn primary mt-4"
          disabled={!note.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api(`/organizations/${organizationId}/notes`, { body: { text: note } });
              setNote('');
              notify('Anotação salva.');
              notes.reload();
            } catch (reason) {
              notify(errorMessage(reason));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Salvando…' : 'Salvar anotação'}
        </button>
      </div>
    </Panel>
  );
}
