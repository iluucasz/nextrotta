'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, auditLabel, date, useResource } from './api';
import { useNotify } from './notice';
import { Badge, Confirm, DataTable, Editor, ErrorState, Loading, Panel, Title } from './ui';

export type CatalogFeature = {
  key: string;
  name: string;
  description: string | null;
  scope: 'general' | 'custom';
  builtin: boolean;
  core: boolean;
  createdAt: string;
  promotedAt: string | null;
  archived: boolean;
  plans: Array<{ id: string; name: string }>;
  organizations: Array<{ id: string; name: string }>;
};

type PlanOption = { id: string; name: string; archived: boolean; activeSubscriptions: number };
type OrganizationOption = { id: string; name: string; status: string };

const SCOPE_LABELS = { general: 'Geral', custom: 'Sob medida' };

function statusText(feature: CatalogFeature) {
  return feature.archived ? 'Arquivado' : 'Ativo';
}

export function FeatureCatalog({ id }: { id?: string }) {
  const notify = useNotify();
  const features = useResource<{ features: CatalogFeature[] }>('/features');
  const [creating, setCreating] = useState(false);

  if (id) return <FeatureDetail featureKey={decodeURIComponent(id)} />;
  if (features.loading && !features.data) return <Loading />;
  if (features.error) return <ErrorState message={features.error} onRetry={features.reload} />;

  const rows = features.data!.features.map((feature) => ({
    ...feature,
    id: feature.key,
    scopeText: feature.builtin ? 'Nativo' : SCOPE_LABELS[feature.scope],
    statusText: statusText(feature),
    plansText: feature.core ? 'Todos (base do produto)' : feature.plans.map((plan) => plan.name).join(', ') || '—',
    organizationsText: feature.organizations.map((organization) => organization.name).join(', ') || '—',
  }));

  return (
    <>
      <Title
        title="Catálogo de recursos"
        description="Recursos sob medida só afetam as organizações liberadas; nenhuma outra é impactada. Promova um recurso para levá-lo a planos inteiros."
        action={<button className="nr-btn primary" onClick={() => setCreating(true)}><Plus size={15} />Novo recurso sob medida</button>}
      />
      <Panel title="Recursos">
        <DataTable
          rows={rows}
          defaultSort="createdAt"
          filters={[
            { key: 'scopeText', label: 'Escopo', options: ['Nativo', 'Geral', 'Sob medida'] },
            { key: 'statusText', label: 'Estado', options: ['Ativo', 'Arquivado'] },
          ]}
          columns={[
            { key: 'name', label: 'Recurso', render: (row) => <Link href={`/plataforma/recursos/${encodeURIComponent(row.key)}`}>{row.name}</Link> },
            { key: 'key', label: 'Chave', render: (row) => <code>{row.key}</code> },
            { key: 'scopeText', label: 'Escopo', render: (row) => <Badge>{row.scopeText}</Badge> },
            { key: 'plansText', label: 'Planos' },
            { key: 'organizationsText', label: 'Liberado para' },
            { key: 'createdAt', label: 'Criado em', render: (row) => date(row.createdAt) },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) => <Link href={`/plataforma/recursos/${encodeURIComponent(row.key)}`}>Abrir</Link>}
        />
      </Panel>
      {creating && (
        <Editor
          title="Novo recurso sob medida"
          description="Nasce desligado para todos. Libere para as organizações que contrataram e, se fizer sentido, promova a um plano depois. A chave é usada pelo código do recurso e não pode mudar."
          fields={[
            { key: 'name', label: 'Nome', required: true },
            { key: 'key', label: 'Chave', required: true, hint: 'Letras minúsculas, números e "_". Ex.: relatorio_seguradora' },
            { key: 'description', label: 'Descrição', type: 'textarea' },
          ]}
          initial={{ name: '', key: '', description: '' }}
          validate={(values) => (/^[a-z][a-z0-9_]{1,62}$/.test(String(values.key)) ? '' : 'Chave: comece com letra e use letras minúsculas, números e "_".')}
          onClose={() => setCreating(false)}
          onSave={async (values) => {
            await api('/features', { body: values });
            notify('Recurso criado.');
            features.reload();
          }}
        />
      )}
    </>
  );
}

type History = Array<{ action: string; reason: string | null; organizationName: string | null; actorName: string | null; createdAt: string }>;

