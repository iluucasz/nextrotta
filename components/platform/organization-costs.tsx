'use client';

import { useState } from 'react';
import { money, useResource } from './api';
import { amount } from './capacity';
import { DataTable, Empty, ErrorState, Loading, Metric, Panel } from './ui';

type CostLine = { category: string; label: string; total: number; basis: string; share: number; amount: number };

type Usage = {
  portoMinutes: number;
  portoRuns: number;
  whatsappMessages: number;
  storageMb: number;
  databaseMb: number;
  aiCredits: number;
  aiCost: number;
};

type OrganizationCosts = {
  month: string;
  organization: { usage: Usage; lines: CostLine[]; estimatedCost: number; monthlyRevenue: number; margin: number } | null;
  platform: { costs: Array<{ category: string; label: string; total: number }>; totalCost: number; organizations: number; measuredAiCost: number };
  method: string;
};

const currentMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
const percent = (value: number) => `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Organization detail → Custos: what the organization consumed in the month and what it costs. */
export function OrganizationCostsTab({ organizationId }: { organizationId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const data = useResource<OrganizationCosts>(`/organizations/${organizationId}/costs?month=${month}`);

  const picker = (
    <input type="month" aria-label="Mês" value={month} max={currentMonth()} onChange={(event) => event.target.value && setMonth(event.target.value)} />
  );

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  const costs = data.data!;
  const organization = costs.organization;

  if (!organization) {
    return (
      <Panel title="Custos" action={picker}>
        <Empty title="Sem custos neste mês" text="A empresa não estava ativa no mês escolhido (provisionamento ou cancelada não entram na divisão)." />
      </Panel>
    );
  }

  const { usage } = organization;
  const noCosts = costs.platform.costs.length === 0;

  return (
    <>
      <div className="nr-metrics">
        <Metric label="Custo estimado no mês" value={money(organization.estimatedCost)} detail={noCosts ? 'Nenhum gasto lançado no mês' : `Parte dela de ${money(costs.platform.totalCost)}`} accent />
        <Metric label="Paga por mês" value={money(organization.monthlyRevenue)} detail="Mensalidade (anual dividida por 12)" />
        <Metric label="Margem" value={money(organization.margin)} detail={organization.monthlyRevenue ? `${percent(organization.margin / organization.monthlyRevenue)} do que paga` : 'Sem mensalidade'} />
        <Metric label="Gasto real com IA" value={money(usage.aiCost)} detail={`${usage.aiCredits.toLocaleString('pt-BR')} crédito(s) usados`} />
      </div>

      {noCosts && (
        <div className="nr-alert">
          Nenhum gasto da plataforma lançado em {month}. Lance o que pagou no mês (VPS, Vercel, armazenamento, banco, WhatsApp, domínio…) em Operação → Gastos para ver quanto
          cabe a esta empresa. O consumo abaixo já é medido.
        </div>
      )}

      <Panel title="Consumo no mês" description="Medido no sistema. Armazenamento e banco são o tamanho de hoje; o resto é do mês escolhido." action={picker}>
        <div className="nr-pad">
          <div className="nr-metrics">
            <Metric label="WhatsApp" value={usage.whatsappMessages.toLocaleString('pt-BR')} detail="mensagens enviadas (ilimitado)" />
            <Metric label="Armazenamento" value={amount(usage.storageMb, 'mb')} detail="arquivos da biblioteca" />
            <Metric label="Banco de dados" value={amount(usage.databaseMb, 'mb')} detail="estimado pelos dados dela" />
            <Metric label="Robô do Porto" value={`${usage.portoMinutes.toLocaleString('pt-BR')} min`} detail={`${usage.portoRuns.toLocaleString('pt-BR')} execução(ões)`} />
          </div>
        </div>
      </Panel>

      <Panel title="Parte dela em cada gasto" description={`Como cada gasto do mês é dividido: ${costs.method}`}>
        <DataTable
          rows={organization.lines.map((line) => ({ ...line, id: line.category }))}
          defaultSort="amount"
          defaultDescending
          columns={[
            { key: 'label', label: 'Gasto' },
            { key: 'total', label: 'A plataforma pagou', render: (line) => money(line.total) },
            { key: 'basis', label: 'Dividido por' },
            { key: 'share', label: 'Parte dela', render: (line) => percent(line.share) },
            { key: 'amount', label: 'Custo dela', render: (line) => <strong className="font-semibold">{money(line.amount)}</strong> },
          ]}
          emptyText="Nenhum gasto lançado neste mês."
        />
      </Panel>
    </>
  );
}
