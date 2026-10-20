'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, date, errorMessage, useResource } from './api';
import { BugTable, type BugRow } from './bugs';
import { couponValue } from './coupons';
import type { CatalogFeature } from './features';
import { useNotify } from './notice';
import { Confirm, DataTable, Editor, Empty, ErrorState, Loading, Metric, Panel } from './ui';

type ActiveCoupon = { id: string; couponId: string; code: string; kind: 'percent' | 'fixed'; value: number; appliedAt: string; endsOn: string | null };

/** Coupon of the subscription: apply one by code, or remove it (the previous discount returns). */
export function CouponPanel({ organizationId, onChanged }: { organizationId: string; onChanged: () => void }) {
  const notify = useNotify();
  const coupon = useResource<{ coupon: ActiveCoupon | null }>(`/organizations/${organizationId}/coupon`);
  const [applying, setApplying] = useState(false);
  const [removing, setRemoving] = useState(false);

  const active = coupon.data?.coupon ?? null;
  return (
    <Panel
      title="Cupom"
      description="O desconto do cupom substitui o desconto atual enquanto durar; ao terminar ou ser removido, o desconto anterior volta."
      action={
        active ? (
          <button className="nr-btn" onClick={() => setRemoving(true)}>Remover cupom</button>
        ) : (
          <button className="nr-btn" onClick={() => setApplying(true)}>Aplicar cupom</button>
        )
      }
    >
      {coupon.error ? (
        <ErrorState message={coupon.error} onRetry={coupon.reload} />
      ) : !coupon.data ? (
        <Loading />
      ) : active ? (
        <div className="nr-pad nr-info-grid">
          {[
            ['Código', <Link key="code" href={`/plataforma/cupons/${active.couponId}`}>{active.code}</Link>],
            ['Desconto', couponValue(active)],
            ['Aplicado em', date(active.appliedAt, true)],
            ['Vale até', active.endsOn ? date(active.endsOn) : 'Permanente'],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>
      ) : (
        <p className="nr-pad text-xs text-muted-foreground">Nenhum cupom aplicado.</p>
      )}
      {applying && (
        <Editor
          title="Aplicar cupom"
          description="O valor da assinatura é recalculado e, com a cobrança ativa, atualizado no Asaas."
          fields={[{ key: 'code', label: 'Código do cupom', required: true }]}
          initial={{ code: '' }}
          onClose={() => setApplying(false)}
          onSave={async (values) => {
            await api(`/organizations/${organizationId}/coupon`, { body: { code: values.code } });
            notify('Cupom aplicado.');
            coupon.reload();
            onChanged();
          }}
        />
      )}
      {removing && active && (
        <Confirm
          title={`Remover o cupom ${active.code}?`}
          description="O desconto que a assinatura tinha antes do cupom volta a valer."
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await api(`/organizations/${organizationId}/coupon`, { method: 'DELETE' });
            notify('Cupom removido.');
            coupon.reload();
            onChanged();
          }}
        />
      )}
    </Panel>
  );
}

