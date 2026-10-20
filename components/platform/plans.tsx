'use client';

import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { Plan, PlanLimits } from '@/lib/plans';
import { api, money, useResource } from './api';
import { Badge, Confirm, DataTable, Editor, ErrorState, Loading, Panel, Title, type Field, type FormValues } from './ui';
import { useNotify } from './notice';

type PlanWithUsage = Plan & { activeSubscriptions: number };
type Feature = { key: string; name: string; core: boolean; scope: 'general' | 'custom'; archived: boolean };

const LIMIT_FIELDS: Array<{ key: keyof PlanLimits; label: string }> = [
  { key: 'maxUsers', label: 'Usuários ativos' },
  { key: 'storageMb', label: 'Armazenamento (MB)' },
  { key: 'portoRunsMonth', label: 'Execuções Porto / mês' },
];

const PRICE_KEYS = ['monthlyPrice', 'annualPrice', 'extraTechnicianPrice', 'includedTechnicians'] as const;

/** Empty field = unlimited (null). */
const nullable = (value: unknown) => (value === '' || value === null || value === undefined ? null : Number(value));

function planFields(features: Feature[], isNew: boolean): Field[] {
  return [
    ...(isNew ? [{ key: 'key', label: 'Chave (não muda depois)', required: true, hint: 'Letras minúsculas, números e "_". Ex.: premium' }] : []),
    { key: 'name', label: 'Nome', required: true },
    { key: 'description', label: 'Descrição curta' },
    { key: 'featured', label: 'Mais escolhido', type: 'checkbox' },
    { key: 'displayOrder', label: 'Ordem de exibição', type: 'number' },
    { key: 'monthlyPrice', label: 'Preço mensal (R$)', type: 'number', required: true },
    { key: 'annualPrice', label: 'Preço anual (R$)', type: 'number', required: true },
    { key: 'extraTechnicianPrice', label: 'Técnico extra (R$ / mês)', type: 'number' },
    { key: 'setupFee', label: 'Implantação (R$)', type: 'number' },
    { key: 'includedTechnicians', label: 'Técnicos incluídos', type: 'number' },
    { key: 'onRequest', label: 'Sob consulta / Fale conosco', type: 'checkbox' },
    { key: 'visible', label: 'Visível no site', type: 'checkbox' },
    ...LIMIT_FIELDS.map((limit) => ({ key: `limit-${limit.key}`, label: limit.label, type: 'number' as const, hint: 'Vazio = ilimitado' })),
    { key: 'aiMonthlyCredits', label: 'Cota mensal de créditos de IA', type: 'number' },
    { key: 'aiBonusCredits', label: 'Bônus de entrada de IA', type: 'number' },
    { key: 'backupRetentionDays', label: 'Retenção de backups (dias)', type: 'number', hint: 'Vazio = ilimitado' },
    ...features
      .filter((feature) => !feature.core)
      .map((feature) => ({ key: `feature-${feature.key}`, label: feature.name, type: 'checkbox' as const })),
  ];
}

function toForm(plan: PlanWithUsage | null, features: Feature[]): FormValues {
  if (!plan) {
    return {
      key: '',
      name: '',
      description: '',
      featured: false,
      displayOrder: 10,
      monthlyPrice: 0,
      annualPrice: 0,
      extraTechnicianPrice: 0,
      setupFee: 0,
      includedTechnicians: 5,
      onRequest: false,
      visible: true,
      aiMonthlyCredits: 0,
      aiBonusCredits: 0,
      backupRetentionDays: 90,
    };
  }
  return {
    name: plan.name,
    description: plan.description ?? '',
    featured: plan.featured,
    displayOrder: plan.displayOrder,
    monthlyPrice: plan.monthlyPrice,
    annualPrice: plan.annualPrice,
    extraTechnicianPrice: plan.extraTechnicianPrice,
    setupFee: plan.setupFee,
    includedTechnicians: plan.includedTechnicians,
    onRequest: plan.onRequest,
    visible: plan.visible,
    aiMonthlyCredits: plan.aiMonthlyCredits,
    aiBonusCredits: plan.aiBonusCredits,
    backupRetentionDays: plan.backupRetentionDays ?? '',
    ...Object.fromEntries(LIMIT_FIELDS.map((limit) => [`limit-${limit.key}`, plan.limits[limit.key] ?? ''])),
    ...Object.fromEntries(features.filter((feature) => !feature.core).map((feature) => [`feature-${feature.key}`, plan.features.includes(feature.key as Plan['features'][number])])),
  };
}

