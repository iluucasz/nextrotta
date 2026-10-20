'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, date, money, useResource } from './api';
import { useNotify } from './notice';
import { Badge, Confirm, DataTable, Editor, Empty, ErrorState, Loading, Panel, Title, type Field, type FormValues } from './ui';

type Coupon = {
  id: string;
  code: string;
  kind: 'percent' | 'fixed';
  value: number;
  durationCycles: number;
  expiresOn: string | null;
  planKeys: string[];
  maxUses: number | null;
  uses: number;
  activeUses: number;
  status: 'active' | 'expired' | 'exhausted' | 'archived';
  createdAt: string;
};

type Redemption = {
  id: string;
  organizationId: string;
  organizationName: string;
  appliedAt: string;
  endsOn: string | null;
  endedAt: string | null;
  endReason: 'expired' | 'removed' | null;
};

type PlanOption = { id: string; key: string; name: string; archived: boolean };

export const COUPON_STATUS_LABELS: Record<Coupon['status'], string> = {
  active: 'Ativo',
  expired: 'Vencido',
  exhausted: 'Esgotado',
  archived: 'Arquivado',
};

const KIND_LABELS = { percent: 'Percentual', fixed: 'Valor fixo' };

export const couponValue = (coupon: Pick<Coupon, 'kind' | 'value'>) =>
  coupon.kind === 'percent' ? `${String(coupon.value).replace('.', ',')}%` : money(coupon.value);

const cyclesLabel = (cycles: number) => (cycles === 0 ? 'Permanente' : `${cycles} ciclo${cycles > 1 ? 's' : ''}`);

function couponFields(plans: PlanOption[], isNew: boolean): Field[] {
  return [
    ...(isNew ? [{ key: 'code', label: 'Código', required: true, hint: 'Letras, números, "-" ou "_". Ex.: BEMVINDO10' } as Field] : []),
    { key: 'kind', label: 'Tipo', type: 'select', required: true, options: [{ value: 'percent', label: 'Percentual' }, { value: 'fixed', label: 'Valor fixo (R$ por ciclo)' }] },
    { key: 'value', label: 'Valor', type: 'number', required: true },
    { key: 'durationCycles', label: 'Duração em ciclos (0 = permanente)', type: 'number', required: true },
    { key: 'expiresOn', label: 'Validade para aplicar (vazio = sem validade)', type: 'date' },
    { key: 'maxUses', label: 'Limite de usos (vazio = ilimitado)', type: 'number', min: 1 },
    ...plans.filter((plan) => !plan.archived).map((plan) => ({ key: `plan-${plan.key}`, label: `Vale para o plano ${plan.name}`, type: 'checkbox' as const })),
  ];
}

function toForm(coupon: Coupon | null, plans: PlanOption[]): FormValues {
  return {
    ...(coupon ? {} : { code: '' }),
    kind: coupon?.kind ?? 'percent',
    value: coupon?.value ?? 10,
    durationCycles: coupon?.durationCycles ?? 3,
    expiresOn: coupon?.expiresOn ?? '',
    maxUses: coupon?.maxUses ?? '',
    ...Object.fromEntries(plans.map((plan) => [`plan-${plan.key}`, coupon ? coupon.planKeys.includes(plan.key) : false])),
  };
}

function toBody(values: FormValues, plans: PlanOption[]) {
  return {
    ...('code' in values ? { code: String(values.code) } : {}),
    kind: values.kind,
    value: Number(values.value),
    durationCycles: Number(values.durationCycles),
    expiresOn: values.expiresOn || null,
    maxUses: values.maxUses === '' ? null : Number(values.maxUses),
    // None checked = every plan.
    planKeys: plans.filter((plan) => values[`plan-${plan.key}`]).map((plan) => plan.key),
  };
}

function validate(values: FormValues) {
  if (values.kind === 'percent' && Number(values.value) > 100) return 'O percentual não pode passar de 100%.';
  if (Number(values.value) <= 0) return 'Informe um valor maior que zero.';
  return '';
}

