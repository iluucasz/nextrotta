'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowUpRight, CircleAlert, Plus } from 'lucide-react';
import {
  CHARGE_KIND_LABELS,
  chargeStatusLabel,
  date,
  money,
  ORGANIZATION_STATUS_LABELS,
  useResource,
  type OrganizationStatusKey,
} from './api';
import { Badge, DataTable, ErrorState, Loading, Metric, Panel, Title } from './ui';

type Overview = {
  period: { from: string; to: string };
  organizationsByStatus: Partial<Record<OrganizationStatusKey, number>>;
  mrr: number;
  arr: number;
  newOrganizations: number;
  canceledOrganizations: number;
  totalOrganizations: number;
  overdue: { value: number; organizations: number };
  revenueByKind: Record<string, number>;
  revenueHistory: Array<{ month: string; value: number }>;
  forecast: { days30: number; days60: number; days90: number };
  provisioningErrors: number;
  newLeads: number;
  alerts: Array<{ organizationId: string; organizationName: string; kind: string; message: string }>;
};

type PlatformCharge = {
  id: string;
  organizationId: string;
  organizationName: string;
  kind: string;
  value: number;
  dueDate: string;
  status: string;
  invoiceUrl: string | null;
  daysLate: number;
};

const MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function brasiliaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function monthBounds(offset: number) {
  const [year, month] = brasiliaToday().split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Period selector shared by the overview and finance screens; dates are real (Brasília). */
export function usePeriod() {
  const [period, setPeriod] = useState('Este mês');
  const thisMonth = monthBounds(0);
  const [from, setFrom] = useState(thisMonth.from);
  const [to, setTo] = useState(thisMonth.to);

  const range = useMemo(() => {
    if (period === 'Mês anterior') return monthBounds(-1);
    if (period === 'Últimos 12 meses') return { from: monthBounds(-11).from, to: thisMonth.to };
    if (period === 'Personalizado') return { from, to };
    return thisMonth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, from, to]);

  const control = (
    <div className="nr-period">
      <select aria-label="Período" value={period} onChange={(event) => setPeriod(event.target.value)}>
        {['Este mês', 'Mês anterior', 'Últimos 12 meses', 'Personalizado'].map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      {period === 'Personalizado' && (
        <>
          <label>
            De <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            Até <input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </>
      )}
      <small className="text-muted-foreground">
        {date(range.from)} a {date(range.to)}
      </small>
    </div>
  );

  return { ...range, query: `?start=${range.from}&end=${range.to}`, control };
}

function ReceivedChart({ history }: { history: Overview['revenueHistory'] }) {
  const data = history.map((row) => ({ ...row, label: `${MONTH_NAMES[Number(row.month.slice(5, 7)) - 1]}/${row.month.slice(2, 4)}` }));
  return (
    <div className="nr-chart" role="img" aria-label="Receita recebida nos últimos 12 meses">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 4, right: 20, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id="received-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#63ad8d" stopOpacity={0.23} />
              <stop offset="100%" stopColor="#63ad8d" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#edf1ed" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#89968c' }} />
          <YAxis tickFormatter={(value) => money(Number(value)).replace(',00', '')} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#89968c' }} width={80} />
          <Tooltip formatter={(value) => money(Number(value))} contentStyle={{ borderRadius: 10, border: '1px solid #e5ebe7', fontSize: 12 }} />
          <Area dataKey="value" name="Recebido" stroke="#368b69" strokeWidth={2.5} fill="url(#received-fill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const REVENUE_KINDS = ['subscription', 'setup', 'one_off', 'credits'];

/** AI credits in the selected period: sold, consumed and what the provider charged. */
function CreditsSummary({ query }: { query: string }) {
  const credits = useResource<{ consumedCredits: number; providerCost: number; revenue: number }>(`/ai-credits${query}`);
  if (credits.error) return <ErrorState message={credits.error} onRetry={credits.reload} />;
  if (!credits.data) return <Loading />;
  const { consumedCredits, providerCost, revenue } = credits.data;
  return (
    <div className="nr-pad">
      {[
        ['Receita de créditos', money(revenue)],
        ['Créditos consumidos', consumedCredits.toLocaleString('pt-BR')],
        ['Custo real da IA', money(providerCost)],
        ['Margem', revenue ? `${(((revenue - providerCost) / revenue) * 100).toFixed(1).replace('.', ',')}%` : '—'],
      ].map(([label, value]) => (
        <div className="nr-detail-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const period = usePeriod();
  const overview = useResource<Overview>(`/overview${period.query}`);
  const recent = useResource<{ organizations: Array<{ id: string; name: string; slug: string; status: OrganizationStatusKey; createdAt: string; subscription: { planName: string; value: number } | null }> }>('/organizations');

  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  const data = overview.data!;
  const statuses: OrganizationStatusKey[] = ['active', 'past_due', 'provisioning', 'suspended', 'canceled'];
  const totalByStatus = statuses.reduce((sum, status) => sum + (data.organizationsByStatus[status] ?? 0), 0);

  return (
    <>
      <Title
        title="Uma visão de toda a sua operação."
        description="Acompanhe o crescimento, cuide dos clientes e mantenha tudo em dia."
        action={
          <Link href="/plataforma/organizacoes/nova" className="nr-btn primary">
            <Plus size={16} />
            Nova organização
          </Link>
        }
      />
      {period.control}
      <div className="nr-metrics">
        <Metric label="Receita recorrente mensal" value={money(data.mrr)} detail={`ARR ${money(data.arr)} · assinaturas atuais`} accent />
        <Metric label="Organizações ativas" value={data.organizationsByStatus.active ?? 0} detail={`${data.newOrganizations} novas no período`} />
        <Metric label="Valor em atraso" value={money(data.overdue.value)} detail={`${data.overdue.organizations} organização(ões) precisam de atenção`} />
        <Metric
          label="Cancelamentos no período"
          value={data.canceledOrganizations}
          detail={`Taxa de cancelamento: ${((data.canceledOrganizations / Math.max(1, data.totalOrganizations)) * 100).toFixed(1).replace('.', ',')}%`}
        />
      </div>
      <div className="nr-grid-2">
        <Panel title="Receita recebida" description="Cobranças pagas · últimos 12 meses">
          <ReceivedChart history={data.revenueHistory} />
        </Panel>
        <Panel title="Organizações por estado" description="Uma plataforma, diferentes momentos">
          <div className="nr-pad">
            {statuses.map((status, index) => {
              const count = data.organizationsByStatus[status] ?? 0;
              return (
                <div key={status} className="nr-detail-row">
                  <div className="w-full">
                    <div className="flex justify-between">
                      <Badge>{ORGANIZATION_STATUS_LABELS[status]}</Badge>
                      <strong>{count}</strong>
                    </div>
                    <div className="nr-progress">
                      <span style={{ width: `${(count / Math.max(1, totalByStatus)) * 100}%`, background: ['#4b9b76', '#dbb56b', '#9aa9d0', '#d9957f', '#adb7b1'][index] }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
      <div className="nr-grid-3">
        <Panel title="Receita do período">
          <div className="nr-pad">
            {REVENUE_KINDS.map((kind) => (
              <div className="nr-detail-row" key={kind}>
                <span>{CHARGE_KIND_LABELS[kind]}</span>
                <strong>{money(data.revenueByKind[kind] ?? 0)}</strong>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Inteligência que gera valor" action={<Link className="nr-btn" href="/plataforma/creditos-ia">Detalhes</Link>}>
          <CreditsSummary query={period.query} />
        </Panel>
        <Panel title="Sua próxima ação">
          <div className="nr-pad">
            {[
              { label: 'Leads novos', count: data.newLeads, href: 'leads' },
              { label: 'Organizações em atraso', count: data.organizationsByStatus.past_due ?? 0, href: 'organizacoes' },
              { label: 'Organizações suspensas', count: data.organizationsByStatus.suspended ?? 0, href: 'organizacoes' },
              { label: 'Provisionamentos com erro', count: data.provisioningErrors, href: 'organizacoes' },
            ].map((item) => (
              <Link className="nr-detail-row" href={`/plataforma/${item.href}`} key={item.label}>
                <span>{item.label}</span>
                <span className="nr-badge warn">
                  {item.count}
                  <ArrowUpRight size={12} />
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Atenção aos detalhes" description="Sinais da operação que merecem um olhar">
        <div className="nr-pad grid gap-3 md:grid-cols-2">
          {data.alerts.length ? (
            data.alerts.map((alert) => (
              <Link key={`${alert.organizationId}-${alert.kind}`} href={`/plataforma/organizacoes/${alert.organizationId}`} className="nr-alert !mb-0">
                <CircleAlert className="mr-2 inline" size={15} />
                {alert.message}
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum alerta no momento. Tudo em dia.</p>
          )}
        </div>
      </Panel>
      <Panel
        title="Organizações recentes"
        action={
          <Link href="/plataforma/organizacoes" className="nr-btn">
            Ver todas
            <ArrowUpRight size={14} />
          </Link>
        }
      >
        {recent.data ? (
          <DataTable
            rows={recent.data.organizations.slice(0, 5).map((organization) => ({ ...organization, plan: organization.subscription?.planName ?? 'Sem plano', statusText: ORGANIZATION_STATUS_LABELS[organization.status] }))}
            defaultSort="createdAt"
            defaultDescending
            columns={[
              {
                key: 'name',
                label: 'Organização',
                render: (organization) => (
                  <Link className="nr-company" href={`/plataforma/organizacoes/${organization.id}`}>
                    <span>{organization.name}</span>
                  </Link>
                ),
              },
              { key: 'plan', label: 'Plano' },
              { key: 'statusText', label: 'Estado', render: (organization) => <Badge>{organization.statusText}</Badge> },
              { key: 'value', label: 'Valor do ciclo', render: (organization) => (organization.subscription ? money(organization.subscription.value) : '—') },
              { key: 'createdAt', label: 'Criada em', render: (organization) => date(organization.createdAt) },
            ]}
          />
        ) : (
          <Loading />
        )}
      </Panel>
    </>
  );
}

export function Finance() {
  const period = usePeriod();
  const overview = useResource<Overview>(`/overview${period.query}`);
  const charges = useResource<{ charges: PlatformCharge[] }>(`/charges${period.query}`);

  if ((overview.loading && !overview.data) || (charges.loading && !charges.data)) return <Loading />;
  if (overview.error || charges.error) return <ErrorState message={overview.error || charges.error} onRetry={() => { overview.reload(); charges.reload(); }} />;

  const data = overview.data!;
  const rows = charges.data!.charges.map((charge) => ({
    ...charge,
    kindText: CHARGE_KIND_LABELS[charge.kind] ?? charge.kind,
    statusText: chargeStatusLabel(charge.status),
  }));
  const received = Object.values(data.revenueByKind).reduce((sum, value) => sum + value, 0);

  return (
    <>
      <Title title="Financeiro da plataforma" description="Receita, recebimentos e pendências, direto das cobranças do Asaas." />
      {period.control}
      <div className="nr-metrics">
        <Metric label="Receita recebida no período" value={money(received)} accent />
        <Metric label="A receber em 30 dias" value={money(data.forecast.days30)} detail="Cobranças pendentes que vencem na janela" />
        <Metric label="A receber em 60 dias" value={money(data.forecast.days60)} detail="Cobranças pendentes que vencem na janela" />
        <Metric label="A receber em 90 dias" value={money(data.forecast.days90)} detail="Cobranças pendentes que vencem na janela" />
      </div>
      <div className="nr-grid-2">
        <Panel title="Receita recebida" description={`Receita recorrente atual: ${money(data.mrr)}/mês`}>
          <ReceivedChart history={data.revenueHistory} />
        </Panel>
        <Panel title="Receita por tipo no período">
          <div className="nr-pad">
            {REVENUE_KINDS.map((kind) => (
              <div className="nr-detail-row" key={kind}>
                <span>{CHARGE_KIND_LABELS[kind]}</span>
                <strong>{money(data.revenueByKind[kind] ?? 0)}</strong>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Todas as cobranças" description="Vencimento no período, mais todas as vencidas.">
        <DataTable
          rows={rows}
          defaultSort="dueDate"
          defaultDescending
          filters={[
            { key: 'statusText', label: 'Estado', options: ['Paga', 'Pendente', 'Vencida', 'Cancelada', 'Estornada'] },
            { key: 'kindText', label: 'Tipo', options: ['Mensalidade', 'Implantação', 'Avulsa'] },
            { key: 'organizationName', label: 'Organização', options: [...new Set(rows.map((row) => row.organizationName))] },
          ]}
          columns={[
            { key: 'organizationName', label: 'Organização', render: (row) => <Link href={`/plataforma/organizacoes/${row.organizationId}`}>{row.organizationName}</Link> },
            { key: 'kindText', label: 'Tipo' },
            { key: 'value', label: 'Valor', render: (row) => money(row.value) },
            { key: 'dueDate', label: 'Vencimento', render: (row) => date(row.dueDate) },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) =>
            row.invoiceUrl ? (
              <a href={row.invoiceUrl} target="_blank" rel="noopener noreferrer">
                Abrir fatura
              </a>
            ) : null
          }
          emptyText="Nenhuma cobrança no período."
        />
      </Panel>
      <Panel title="Inadimplentes">
        <DataTable
          rows={rows.filter((row) => row.status === 'OVERDUE')}
          columns={[
            { key: 'organizationName', label: 'Organização', render: (row) => <Link href={`/plataforma/organizacoes/${row.organizationId}`}>{row.organizationName}</Link> },
            { key: 'value', label: 'Em aberto', render: (row) => money(row.value) },
            { key: 'daysLate', label: 'Dias em atraso' },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) =>
            row.invoiceUrl ? (
              <a href={row.invoiceUrl} target="_blank" rel="noopener noreferrer">
                Link de pagamento
              </a>
            ) : null
          }
          emptyText="Ninguém em atraso."
        />
      </Panel>
    </>
  );
}