function toBody(values: FormValues, features: Feature[]) {
  return {
    name: String(values.name ?? '').trim(),
    description: String(values.description ?? '').trim(),
    featured: Boolean(values.featured),
    displayOrder: Number(values.displayOrder || 0),
    monthlyPrice: Number(values.monthlyPrice || 0),
    annualPrice: Number(values.annualPrice || 0),
    extraTechnicianPrice: Number(values.extraTechnicianPrice || 0),
    setupFee: Number(values.setupFee || 0),
    includedTechnicians: Number(values.includedTechnicians || 0),
    onRequest: Boolean(values.onRequest),
    visible: Boolean(values.visible),
    aiMonthlyCredits: Number(values.aiMonthlyCredits || 0),
    aiBonusCredits: Number(values.aiBonusCredits || 0),
    backupRetentionDays: nullable(values.backupRetentionDays),
    limits: Object.fromEntries(LIMIT_FIELDS.map((limit) => [limit.key, nullable(values[`limit-${limit.key}`])])),
    // Core features are part of every plan.
    features: features.filter((feature) => feature.core || values[`feature-${feature.key}`]).map((feature) => feature.key),
  };
}

export function Plans() {
  const notify = useNotify();
  const plans = useResource<{ plans: PlanWithUsage[] }>('/plans');
  const features = useResource<{ features: Feature[] }>('/features');
  const [editing, setEditing] = useState<PlanWithUsage | 'new' | null>(null);
  const [pending, setPending] = useState<FormValues | null>(null);
  const [archive, setArchive] = useState<PlanWithUsage | null>(null);

  if ((plans.loading && !plans.data) || (features.loading && !features.data)) return <Loading />;
  if (plans.error || features.error) return <ErrorState message={plans.error || features.error} onRetry={() => { plans.reload(); features.reload(); }} />;

  const allPlans = plans.data!.plans;
  // Plans can only include general features; custom ones are granted per organization.
  const catalog = features.data!.features.filter((feature) => feature.scope === 'general' && !feature.archived);
  const featureName = (key: string) => catalog.find((feature) => feature.key === key)?.name ?? key;
  const current = editing === 'new' ? null : editing;

  async function save(values: FormValues, applyPriceChange: 'new_only' | 'next_cycle' = 'new_only') {
    if (editing === 'new') {
      await api('/plans', { body: { key: String(values.key ?? '').trim(), ...toBody(values, catalog) } });
      notify('Plano criado.');
    } else if (current) {
      const result = await api<{ affectedSubscriptions: number }>(`/plans/${current.id}`, {
        method: 'PATCH',
        body: { ...toBody(values, catalog), applyPriceChange },
      });
      notify(applyPriceChange === 'next_cycle' ? `Plano salvo. Novos preços aplicados a ${result.affectedSubscriptions} assinatura(s).` : 'Plano salvo.');
    }
    setEditing(null);
    setPending(null);
    plans.reload();
  }

  return (
    <>
      <Title
        title="Planos que acompanham o crescimento."
        description="Preços, limites e recursos em um só lugar. O preço de quem já assina só muda se você aplicar a todos."
        action={
          <button className="nr-btn primary" onClick={() => setEditing('new')}>
            <Plus size={16} />
            Novo plano
          </button>
        }
      />
      <div className="nr-grid-3">
        {allPlans
          .filter((plan) => !plan.archived)
          .map((plan) => (
            <Panel key={plan.id} className={`nr-plan ${plan.featured ? 'featured' : ''}`}>
              <div className="flex items-center justify-between">
                <h3>{plan.name}</h3>
                {plan.featured && <Badge>Mais escolhido</Badge>}
              </div>
              <p className="mt-2">{plan.description}</p>
              <div className="nr-price">{plan.onRequest ? 'Sob consulta' : money(plan.monthlyPrice)}</div>
              <small>
                {plan.onRequest
                  ? 'Uma proposta para cada operação'
                  : `${money(plan.annualPrice)} / ano · economia de ${money(plan.monthlyPrice * 12 - plan.annualPrice)}`}
              </small>
              <ul>
                <li>
                  <Check size={14} />
                  {plan.includedTechnicians ? `Até ${plan.includedTechnicians} técnicos${plan.extraTechnicianPrice ? ` (+${money(plan.extraTechnicianPrice)}/extra)` : ''}` : 'Técnicos sob consulta'}
                </li>
                <li>
                  <Check size={14} />
                  {plan.limits.storageMb ? `${plan.limits.storageMb} MB de armazenamento` : 'Armazenamento ilimitado'}
                </li>
                <li>
                  <Check size={14} />
                  Backup: {plan.backupRetentionDays ? `${plan.backupRetentionDays} dias` : 'ilimitado'}
                </li>
                <li>
                  <Check size={14} />
                  {plan.activeSubscriptions} organizações ativas
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap gap-1">
                {plan.features.map((feature) => (
                  <Badge key={feature}>{featureName(feature)}</Badge>
                ))}
              </div>
              <button className="nr-btn mt-4" onClick={() => setEditing(plan)}>
                Editar plano
              </button>
            </Panel>
          ))}
      </div>
      <Panel title="Todos os planos">
        <DataTable
          rows={allPlans.map((plan) => ({ ...plan, status: plan.archived ? 'Arquivado' : 'Ativo', visibility: plan.visible ? 'Sim' : 'Não' }))}
          defaultSort="displayOrder"
          filters={[
            { key: 'status', label: 'Estado', options: ['Ativo', 'Arquivado'] },
            { key: 'visibility', label: 'Visível no site', options: ['Sim', 'Não'] },
          ]}
          columns={[
            { key: 'name', label: 'Plano' },
            { key: 'monthlyPrice', label: 'Mensal', render: (plan) => (plan.onRequest ? 'Sob consulta' : money(plan.monthlyPrice)) },
            { key: 'annualPrice', label: 'Anual', render: (plan) => (plan.onRequest ? 'Sob consulta' : money(plan.annualPrice)) },
            { key: 'activeSubscriptions', label: 'Organizações ativas' },
            { key: 'visibility', label: 'Site' },
            { key: 'status', label: 'Estado', render: (plan) => <Badge>{plan.status}</Badge> },
          ]}
          actions={(plan) => (
            <>
              <button onClick={() => setEditing(plan)}>Editar</button>
              <button onClick={() => setArchive(plan)}>{plan.archived ? 'Restaurar' : 'Arquivar'}</button>
            </>
          )}
        />
      </Panel>

      {editing && !pending && (
        <Editor
          title={editing === 'new' ? 'Novo plano' : `Editar plano · ${editing.name}`}
          description={
            current
              ? `Economia anual atual: ${money(current.monthlyPrice * 12 - current.annualPrice)}. Técnicos, OS, horas, escala e folha fazem parte de todos os planos.`
              : 'Técnicos, OS, horas, escala e folha fazem parte de todos os planos.'
          }
          fields={planFields(catalog, editing === 'new')}
          initial={toForm(current, catalog)}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            const priceChanged = current && current.activeSubscriptions > 0 && PRICE_KEYS.some((key) => Number(values[key] || 0) !== Number(current[key]));
            if (priceChanged) {
              setPending(values);
              return false;
            }
            await save(values);
          }}
        />
      )}
      {pending && current && (
        <Editor
          title="Confirmar mudança de preço"
          description={`Mensal: ${money(current.monthlyPrice)} → ${money(Number(pending.monthlyPrice))}. Anual: ${money(current.annualPrice)} → ${money(Number(pending.annualPrice))}. ${current.activeSubscriptions} organização(ões) usam este plano.`}
          fields={[
            {
              key: 'scope',
              label: 'Aplicar novos preços',
              type: 'select',
              required: true,
              options: [
                { value: 'new_only', label: 'Somente novas assinaturas' },
                { value: 'next_cycle', label: 'Todos a partir do próximo ciclo' },
              ],
            },
          ]}
          initial={{ scope: 'new_only' }}
          onClose={() => {
            setPending(null);
            setEditing(null);
          }}
          onSave={(values) => save(pending, values.scope === 'next_cycle' ? 'next_cycle' : 'new_only')}
          submit="Confirmar novos preços"
        />
      )}
      {archive && (
        <Confirm
          title={`${archive.archived ? 'Restaurar' : 'Arquivar'} ${archive.name}?`}
          description="As assinaturas atuais continuam iguais. Planos arquivados deixam de aparecer para novas contratações."
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api(`/plans/${archive.id}`, { method: 'PATCH', body: { archived: !archive.archived } });
            notify(archive.archived ? 'Plano restaurado.' : 'Plano arquivado.');
            plans.reload();
          }}
        />
      )}
    </>
  );
}
