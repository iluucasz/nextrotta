'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Plan } from '@/lib/plans';
import { api, money, useResource } from './api';
import { useNotify } from './notice';
import { Badge, DataTable, Editor, ErrorState, Loading, Metric, Panel, Title } from './ui';

type ModuleRow = {
  key: string;
  name: string;
  description: string | null;
  core: boolean;
  inBase: boolean;
  sellable: boolean;
  monthlyPrice: number | null;
  setupFee: number;
};

type Builder = {
  id: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  annualFactor: number;
  setupFee: number;
  includedTechnicians: number;
  extraTechnicianPrice: number;
};

type Modules = { builder: Builder | null; modules: ModuleRow[] };

const round2 = (value: number) => Math.round(value * 100) / 100;

function stateOf(row: ModuleRow) {
  if (row.core) return 'Núcleo (em todos os planos)';
  if (row.inBase) return 'Na base da montagem';
  return row.monthlyPrice === null ? 'Fora de venda' : 'À venda';
}

/**
 * What the same content costs when assembled module by module, against the package: the base of the builder plus the price of
 * each module the package has that is sold apart, plus the technicians the package includes beyond the base's (at the extra price).
 */
function assembled(builder: Builder, modules: ModuleRow[], pkg: Pick<Plan, 'features' | 'includedTechnicians'>) {
  const priced = modules.filter((module) => module.sellable && module.monthlyPrice !== null && pkg.features.includes(module.key as Plan['features'][number]));
  const extraTechnicians = Math.max(0, pkg.includedTechnicians - builder.includedTechnicians);
  return {
    monthly: round2(builder.monthlyPrice + priced.reduce((total, module) => total + (module.monthlyPrice ?? 0), 0) + extraTechnicians * builder.extraTechnicianPrice),
    count: priced.length,
    extraTechnicians,
  };
}