/** Custom features granted to just this organization. */
export function CustomFeaturesPanel({ organizationId }: { organizationId: string }) {
  const notify = useNotify();
  const granted = useResource<{ features: Array<{ key: string; name: string; description: string | null; grantedAt: string }> }>(`/organizations/${organizationId}/features`);
  const catalog = useResource<{ features: CatalogFeature[] }>('/features');
  const [editing, setEditing] = useState(false);

  const custom = (catalog.data?.features ?? []).filter((feature) => feature.scope === 'custom' && !feature.archived);
  const grantedKeys = new Set((granted.data?.features ?? []).map((feature) => feature.key));

  return (
    <Panel
      title="Recursos sob medida"
      description="Funcionalidades exclusivas liberadas só para esta organização."
      action={<button className="nr-btn" onClick={() => setEditing(true)} disabled={!catalog.data}>Liberar recursos</button>}
    >
      {granted.error ? (
        <ErrorState message={granted.error} onRetry={granted.reload} />
      ) : !granted.data ? (
        <Loading />
      ) : granted.data.features.length ? (
        <div className="nr-pad">
          {granted.data.features.map((feature) => (
            <div className="nr-detail-row" key={feature.key}>
              <span>
                <Link href={`/plataforma/recursos/${encodeURIComponent(feature.key)}`}>{feature.name}</Link>
                <small>{feature.description ?? feature.key}</small>
              </span>
              <small>Liberado em {date(feature.grantedAt)}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="nr-pad text-xs text-muted-foreground">
          Nenhum recurso sob medida liberado. Crie recursos no <Link href="/plataforma/recursos">catálogo</Link>.
        </p>
      )}
      {editing && (
        <Editor
          title="Recursos sob medida"
          description="Marque os recursos que esta organização pode usar. Desmarcar retira o acesso (nada é apagado)."
          fields={custom.map((feature) => ({ key: feature.key, label: feature.name, type: 'checkbox' }))}
          initial={Object.fromEntries(custom.map((feature) => [feature.key, grantedKeys.has(feature.key)]))}
          onClose={() => setEditing(false)}
          onSave={async (values) => {
            for (const feature of custom) {
              const enabled = Boolean(values[feature.key]);
              if (enabled !== grantedKeys.has(feature.key)) {
                await api(`/organizations/${organizationId}/features`, { method: 'PUT', body: { key: feature.key, enabled } });
              }
            }
            notify('Recursos sob medida atualizados.');
            granted.reload();
          }}
        >
          {!custom.length && <p className="text-xs">Nenhum recurso sob medida no catálogo ainda.</p>}
        </Editor>
      )}
    </Panel>
  );
}

type Credits = {
  balance: number;
  monthlyCredits: number;
  planIncludesAi: boolean | null;
  entries: Array<{ id: string; kind: string; kindLabel: string; quantity: number; cost: number | null; description: string | null; authorName: string | null; createdAt: string }>;
};

export function CreditsTab({ organizationId }: { organizationId: string }) {
  const notify = useNotify();
  const credits = useResource<Credits>(`/organizations/${organizationId}/credits`);
  const [adjusting, setAdjusting] = useState(false);

  if (credits.loading && !credits.data) return <Loading />;
  if (credits.error) return <ErrorState message={credits.error} onRetry={credits.reload} />;
  const data = credits.data!;
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
  const consumedThisMonth = data.entries
    .filter((entry) => entry.kind === 'consumption' && entry.createdAt.slice(0, 7) === month)
    .reduce((sum, entry) => sum - entry.quantity, 0);

  return (
    <>
      <div className="nr-metrics">
        <Metric label="Saldo atual" value={data.balance.toLocaleString('pt-BR')} accent detail="créditos" />
        <Metric label="Cota mensal do plano" value={data.monthlyCredits.toLocaleString('pt-BR')} detail={data.planIncludesAi === false ? 'O plano atual não inclui IA' : 'Renova todo mês, não acumula'} />
        <Metric label="Consumo neste mês" value={consumedThisMonth.toLocaleString('pt-BR')} detail="créditos" />
        <Metric label="Lançamentos" value={data.entries.length} detail="no extrato" />
      </div>
      <Panel title="Extrato de créditos" action={<button className="nr-btn" onClick={() => setAdjusting(true)}>Ajustar saldo</button>}>
        <DataTable
          rows={data.entries}
          defaultSort="createdAt"
          defaultDescending
          filters={[{ key: 'kindLabel', label: 'Tipo', options: [...new Set(data.entries.map((entry) => entry.kindLabel))] }]}
          columns={[
            { key: 'createdAt', label: 'Data', render: (row) => date(row.createdAt, true) },
            { key: 'kindLabel', label: 'Tipo' },
            { key: 'quantity', label: 'Créditos', render: (row) => `${row.quantity > 0 ? '+' : ''}${row.quantity.toLocaleString('pt-BR')}` },
            { key: 'description', label: 'Descrição', render: (row) => row.description ?? '—' },
            { key: 'authorName', label: 'Por', render: (row) => row.authorName ?? 'Sistema' },
          ]}
          emptyText="Nenhum lançamento ainda. A cota mensal, o bônus de entrada, as compras e o consumo aparecem aqui."
        />
      </Panel>
      {adjusting && (
        <Editor
          title="Ajustar saldo de créditos"
          description="Use um número positivo para conceder e negativo para debitar. O ajuste fica no extrato e na auditoria."
          fields={[{ key: 'quantity', label: 'Quantidade', type: 'number', required: true, min: -1_000_000 }]}
          initial={{ quantity: '' }}
          reason
          validate={(values) => (Number.isInteger(Number(values.quantity)) && Number(values.quantity) !== 0 ? '' : 'Informe um número inteiro diferente de zero.')}
          onClose={() => setAdjusting(false)}
          onSave={async (values, reason) => {
            await api(`/organizations/${organizationId}/credits`, { body: { quantity: Number(values.quantity), reason } });
            notify('Saldo ajustado.');
            credits.reload();
          }}
        />
      )}
    </>
  );
}

type TrashRow = { id: string; table: string; tableLabel: string; recordId: string; summary: string; technicianName: string | null; deletedAt: string; deletedByName: string | null };

/** Export everything, and the trash: archived records that can be restored. */
export function DataTab({ organizationId }: { organizationId: string }) {
  const notify = useNotify();
  const trash = useResource<{ trash: TrashRow[] }>(`/organizations/${organizationId}/data`);
  const [restoring, setRestoring] = useState<TrashRow | null>(null);

  return (
    <>
      <Panel
        title="Exportação completa"
        description="Todos os registros da organização (inclusive os arquivados) em um arquivo JSON. Senhas e credenciais nunca saem do banco. A exportação fica registrada na auditoria."
        action={<a className="nr-btn primary" href={`/api/platform/organizations/${organizationId}/data?export=1`}>Exportar dados</a>}
      >
        <p className="nr-pad text-xs text-muted-foreground">O administrador da organização também pode exportar tudo pela tela Assinatura, inclusive com a conta suspensa.</p>
      </Panel>
      <Panel title="Lixeira" description="Nada é apagado de verdade: o que foi excluído no sistema da empresa fica aqui e pode ser restaurado.">
        {trash.loading && !trash.data ? (
          <Loading />
        ) : trash.error ? (
          <ErrorState message={trash.error} onRetry={trash.reload} />
        ) : (
          <DataTable
            rows={trash.data!.trash}
            defaultSort="deletedAt"
            defaultDescending
            filters={[{ key: 'tableLabel', label: 'Tipo', options: [...new Set(trash.data!.trash.map((row) => row.tableLabel))] }]}
            columns={[
              { key: 'tableLabel', label: 'Tipo' },
              { key: 'summary', label: 'Registro', render: (row) => <span className="block max-w-96 truncate">{row.summary || row.recordId}</span> },
              { key: 'technicianName', label: 'Técnico', render: (row) => row.technicianName ?? '—' },
              { key: 'deletedAt', label: 'Excluído em', render: (row) => date(row.deletedAt, true) },
              { key: 'deletedByName', label: 'Por', render: (row) => row.deletedByName ?? '—' },
            ]}
            actions={(row) => <button onClick={() => setRestoring(row)}>Restaurar</button>}
            emptyText="A lixeira está vazia."
          />
        )}
      </Panel>
      <Panel title="Backups diários">
        <Empty
          title="Rotina de backup não configurada"
          text="Os backups diários dependem do armazenamento externo e do worker em execução (veja Operação). Até lá, use a exportação completa acima."
        />
      </Panel>
      {restoring && (
        <Confirm
          title="Restaurar registro?"
          description={`${restoring.tableLabel}: ${restoring.summary || restoring.recordId}. Ele volta a aparecer no sistema da empresa.`}
          onClose={() => setRestoring(null)}
          onConfirm={async () => {
            try {
              await api(`/organizations/${organizationId}/data`, { body: { table: restoring.table, recordId: restoring.recordId } });
              notify('Registro restaurado.');
              trash.reload();
            } catch (reason) {
              notify(errorMessage(reason));
            }
          }}
        />
      )}
    </>
  );
}

export function OrganizationBugsTab({ organizationId }: { organizationId: string }) {
  const bugs = useResource<{ bugs: BugRow[] }>(`/bugs?organizationId=${organizationId}`);
  if (bugs.loading && !bugs.data) return <Loading />;
  if (bugs.error) return <ErrorState message={bugs.error} onRetry={bugs.reload} />;
  return (
    <Panel title="Reports desta organização">
      <BugTable bugs={bugs.data!.bugs} showOrganization={false} />
    </Panel>
  );
}

