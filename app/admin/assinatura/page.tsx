'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, ExternalLink, Layers, Users, WalletCards } from 'lucide-react';
import { LoadingShell } from '@/components/page-skeleton';
import { Frame, SectionPanel } from '@/components/settings/kit';
import '@/components/settings/settings.css';
import { useAppSession } from '@/hooks/use-app-session';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { AiCreditsPanel, ExportPanel } from './credits-panel';
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

const CHARGE_KIND_LABELS: Record<Charge['kind'], string> = {
  subscription: 'Mensalidade',
  setup: 'Implantação',
  one_off: 'Avulsa',
  credits: 'Créditos de IA',
};

const PAID = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

function chargeStatus(status: string) {
  if (PAID.includes(status)) return { label: 'Paga', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'OVERDUE') return { label: 'Vencida', className: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (status === 'PENDING') return { label: 'Pendente', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  if (status === 'REFUNDED') return { label: 'Estornada', className: 'bg-secondary text-muted-foreground border-border' };
  return { label: 'Cancelada', className: 'bg-secondary text-muted-foreground border-border' };
}

const SETUP_LABELS: Record<Subscription['setupFeeStatus'], string> = {
  none: 'Sem implantação',
  pending: 'Pendente',
  paid: 'Paga',
  waived: 'Dispensada',
};

export default function SubscriptionPage() {
  const { user, loading } = useAppSession();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;

    fetch('/api/organization/billing', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar a assinatura.');
        if (!active) return;
        setSubscription(data.subscription);
        setCharges(Array.isArray(data.charges) ? data.charges : []);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar a assinatura.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (loading || !user || isLoading) {
    return <LoadingShell role="admin" />;
  }

  const cycleLabel = subscription?.cycle === 'annual' ? 'ano' : 'mês';
  const discount = subscription
    ? [subscription.discountPercent ? `${subscription.discountPercent}%` : null, subscription.discountAmount ? formatCurrency(subscription.discountAmount) : null].filter(Boolean).join(' + ')
    : '';
  const metrics = subscription
    ? [
        { title: 'Plano', value: subscription.plan.name, hint: subscription.cycle === 'annual' ? 'Cobrança anual' : 'Cobrança mensal', icon: Layers },
        { title: `Valor por ${cycleLabel}`, value: formatCurrency(subscription.value), hint: discount ? `Com desconto de ${discount}` : 'Sem desconto', icon: WalletCards },
        { title: 'Próximo vencimento', value: subscription.nextDueDate ? formatDate(subscription.nextDueDate) : '—', hint: `Implantação: ${SETUP_LABELS[subscription.setupFeeStatus].toLowerCase()}`, icon: CalendarClock },
        { title: 'Técnicos ativos', value: String(subscription.activeTechnicians), hint: `${subscription.includedTechnicians} incluídos${subscription.extraTechnicians ? ` · ${subscription.extraTechnicians} extras` : ''}`, icon: Users },
      ]
    : [];

  return (
    <Frame userName={user.name || user.email} title="Assinatura" description="Plano, cobranças, créditos de IA e seus dados.">
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

          <div className="mg-grid-finance st-billing">
            <SectionPanel title="Cobranças" description="Pague pelo link de cada cobrança (Pix, boleto ou cartão).">
              {charges.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Vencimento</th>
                        <th className="py-2 pr-3 font-medium">Tipo</th>
                        <th className="py-2 pr-3 font-medium">Valor</th>
                        <th className="py-2 pr-3 font-medium">Situação</th>
                        <th className="py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody>
                      {charges.map((charge) => {
                        const status = chargeStatus(charge.status);
                        const payable = !PAID.includes(charge.status) && charge.invoiceUrl && ['PENDING', 'OVERDUE'].includes(charge.status);
                        return (
                          <tr key={charge.id} className="border-b border-border last:border-0">
                            <td className="py-2.5 pr-3">{formatDate(charge.dueDate)}</td>
                            <td className="py-2.5 pr-3">{CHARGE_KIND_LABELS[charge.kind] ?? charge.kind}</td>
                            <td className="py-2.5 pr-3">{formatCurrency(charge.value)}</td>
                            <td className="py-2.5 pr-3">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                            </td>
                            <td className="py-2.5 text-right">
                              {charge.invoiceUrl ? (
                                <a href={charge.invoiceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                                  {payable ? 'Pagar' : 'Ver fatura'}
                                  <ExternalLink className="h-3.5 w-3.5" />
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
                <p className="st-empty">Nenhuma cobrança gerada ainda.</p>
              )}
            </SectionPanel>

            <SectionPanel
              title="Como o valor é calculado"
              description="Novos recursos chegam sem custo extra. Se um pagamento atrasar, nada é apagado: o acesso fica em modo somente leitura até a regularização."
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

          <UpgradePanel />
          <AiCreditsPanel />
        </div>
      ) : null}

      <div className="st-stack st-after">
        <ExportPanel />
      </div>
    </Frame>
  );
}