export function Modules() {
  const notify = useNotify();
  const modules = useResource<Modules>('/modules');
  const plans = useResource<{ plans: Array<Plan & { activeSubscriptions: number }> }>('/plans');
  const [editing, setEditing] = useState<ModuleRow | null>(null);

  if ((modules.loading && !modules.data) || (plans.loading && !plans.data)) return <Loading />;
  if (modules.error || plans.error) return <ErrorState message={modules.error || plans.error} onRetry={() => { modules.reload(); plans.reload(); }} />;

  const { builder, modules: rows } = modules.data!;
  const onSale = rows.filter((row) => row.sellable && row.monthlyPrice !== null);
  const totalMonthly = round2(onSale.reduce((total, row) => total + (row.monthlyPrice ?? 0), 0));
  const totalSetup = round2(onSale.reduce((total, row) => total + row.setupFee, 0));
  const packages = plans.data!.plans.filter((plan) => plan.kind === 'package' && !plan.archived && !plan.onRequest);
  const factor = builder?.annualFactor ?? 12;

  return (
    <>
      <Title
        title="Monte o seu"
        description="Preço de cada módulo. Quem já contratou mantém o que escolheu: o novo preço vale só para novas assinaturas."
        action={builder ? <Link className="nr-btn" href="/plataforma/planos">Editar a base em Planos</Link> : undefined}
      />
      {!builder && <div className="nr-alert">A montagem de plano está desligada (o plano “Monte o seu” está arquivado). Restaure-o em Planos para vender módulos.</div>}
      {builder && (
        <div className="nr-metrics">
          <Metric label="Base da montagem" value={`${money(builder.monthlyPrice)}/mês`} detail={`${money(builder.annualPrice)}/ano · implantação ${money(builder.setupFee)}`} accent />
          <Metric label="Técnicos incluídos" value={builder.includedTechnicians} detail={`Técnico extra: ${money(builder.extraTechnicianPrice)}/mês`} />
          <Metric label="Módulos à venda" value={onSale.length} detail={`Todos juntos: ${money(totalMonthly)}/mês · ${money(totalSetup)} de implantação`} />
        </div>
      )}

      <Panel title="Módulos">
        <DataTable
          rows={rows.map((row) => ({ ...row, id: row.key, state: stateOf(row) }))}
          defaultSort="name"
          filters={[{ key: 'state', label: 'Estado', options: ['À venda', 'Fora de venda', 'Na base da montagem', 'Núcleo (em todos os planos)'] }]}
          columns={[
            { key: 'name', label: 'Módulo', render: (row) => <span title={row.description ?? undefined}>{row.name}</span> },
            { key: 'monthlyPrice', label: 'Mensal', render: (row) => (row.sellable && row.monthlyPrice !== null ? money(row.monthlyPrice) : '—') },
            { key: 'annual', label: `Anual (×${factor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })})`, render: (row) => (row.sellable && row.monthlyPrice !== null ? money(round2(row.monthlyPrice * factor)) : '—') },
            { key: 'setupFee', label: 'Implantação', render: (row) => (row.sellable && row.monthlyPrice !== null ? money(row.setupFee) : '—') },
            { key: 'state', label: 'Estado', render: (row) => <Badge tone={row.state === 'À venda' ? 'good' : 'neutral'}>{row.state}</Badge> },
          ]}
          actions={(row) => (row.sellable ? <button onClick={() => setEditing(row)}>Editar preço</button> : null)}
          emptyText="Nenhum recurso geral cadastrado."
        />
      </Panel>

      {builder && packages.length > 0 && (
        <Panel title="Montado × pacote" description="O mesmo conteúdo de cada pacote, montado módulo a módulo. Serve para calibrar os preços: montar não deveria sair bem mais barato que o pacote.">
          <DataTable
            rows={packages.map((plan) => {
              const result = assembled(builder, rows, plan);
              return { id: plan.id, name: plan.name, package: plan.monthlyPrice, assembled: result.monthly, difference: round2(result.monthly - plan.monthlyPrice), modules: result.count, extraTechnicians: result.extraTechnicians };
            })}
            columns={[
              { key: 'name', label: 'Pacote' },
              { key: 'package', label: 'Preço do pacote', render: (row) => `${money(row.package)}/mês` },
              { key: 'assembled', label: 'Montado', render: (row) => `${money(row.assembled)}/mês` },
              { key: 'modules', label: 'Módulos somados', render: (row) => `${row.modules}${row.extraTechnicians ? ` + ${row.extraTechnicians} técnicos` : ''}` },
              {
                key: 'difference',
                label: 'Diferença',
                render: (row) => <Badge tone={row.difference < 0 ? 'bad' : 'good'}>{row.difference < 0 ? `${money(-row.difference)} mais barato montado` : `${money(row.difference)} mais caro montado`}</Badge>,
              },
            ]}
          />
        </Panel>
      )}

      {editing && (
        <Editor
          title={`Preço do módulo · ${editing.name}`}
          description="Só vale para novas assinaturas: quem já contratou mantém o preço que escolheu."
          fields={[
            { key: 'onSale', label: 'À venda no “Monte o seu”', type: 'checkbox' },
            { key: 'monthlyPrice', label: 'Preço mensal (R$)', type: 'number', hint: `Anual: ${factor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× o mensal, como a base.` },
            { key: 'setupFee', label: 'Implantação do módulo (R$)', type: 'number' },
          ]}
          initial={{ onSale: editing.monthlyPrice !== null, monthlyPrice: editing.monthlyPrice ?? '', setupFee: editing.setupFee }}
          validate={(values) => (values.onSale && (values.monthlyPrice === '' || Number(values.monthlyPrice) < 0) ? 'Informe o preço mensal para pôr o módulo à venda.' : '')}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            await api(`/modules/${encodeURIComponent(editing.key)}`, {
              method: 'PUT',
              body: { monthlyPrice: values.onSale ? Number(values.monthlyPrice) : null, setupFee: Number(values.setupFee || 0) },
            });
            notify(values.onSale ? 'Preço do módulo salvo.' : 'Módulo tirado de venda.');
            modules.reload();
          }}
        />
      )}
    </>
  );
}
