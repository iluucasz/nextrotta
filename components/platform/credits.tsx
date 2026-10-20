'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, chargeStatusLabel, date, money, preciseMoney, useResource } from './api';
import { AiBalancePanel } from './ai-balance';
import { useNotify } from './notice';
import { usePeriod } from './overview';
import { Badge, Confirm, DataTable, Editor, Empty, ErrorState, Loading, Metric, Panel, Title, type Field } from './ui';

type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price: number;
  sold: number;
  archived: boolean;
  createdAt: string;
  /** Overview only: what the package's answers cost the owner, the margin it gives and the price of the target margin. */
  cost?: number;
  marginPercent?: number | null;
  priceForMargin?: number | null;
};

type Pricing = {
  answersMeasured: number;
  source: 'measured' | 'estimate';
  promptTokens: number;
  completionTokens: number;
  costPerUse: number;
  costPerUseP90: number | null;
  costPerCredit: number;
  targetMarginPercent: number | null;
  minPricePerCredit: number | null;
  pricesConfigured: boolean;
};

type CreditsOverview = {
  consumedCredits: number;
  providerCost: number;
  revenue: number;
  organizations: Array<{ id: string; name: string; consumed: number; balance: number }>;
  conversion: { inputCostPerMillion: number; outputCostPerMillion: number; creditsPerUse: number; targetMarginPercent: number | null };
  pricing: Pricing;
  packages: CreditPackage[];
};

