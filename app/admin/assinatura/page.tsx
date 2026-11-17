'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ExternalLink, FlaskConical, Layers, ReceiptText, Undo2, Users, WalletCards } from 'lucide-react';
import { LoadingShell } from '@/components/page-skeleton';
import { SegmentedControl } from '@/components/modal-kit';
import { Frame, SectionPanel } from '@/components/settings/kit';
import '@/components/settings/settings.css';
import './billing.css';
import { useAppSession } from '@/hooks/use-app-session';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { AiCreditsPanel, ExportPanel } from './credits-panel';
import { CancelPanel } from './cancel-panel';
import { UpgradePanel } from './upgrade-panel';

type Subscription = {
  plan: { name: string };
  cycle: 'monthly' | 'annual';
  basePrice: number;
  extraTechnicianPrice: number;
  includedTechnicians: number;
  activeTechnicians: number;
  extraTechnicians: number;
  discountPercent: number;
  discountAmount: number;
  gross: number;
  value: number;
  setupFee: number;
  setupFeeStatus: 'none' | 'pending' | 'paid' | 'waived';
  setupInstallments: number;
  nextDueDate: string | null;
};

type Charge = {
  id: string;
  kind: 'subscription' | 'setup' | 'one_off' | 'credits';
  description: string | null;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl: string | null;
  paidAt: string | null;
};

const PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const OPEN = ['PENDING', 'OVERDUE'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const SETUP_LABELS: Record<Subscription['setupFeeStatus'], string> = {
  none: 'Sem implantação',
  pending: 'Pendente',
  paid: 'Paga',
  waived: 'Dispensada',
};

const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const dayOf = (value: string) => String(value).slice(0, 10);
const isPaid = (charge: Charge) => PAID.includes(charge.status);
const isOpen = (charge: Charge) => OPEN.includes(charge.status);

function chargeStatus(status: string) {
  if (PAID.includes(status)) return { label: 'Paga', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'OVERDUE') return { label: 'Vencida', className: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (status === 'PENDING') return { label: 'Pendente', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  if (status === 'REFUNDED') return { label: 'Estornada', className: 'bg-secondary text-muted-foreground border-border' };
  return { label: 'Cancelada', className: 'bg-secondary text-muted-foreground border-border' };
}

/** What the row is: "Mensalidade" with its month, or the setup fee with its parcel. */
function chargeLabel(charge: Charge, cycle: Subscription['cycle']) {
  const month = `${MONTHS[Number(dayOf(charge.dueDate).slice(5, 7)) - 1] ?? ''}/${dayOf(charge.dueDate).slice(0, 4)}`;
  if (charge.kind === 'setup') {
    const parcel = charge.description?.match(/parcela (\d+) de (\d+)/);
    return { title: 'Implantação', detail: parcel ? `Parcela ${parcel[1]} de ${parcel[2]}` : null };
  }
  if (charge.kind === 'subscription') return { title: cycle === 'annual' ? 'Anuidade' : 'Mensalidade', detail: month };
  if (charge.kind === 'credits') return { title: 'Créditos de IA', detail: null };
  return { title: 'Avulsa', detail: null };
}

export default function SubscriptionPage() {
  const { user, loading } = useAppSession();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [lifetime, setLifetime] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [filter, setFilter] = useState<'open' | 'paid' | 'all'>('open');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/organization/billing', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar a assinatura.');
      setSubscription(data.subscription);
      setCharges(Array.isArray(data.charges) ? data.charges : []);
      setLifetime(Boolean(data.lifetime));
      setSimulated(Boolean(data.simulated));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a assinatura.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function simulate(charge: Charge, paid: boolean) {
    setBusyId(charge.id);
    setActionError('');
    try {
      const response = await fetch('/api/organization/billing/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chargeId: charge.id, paid }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar agora.');
      await load();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Não foi possível registrar agora.');
    } finally {
      setBusyId(null);
    }
  }

  const today = todayKey();
  // Subscription, setup and one-off charges are the payment history; credit purchases live in their own panel.
  const payments = useMemo(
    () => charges.filter((charge) => charge.kind !== 'credits' && charge.status !== 'DELETED' && charge.status !== 'CANCELED').sort((a, b) => dayOf(a.dueDate).localeCompare(dayOf(b.dueDate))),
    [charges],
  );
  const overdue = payments.filter((charge) => charge.status === 'OVERDUE' || (charge.status === 'PENDING' && dayOf(charge.dueDate) < today));
  const upcoming = payments.filter((charge) => charge.status === 'PENDING' && dayOf(charge.dueDate) >= today);
  const next = overdue[0] ?? upcoming[0] ?? null;
  const setupCharges = payments.filter((charge) => charge.kind === 'setup');
  const setupPaid = setupCharges.filter(isPaid);

  useEffect(() => {
    // Nothing to pay: the useful view is the history.
    if (!isLoading && payments.length && !payments.some(isOpen)) setFilter('paid');
  }, [isLoading, payments]);

  if (loading || !user || isLoading) {
    return <LoadingShell role="admin" />;
  }

  const cycleLabel = subscription?.cycle === 'annual' ? 'ano' : 'mês';
  const discount = subscription
    ? [subscription.discountPercent ? `${subscription.discountPercent}%` : null, subscription.discountAmount ? formatCurrency(subscription.discountAmount) : null].filter(Boolean).join(' + ')
    : '';

  const shown = payments
    .filter((charge) => (filter === 'open' ? isOpen(charge) : filter === 'paid' ? isPaid(charge) : true))
    .sort((a, b) => (filter === 'paid' ? dayOf(b.dueDate).localeCompare(dayOf(a.dueDate)) : dayOf(a.dueDate).localeCompare(dayOf(b.dueDate))));

  const lateTotal = overdue.reduce((total, charge) => total + Number(charge.value), 0);
  const heroTone = overdue.length ? 'late' : next || payments.length ? 'ok' : '';
  const heroTitle = overdue.length
    ? overdue.length === 1 ? 'Há 1 cobrança vencida' : `Há ${overdue.length} cobranças vencidas`
    : next ? 'Tudo em dia' : payments.length ? 'Tudo pago' : 'Nenhuma cobrança ainda';
  const heroSub = overdue.length
    ? `${formatCurrency(lateTotal)} em atraso. Pague para o acesso não ser bloqueado.`
    : next ? `Próxima: ${chargeLabel(next, subscription?.cycle ?? 'monthly').title.toLowerCase()} de ${formatCurrency(next.value)}, vence em ${formatDate(next.dueDate)}.` : '';

  const setupMetric = !subscription
    ? null
    : subscription.setupFee > 0 && setupCharges.length
      ? { value: `${setupPaid.length} de ${setupCharges.length}`, hint: `${formatCurrency(setupPaid.reduce((total, charge) => total + Number(charge.value), 0))} pagos de ${formatCurrency(subscription.setupFee)}` }
      : { value: SETUP_LABELS[subscription.setupFeeStatus], hint: subscription.setupFee > 0 ? formatCurrency(subscription.setupFee) : 'Sem valor de implantação' };

  const metrics = subscription && lifetime
    ? [
        { title: 'Plano', value: subscription.plan.name, hint: 'Vitalício', icon: Layers },
        { title: 'Cobrança', value: 'Sem cobrança', hint: 'Seu acesso não tem mensalidade', icon: WalletCards },
        { title: 'Técnicos ativos', value: String(subscription.activeTechnicians), hint: `${subscription.includedTechnicians} incluídos`, icon: Users },
      ]
    : subscription
    ? [
        { title: 'Plano', value: subscription.plan.name, hint: subscription.cycle === 'annual' ? 'Cobrança anual' : 'Cobrança mensal', icon: Layers },
        { title: `Valor por ${cycleLabel}`, value: formatCurrency(subscription.value), hint: discount ? `Com desconto de ${discount}` : 'Sem desconto', icon: WalletCards },
        { title: 'Próximo vencimento', value: next ? formatDate(next.dueDate) : '—', hint: next ? formatCurrency(next.value) : 'Nada em aberto', icon: CalendarClock },
        { title: 'Implantação', value: setupMetric?.value ?? '—', hint: setupMetric?.hint ?? '', icon: ReceiptText },
      ]
    : [];

  return (
    <Frame userName={user.name || user.email} title="Assinatura" description="Seus pagamentos, plano, créditos de IA e dados." section={null}>
      {error ? (
        <div className="mg-error" role="alert">
          <div>
            <strong>Não foi possível carregar</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {!subscription && !error ? <p className="st-empty">Nenhum plano contratado ainda. Fale com o suporte do NextRotta.</p> : null}

      {subscription ? (
        <div className="st-stack">
          {!lifetime ? (
            <div className={`bl-hero ${heroTone}`}>
              <div className="bl-hero-text">
                <h2 className="bl-hero-title">
                  {heroTitle}
                  {simulated ? (
                    <span className="bl-test">
                      <FlaskConical size={13} /> Conta de teste · pagamentos simulados
                    </span>
                  ) : null}
                </h2>
                {heroSub ? <p className="bl-hero-sub">{heroSub}</p> : null}
                {subscription.setupFee > 0 && setupCharges.length > 1 ? (
                  <div className="bl-progress" role="img" aria-label={`Implantação: ${setupPaid.length} de ${setupCharges.length} parcelas pagas`}>
                    <span style={{ width: `${(setupPaid.length / setupCharges.length) * 100}%` }} />
                  </div>
                ) : null}
              </div>
              {next ? (
                simulated ? (
                  <button type="button" className="bl-link primary" disabled={busyId === next.id} onClick={() => void simulate(next, true)}>
                    Pagar agora (simulado)
                  </button>
                ) : next.invoiceUrl ? (
                  <a href={next.invoiceUrl} target="_blank" rel="noopener noreferrer" className="bl-link primary">
                    Pagar agora <ExternalLink size={14} />
                  </a>
                ) : null
              ) : null}
            </div>
          ) : null}

          <div className="mg-metrics">
            {metrics.map((metric) => (
              <article key={metric.title} className="mg-metric">
                <div className="mg-metric-top">
                  <span>{metric.title}</span>
                  <span className="mg-icon">
                    <metric.icon size={18} />
                  </span>
                </div>
                <strong>{metric.value}</strong>
                <div className="mg-metric-bottom">
                  <span>{metric.hint}</span>
                </div>
              </article>
            ))}
          </div>

          {!lifetime ? (
            <div className="mg-grid-finance st-billing">
              <SectionPanel
                title="Pagamentos"
                description={
                  simulated
                    ? 'Conta de teste: o pagamento é simulado e nada vai para o banco. Dá para marcar como paga e desfazer, só para testar as telas.'
                    : 'Pague pelo link de cada cobrança (Pix, boleto ou cartão). Dá para adiantar qualquer parcela: o link dela já está liberado.'
                }
              >
                <div className="bl-toolbar">
                  <SegmentedControl
                    label="Filtrar pagamentos"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: 'open', label: 'Em aberto' },
                      { value: 'paid', label: 'Pagas' },
                      { value: 'all', label: 'Todas' },
                    ]}
                  />
                </div>
                {actionError ? <p className="st-empty" role="alert">{actionError}</p> : null}
                {shown.length ? (
                  <div className="overflow-x-auto">
                    <table className="bl-table">
                      <thead>
                        <tr>
                          <th>Vencimento</th>
                          <th>Cobrança</th>
                          <th>Valor</th>
                          <th>Situação</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((charge) => {
                          const late = charge.status === 'OVERDUE' || (charge.status === 'PENDING' && dayOf(charge.dueDate) < today);
                          const status = chargeStatus(late ? 'OVERDUE' : charge.status);
                          const label = chargeLabel(charge, subscription.cycle);
                          const paid = isPaid(charge);
                          const advance = isOpen(charge) && !late && next?.id !== charge.id;
                          return (
                            <tr key={charge.id}>
                              <td>{formatDate(charge.dueDate)}</td>
                              <td className="bl-kind">
                                {label.title}
                                {label.detail ? <small>{label.detail}</small> : null}
                              </td>
                              <td>{formatCurrency(charge.value)}</td>
                              <td>
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                                {paid && charge.paidAt ? <small className="mt-1 block text-xs text-muted-foreground">em {formatDate(charge.paidAt)}</small> : null}
                              </td>
                              <td className="bl-actions">
                                {simulated ? (
                                  paid ? (
                                    <button type="button" className="bl-link quiet" disabled={busyId === charge.id} onClick={() => void simulate(charge, false)}>
                                      <Undo2 size={14} /> Desfazer
                                    </button>
                                  ) : (
                                    <button type="button" className="bl-link" disabled={busyId === charge.id} onClick={() => void simulate(charge, true)}>
                                      {advance ? 'Adiantar (simulado)' : 'Pagar (simulado)'}
                                    </button>
                                  )
                                ) : charge.invoiceUrl ? (
                                  <a href={charge.invoiceUrl} target="_blank" rel="noopener noreferrer" className={`bl-link ${paid ? 'quiet' : ''}`}>
                                    {paid ? 'Ver fatura' : advance ? 'Adiantar' : 'Pagar'}
                                    <ExternalLink size={14} />
                                  </a>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="st-empty">
                    {!payments.length ? 'Nenhuma cobrança gerada ainda.' : filter === 'open' ? 'Nada em aberto.' : 'Nenhum pagamento feito ainda.'}
                  </p>
                )}
              </SectionPanel>

              <SectionPanel
                title="Como o valor é calculado"
                description="Novos recursos chegam sem custo extra. Se um pagamento atrasar, o acesso é bloqueado depois da carência e você baixa seus dados; pagando, volta na hora. Sem regularização em 3 meses, os dados são excluídos (LGPD)."
              >
                <dl className="st-summary">
                  <div>
                    <dt>Valor do plano</dt>
                    <dd>
                      {formatCurrency(subscription.basePrice)}/{cycleLabel}
                    </dd>
                  </div>
                  <div>
                    <dt>Técnicos extras</dt>
                    <dd>{subscription.extraTechnicians ? `${subscription.extraTechnicians} × ${formatCurrency(subscription.extraTechnicianPrice)}/mês` : 'Nenhum'}</dd>
                  </div>
                  {discount ? (
                    <div>
                      <dt>Desconto</dt>
                      <dd>{discount}</dd>
                    </div>
                  ) : null}
                  {subscription.setupFee ? (
                    <div>
                      <dt>Implantação</dt>
                      <dd>
                        {formatCurrency(subscription.setupFee)} · {SETUP_LABELS[subscription.setupFeeStatus]}
                      </dd>
                    </div>
                  ) : null}
                  <div className="total">
                    <dt>Total</dt>
                    <dd>
                      {formatCurrency(subscription.value)}/{cycleLabel}
                    </dd>
                  </div>
                </dl>
              </SectionPanel>
            </div>
          ) : null}

          {!lifetime && !simulated ? <UpgradePanel /> : null}
          {!lifetime && !simulated ? <CancelPanel setupFee={subscription.setupFee} setupInstallments={subscription.setupInstallments ?? 1} charges={charges} /> : null}
          <AiCreditsPanel />
        </div>
      ) : null}

      <div className="st-stack st-after">
        <ExportPanel />
      </div>
    </Frame>
  );
}