function FeatureDetail({ featureKey }: { featureKey: string }) {
  const notify = useNotify();
  const detail = useResource<{ feature: CatalogFeature; history: History }>(`/features/${encodeURIComponent(featureKey)}`);
  const plans = useResource<{ plans: PlanOption[] }>('/plans');
  const organizations = useResource<{ organizations: OrganizationOption[] }>('/organizations');
  const [dialog, setDialog] = useState<'edit' | 'grant' | 'promote' | 'archive' | null>(null);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;

  const { feature, history } = detail.data!;
  const path = `/features/${encodeURIComponent(feature.key)}`;
  const activePlans = (plans.data?.plans ?? []).filter((plan) => !plan.archived);
  const organizationList = organizations.data?.organizations ?? [];

  return (
    <>
      <Title
        title={feature.name}
        description={feature.description ?? (feature.scope === 'custom' ? 'Recurso sob medida.' : 'Recurso geral, liberado pelos planos.')}
        action={
          <div className="nr-actions">
            <Link className="nr-btn" href="/plataforma/recursos">Voltar à lista</Link>
            {!feature.builtin && <button className="nr-btn" onClick={() => setDialog('edit')}>Editar</button>}
            {!feature.builtin && <button className="nr-btn" onClick={() => setDialog('archive')}>{feature.archived ? 'Restaurar' : 'Arquivar'}</button>}
            {!feature.archived && feature.scope === 'custom' && <button className="nr-btn" onClick={() => setDialog('grant')}>Liberar para organizações</button>}
            {!feature.archived && feature.scope === 'custom' && <button className="nr-btn primary" onClick={() => setDialog('promote')}>Promover a recurso geral</button>}
          </div>
        }
      />
      <Panel title="Detalhes">
        <div className="nr-pad nr-info-grid">
          {[
            ['Chave', <code key="key">{feature.key}</code>],
            ['Escopo', feature.builtin ? 'Nativo do produto' : SCOPE_LABELS[feature.scope]],
            ['Planos', feature.core ? 'Todos (base do produto)' : feature.plans.map((plan) => plan.name).join(', ') || '—'],
            ['Liberado para', feature.organizations.map((organization) => organization.name).join(', ') || '—'],
            ['Criado em', date(feature.createdAt, true)],
            ['Promovido em', date(feature.promotedAt, true)],
            ['Estado', <Badge key="status">{statusText(feature)}</Badge>],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>
        {feature.builtin && (
          <p className="nr-pad text-xs text-muted-foreground">
            Recurso nativo: ligado ou desligado pelos planos, na tela <Link href="/plataforma/planos">Planos</Link>.
          </p>
        )}
      </Panel>
      <Panel title="Histórico do recurso">
        <DataTable
          rows={history.map((row, index) => ({ ...row, id: String(index), label: auditLabel(row.action) }))}
          columns={[
            { key: 'label', label: 'Ação' },
            { key: 'organizationName', label: 'Organização', render: (row) => row.organizationName ?? '—' },
            { key: 'actorName', label: 'Por', render: (row) => row.actorName ?? 'Sistema' },
            { key: 'createdAt', label: 'Data', render: (row) => date(row.createdAt, true) },
            { key: 'reason', label: 'Motivo', render: (row) => row.reason ?? '—' },
          ]}
          emptyText="Nenhuma alteração registrada ainda."
        />
      </Panel>
      {dialog === 'edit' && (
        <Editor
          title={`Editar ${feature.name}`}
          fields={[
            { key: 'name', label: 'Nome', required: true },
            { key: 'description', label: 'Descrição', type: 'textarea' },
          ]}
          initial={{ name: feature.name, description: feature.description ?? '' }}
          onClose={() => setDialog(null)}
          onSave={async (values) => {
            await api(path, { method: 'PATCH', body: values });
            notify('Recurso atualizado.');
            detail.reload();
          }}
        />
      )}
      {dialog === 'grant' && (
        <Editor
          title={`Liberar ${feature.name}`}
          description="Somente as organizações marcadas terão acesso. Desmarcar retira o acesso."
          fields={organizationList.map((organization) => ({ key: organization.id, label: organization.name, type: 'checkbox' }))}
          initial={Object.fromEntries(organizationList.map((organization) => [organization.id, feature.organizations.some((item) => item.id === organization.id)]))}
          onClose={() => setDialog(null)}
          onSave={async (values) => {
            await api(path, { body: { action: 'organizations', organizationIds: Object.keys(values).filter((key) => values[key]) } });
            notify('Acesso ao recurso atualizado.');
            detail.reload();
          }}
        >
          {!organizationList.length && <p className="text-xs">Nenhuma organização cadastrada.</p>}
        </Editor>
      )}
      {dialog === 'promote' && (
        <Editor
          title={`Promover ${feature.name}`}
          description="Escolha os planos que passam a incluir este recurso. A confirmação libera o acesso para todas as organizações desses planos."
          fields={activePlans.map((plan) => ({ key: plan.id, label: `${plan.name} · ${plan.activeSubscriptions} organização(ões) impactada(s)`, type: 'checkbox' }))}
          initial={{}}
          reason
          validate={(values) => (Object.values(values).some(Boolean) ? '' : 'Selecione pelo menos um plano.')}
          submit="Confirmar promoção"
          onClose={() => setDialog(null)}
          onSave={async (values, reason) => {
            await api(path, { body: { action: 'promote', planIds: Object.keys(values).filter((key) => values[key]), reason } });
            notify('Recurso promovido.');
            detail.reload();
          }}
        />
      )}
      {dialog === 'archive' && (
        <Confirm
          title={`${feature.archived ? 'Restaurar' : 'Arquivar'} ${feature.name}?`}
          description={
            feature.archived
              ? 'As organizações liberadas voltam a ter acesso. Os planos não voltam a incluí-lo automaticamente.'
              : 'O recurso é desligado para todas as organizações e removido dos planos. Nada é apagado e ele pode ser restaurado.'
          }
          reason={!feature.archived}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            await api(path, { method: 'PATCH', body: { archived: !feature.archived, reason } });
            notify(feature.archived ? 'Recurso restaurado.' : 'Recurso arquivado.');
            detail.reload();
          }}
        />
      )}
    </>
  );
}