const percent = (value: number) => `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** Literal so Tailwind generates it. */
const BELOW_TARGET_CLASS = 'text-[#bd6150] font-semibold';

const PACKAGE_FIELDS: Field[] = [
  { key: 'name', label: 'Nome', required: true },
  { key: 'credits', label: 'Quantidade de créditos', type: 'number', min: 1, required: true },
  { key: 'price', label: 'Preço (R$)', type: 'number', required: true },
];

export function AiCredits({ id }: { id?: string }) {
  const notify = useNotify();
  const period = usePeriod();
  const overview = useResource<CreditsOverview>(`/ai-credits${period.query}`);
  const [editing, setEditing] = useState<CreditPackage | 'new' | null>(null);
  const [archive, setArchive] = useState<CreditPackage | null>(null);
  const [conversion, setConversion] = useState(false);
  const [applying, setApplying] = useState(false);

  if (id) return <PackageDetail id={id} />;
  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;

  const data = overview.data!;
  const active = data.packages.filter((item) => !item.archived);
  const { pricing } = data;
  const target = pricing.targetMarginPercent;
  const belowTarget = active.filter((item) => target !== null && item.marginPercent !== null && item.marginPercent !== undefined && item.marginPercent < target);

  return (
    <>
      <Title title="Créditos de IA" description="Uma inteligência sustentável para cada operação." />
      {period.control}
      <div className="nr-metrics">
        <Metric label="Créditos consumidos" value={data.consumedCredits.toLocaleString('pt-BR')} />
        <Metric label="Receita de créditos" value={money(data.revenue)} accent />
        <Metric label="Custo real" value={money(data.providerCost)} detail="Cobrado pelo provedor de IA" />
        <Metric label="Margem no período" value={data.revenue ? `${(((data.revenue - data.providerCost) / data.revenue) * 100).toFixed(1).replace('.', ',')}%` : '—'} />
      </div>
      <AiBalancePanel conversion={data.conversion} />
      {!pricing.pricesConfigured && (
        <div className="nr-alert">
          Os preços da DeepSeek estão zerados em “Editar conversão e margem”: sem eles o custo de cada pergunta, a sua margem e o preço mínimo dos pacotes não podem ser calculados.
        </div>
      )}
      {belowTarget.length > 0 && (
        <div className="nr-alert">
          {belowTarget.length} pacote(s) abaixo da sua margem de {percent(target!)}: {belowTarget.map((item) => item.name).join(', ')}. Use “Aplicar margem” ou ajuste o preço.
        </div>
      )}
      <Panel
        title="Pacotes de créditos"
        description="Recargas que o administrador de cada organização pode comprar. Custo para você = o que a DeepSeek cobra pelas perguntas do pacote; margem = o que sobra do preço."
        action={
          <div className="flex flex-wrap gap-2">
            {pricing.minPricePerCredit !== null && active.length > 0 && (
              <button className="nr-btn" onClick={() => setApplying(true)}>
                Aplicar margem
              </button>
            )}
            <button className="nr-btn" onClick={() => setEditing('new')}>
              <Plus size={15} />
              Novo pacote
            </button>
          </div>
        }
      >
        <DataTable
          rows={data.packages.map((item) => ({ ...item, statusText: item.archived ? 'Arquivado' : 'Ativo', perCredit: item.price / item.credits }))}
          defaultSort="credits"
          filters={[{ key: 'statusText', label: 'Estado', options: ['Ativo', 'Arquivado'] }]}
          columns={[
            { key: 'name', label: 'Pacote', render: (row) => <Link href={`/plataforma/creditos-ia/${row.id}`}>{row.name}</Link> },
            { key: 'credits', label: 'Créditos', render: (row) => row.credits.toLocaleString('pt-BR') },
            { key: 'price', label: 'Preço', render: (row) => money(row.price) },
            { key: 'perCredit', label: 'Por crédito', render: (row) => preciseMoney(row.perCredit) },
            { key: 'cost', label: 'Custo para você', render: (row) => (pricing.pricesConfigured ? preciseMoney(row.cost ?? 0) : '—') },
            {
              key: 'marginPercent',
              label: 'Sua margem',
              render: (row) =>
                row.marginPercent === null || row.marginPercent === undefined ? (
                  '—'
                ) : (
                  <span className={target !== null && row.marginPercent < target ? BELOW_TARGET_CLASS : ''}>
                    {percent(row.marginPercent)}
                    {target !== null && row.marginPercent < target && row.priceForMargin ? <small>para {percent(target)}: {money(row.priceForMargin)}</small> : null}
                  </span>
                ),
            },
            { key: 'sold', label: 'Vendidos' },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) => (
            <>
              {!row.archived && <button onClick={() => setEditing(row)}>Editar</button>}
              <button onClick={() => setArchive(row)}>{row.archived ? 'Restaurar' : 'Arquivar'}</button>
            </>
          )}
          emptyText="Nenhum pacote cadastrado. Crie um para que as organizações possam comprar créditos extras."
        />
      </Panel>
      <Panel
        title="Conversão, custos e margem"
        description={
          (pricing.source === 'measured'
            ? `Custo por pergunta medido nas ${pricing.answersMeasured.toLocaleString('pt-BR')} resposta(s) dos últimos 90 dias`
            : 'Ainda sem respostas: custo por pergunta estimado') +
          ` (${pricing.promptTokens.toLocaleString('pt-BR')} tokens de entrada + ${pricing.completionTokens.toLocaleString('pt-BR')} de saída, em média), com os preços abaixo. ` +
          'Preço mínimo por crédito = custo ÷ (1 − margem): com 50%, de cada R$ 100 que o cliente paga, R$ 50 ficam com você.'
        }
        action={<button className="nr-btn" onClick={() => setConversion(true)}>Editar conversão e margem</button>}
      >
        <div className="nr-pad nr-info-grid">
          {[
            ['Custo por milhão de tokens · entrada', money(data.conversion.inputCostPerMillion)],
            ['Custo por milhão de tokens · saída', money(data.conversion.outputCostPerMillion)],
            ['Créditos por pergunta', data.conversion.creditsPerUse],
            ['Custo por pergunta', pricing.pricesConfigured ? preciseMoney(pricing.costPerUse) : 'Preencha os preços'],
            ['Pergunta mais pesada (9 de 10 custam menos)', pricing.costPerUseP90 !== null && pricing.pricesConfigured ? preciseMoney(pricing.costPerUseP90) : '—'],
            ['Custo por crédito', pricing.pricesConfigured ? preciseMoney(pricing.costPerCredit) : '—'],
            ['Sua margem desejada', target === null ? 'Não definida' : percent(target)],
            ['Preço mínimo por crédito', pricing.minPricePerCredit === null ? '—' : preciseMoney(pricing.minPricePerCredit)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Quem mais usa IA" description="Consumo no período e saldo atual de cada organização.">
        <DataTable
          rows={data.organizations}
          defaultSort="consumed"
          defaultDescending
          columns={[
            { key: 'name', label: 'Organização', render: (row) => <Link href={`/plataforma/organizacoes/${row.id}`}>{row.name}</Link> },
            { key: 'consumed', label: 'Créditos consumidos', render: (row) => row.consumed.toLocaleString('pt-BR') },
            { key: 'balance', label: 'Saldo atual', render: (row) => row.balance.toLocaleString('pt-BR') },
          ]}
          emptyText="Nenhuma organização cadastrada."
        />
      </Panel>
      {editing && (
        <Editor
          title={editing === 'new' ? 'Novo pacote de créditos' : `Editar ${editing.name}`}
          description={
            (editing === 'new' ? 'Fica disponível para compra assim que for criado.' : 'O novo preço vale para as próximas compras; cobranças já emitidas mantêm o valor.') +
            (pricing.minPricePerCredit !== null
              ? ` Para a sua margem de ${percent(target!)}, cobre pelo menos ${preciseMoney(pricing.minPricePerCredit)} por crédito (ex.: 1.000 créditos = ${money(Math.ceil(1000 * pricing.minPricePerCredit * 2) / 2)}).`
              : '')
          }
          fields={PACKAGE_FIELDS}
          initial={editing === 'new' ? { name: '', credits: 1000, price: '' } : { name: editing.name, credits: editing.credits, price: editing.price }}
          reason={editing !== 'new'}
          onClose={() => setEditing(null)}
          onSave={async (values, reason) => {
            const body = { name: values.name, credits: Number(values.credits), price: Number(values.price), reason };
            if (editing === 'new') await api('/ai-credits/packages', { body });
            else await api(`/ai-credits/packages/${editing.id}`, { method: 'PATCH', body });
            notify(editing === 'new' ? 'Pacote criado.' : 'Pacote atualizado.');
            overview.reload();
          }}
        />
      )}
      {archive && (
        <Confirm
          title={`${archive.archived ? 'Restaurar' : 'Arquivar'} ${archive.name}?`}
          description={archive.archived ? 'O pacote volta a ser oferecido às organizações.' : 'O pacote deixa de ser oferecido. As compras já feitas não mudam.'}
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api(`/ai-credits/packages/${archive.id}`, { method: 'PATCH', body: { archived: !archive.archived } });
            notify(archive.archived ? 'Pacote restaurado.' : 'Pacote arquivado.');
            overview.reload();
          }}
        />
      )}
      {applying && pricing.minPricePerCredit !== null && (
        <Confirm
          title={`Aplicar margem de ${percent(target!)}?`}
          description={
            'Cada pacote ativo passa a custar o preço da sua margem (arredondado para cima em R$ 0,50): ' +
            active.map((item) => `${item.name} ${money(item.price)} → ${money(item.priceForMargin ?? item.price)}`).join('; ') +
            '. Vale para as próximas compras; cobranças já emitidas mantêm o valor.'
          }
          reason
          onClose={() => setApplying(false)}
          onConfirm={async (reason) => {
            const result = await api<{ changes: unknown[] }>('/ai-credits/apply-margin', { method: 'POST', body: { reason } });
            notify(result.changes.length ? `${result.changes.length} pacote(s) com preço novo.` : 'Os preços já estavam na margem.');
            overview.reload();
          }}
        />
      )}
      {conversion && (
        <Editor
          title="Conversão e margem"
          description="Quanto a DeepSeek cobra (em R$, pelo câmbio do dia), quantos créditos cada pergunta consome e quanto você quer ganhar."
          fields={[
            { key: 'inputCostPerMillion', label: 'Entrada / milhão de tokens (R$)', type: 'number', required: true },
            { key: 'outputCostPerMillion', label: 'Saída / milhão de tokens (R$)', type: 'number', required: true },
            { key: 'creditsPerUse', label: 'Créditos por pergunta', type: 'number', min: 1, required: true },
            {
              key: 'targetMarginPercent',
              label: 'Sua margem desejada (%)',
              type: 'number',
              hint: 'Quanto do que o cliente paga pelos créditos fica com você. Ex.: 50 = de R$ 100, R$ 50 são seus. Vazio = sem margem definida.',
            },
          ]}
          initial={{ ...data.conversion, targetMarginPercent: data.conversion.targetMarginPercent ?? '' }}
          reason
          onClose={() => setConversion(false)}
          onSave={async (values, reason) => {
            await api('/settings', {
              method: 'PUT',
              body: {
                ai: {
                  inputCostPerMillion: Number(values.inputCostPerMillion),
                  outputCostPerMillion: Number(values.outputCostPerMillion),
                  creditsPerUse: Number(values.creditsPerUse),
                  targetMarginPercent: values.targetMarginPercent === '' ? null : Number(values.targetMarginPercent),
                },
                reason,
              },
            });
            notify('Conversão e margem salvas.');
            overview.reload();
          }}
        />
      )}
    </>
  );
}

type Sale = { id: string; organizationId: string; organizationName: string; value: number; status: string; dueDate: string; paidAt: string | null };

function PackageDetail({ id }: { id: string }) {
  const detail = useResource<{ package: CreditPackage; sales: Sale[] }>(`/ai-credits/packages/${id}`);
  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;
  const { package: item, sales } = detail.data!;

  return (
    <>
      <Title title={item.name} description="Pacote de créditos de IA e suas vendas." action={<Link className="nr-btn" href="/plataforma/creditos-ia">Voltar</Link>} />
      <Panel title="Detalhes">
        <div className="nr-pad nr-info-grid">
          {[
            ['Créditos', item.credits.toLocaleString('pt-BR')],
            ['Preço', money(item.price)],
            ['Por crédito', money(item.price / item.credits)],
            ['Vendidos (pagos)', item.sold],
            ['Criado em', date(item.createdAt, true)],
            ['Estado', <Badge key="status">{item.archived ? 'Arquivado' : 'Ativo'}</Badge>],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Compras">
        {sales.length ? (
          <DataTable
            rows={sales.map((sale) => ({ ...sale, statusText: chargeStatusLabel(sale.status) }))}
            defaultSort="dueDate"
            defaultDescending
            columns={[
              { key: 'organizationName', label: 'Organização', render: (row) => <Link href={`/plataforma/organizacoes/${row.organizationId}`}>{row.organizationName}</Link> },
              { key: 'value', label: 'Valor', render: (row) => money(row.value) },
              { key: 'dueDate', label: 'Vencimento', render: (row) => date(row.dueDate) },
              { key: 'paidAt', label: 'Pago em', render: (row) => date(row.paidAt, true) },
              { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
            ]}
          />
        ) : (
          <Empty title="Nenhuma compra ainda" text="As compras feitas pelos administradores das organizações aparecem aqui." />
        )}
      </Panel>
    </>
  );
}