export function Coupons({ id }: { id?: string }) {
  const notify = useNotify();
  const coupons = useResource<{ coupons: Coupon[] }>('/coupons');
  const plans = useResource<{ plans: PlanOption[] }>('/plans');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const [archive, setArchive] = useState<Coupon | null>(null);

  if (id) return <CouponDetail id={id} plans={plans.data?.plans ?? []} />;
  if ((coupons.loading && !coupons.data) || (plans.loading && !plans.data)) return <Loading />;
  if (coupons.error || plans.error) return <ErrorState message={coupons.error || plans.error} onRetry={() => { coupons.reload(); plans.reload(); }} />;

  const planList = plans.data!.plans;
  const planName = (key: string) => planList.find((plan) => plan.key === key)?.name ?? key;
  const rows = coupons.data!.coupons.map((coupon) => ({
    ...coupon,
    kindText: KIND_LABELS[coupon.kind],
    statusText: COUPON_STATUS_LABELS[coupon.status],
    plansText: coupon.planKeys.length ? coupon.planKeys.map(planName).join(', ') : 'Todos',
  }));

  return (
    <>
      <Title
        title="Cupons e descontos"
        description="Condições especiais para relações de longo prazo. O cupom é aplicado na aba Assinatura de cada organização."
        action={<button className="nr-btn primary" onClick={() => setEditing('new')}><Plus size={15} />Novo cupom</button>}
      />
      <Panel title="Todos os cupons">
        <DataTable
          rows={rows}
          defaultSort="createdAt"
          defaultDescending
          filters={[
            { key: 'statusText', label: 'Estado', options: Object.values(COUPON_STATUS_LABELS) },
            { key: 'kindText', label: 'Tipo', options: Object.values(KIND_LABELS) },
          ]}
          columns={[
            { key: 'code', label: 'Código', render: (row) => <Link href={`/plataforma/cupons/${row.id}`}>{row.code}</Link> },
            { key: 'kindText', label: 'Tipo' },
            { key: 'value', label: 'Desconto', render: (row) => couponValue(row) },
            { key: 'durationCycles', label: 'Duração', render: (row) => cyclesLabel(row.durationCycles) },
            { key: 'expiresOn', label: 'Validade', render: (row) => (row.expiresOn ? date(row.expiresOn) : 'Sem validade') },
            { key: 'plansText', label: 'Planos' },
            { key: 'uses', label: 'Usos', render: (row) => `${row.uses}${row.maxUses ? ` de ${row.maxUses}` : ''}` },
            { key: 'activeUses', label: 'Em uso agora' },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
          ]}
          actions={(row) => (
            <>
              {row.status !== 'archived' && <button onClick={() => setEditing(row)}>Editar</button>}
              <button onClick={() => setArchive(row)}>{row.status === 'archived' ? 'Restaurar' : 'Arquivar'}</button>
            </>
          )}
          emptyText="Nenhum cupom cadastrado. Crie o primeiro para oferecer uma condição especial."
        />
      </Panel>
      {editing && (
        <Editor
          title={editing === 'new' ? 'Novo cupom' : `Editar ${editing.code}`}
          description={editing === 'new' ? 'Sem nenhum plano marcado, o cupom vale para todos.' : 'As mudanças valem para as próximas aplicações; quem já usa mantém as condições atuais.'}
          fields={couponFields(planList, editing === 'new')}
          initial={toForm(editing === 'new' ? null : editing, planList)}
          validate={validate}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            if (editing === 'new') await api('/coupons', { body: toBody(values, planList) });
            else await api(`/coupons/${editing.id}`, { method: 'PATCH', body: toBody(values, planList) });
            notify(editing === 'new' ? 'Cupom criado.' : 'Cupom atualizado.');
            coupons.reload();
          }}
        />
      )}
      {archive && (
        <Confirm
          title={`${archive.status === 'archived' ? 'Restaurar' : 'Arquivar'} ${archive.code}?`}
          description={archive.status === 'archived' ? 'O cupom volta a poder ser aplicado.' : 'O cupom deixa de poder ser aplicado. Quem já usa mantém o desconto até o fim dos ciclos.'}
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api(`/coupons/${archive.id}`, { method: 'PATCH', body: { archived: archive.status !== 'archived' } });
            notify(archive.status === 'archived' ? 'Cupom restaurado.' : 'Cupom arquivado.');
            coupons.reload();
          }}
        />
      )}
    </>
  );
}

function CouponDetail({ id, plans }: { id: string; plans: PlanOption[] }) {
  const detail = useResource<{ coupon: Coupon; redemptions: Redemption[] }>(`/coupons/${id}`);

  if (detail.loading && !detail.data) return <Loading />;
  if (detail.error) return <ErrorState message={detail.error} onRetry={detail.reload} />;

  const { coupon, redemptions } = detail.data!;
  const planName = (key: string) => plans.find((plan) => plan.key === key)?.name ?? key;

  return (
    <>
      <Title title={coupon.code} description="Condições do cupom e quem o recebeu." action={<Link className="nr-btn" href="/plataforma/cupons">Voltar à lista</Link>} />
      <Panel title="Detalhes">
        <div className="nr-pad nr-info-grid">
          {[
            ['Tipo', KIND_LABELS[coupon.kind]],
            ['Desconto', couponValue(coupon)],
            ['Duração', cyclesLabel(coupon.durationCycles)],
            ['Validade', coupon.expiresOn ? date(coupon.expiresOn) : 'Sem validade'],
            ['Planos', coupon.planKeys.length ? coupon.planKeys.map(planName).join(', ') : 'Todos'],
            ['Usos', `${coupon.uses}${coupon.maxUses ? ` de ${coupon.maxUses}` : ' (sem limite)'}`],
            ['Criado em', date(coupon.createdAt, true)],
            ['Estado', <Badge key="status">{COUPON_STATUS_LABELS[coupon.status]}</Badge>],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Organizações que usaram">
        {redemptions.length ? (
          <DataTable
            rows={redemptions.map((row) => ({
              ...row,
              situation: row.endedAt ? (row.endReason === 'expired' ? 'Encerrado (fim dos ciclos)' : 'Removido') : 'Em uso',
            }))}
            columns={[
              { key: 'organizationName', label: 'Organização', render: (row) => <Link href={`/plataforma/organizacoes/${row.organizationId}`}>{row.organizationName}</Link> },
              { key: 'appliedAt', label: 'Aplicado em', render: (row) => date(row.appliedAt, true) },
              { key: 'endsOn', label: 'Vale até', render: (row) => (row.endsOn ? date(row.endsOn) : 'Permanente') },
              { key: 'situation', label: 'Situação', render: (row) => <Badge>{row.situation}</Badge> },
            ]}
          />
        ) : (
          <Empty title="Ninguém usou este cupom ainda" text="Aplique-o na aba Assinatura de uma organização." />
        )}
      </Panel>
    </>
  );
}
