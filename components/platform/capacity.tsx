'use client';

import { useState } from 'react';
import { api, money, ORGANIZATION_STATUS_LABELS, useResource, type OrganizationStatusKey } from './api';
import { useNotify } from './notice';
import { DataTable, Editor, ErrorState, Loading, Metric, Panel } from './ui';

type Unit = 'minutes' | 'mb' | 'messages' | 'money';

type Resource = {
  key: 'porto_night' | 'vps_memory' | 'storage' | 'database' | 'whatsapp' | 'ai';
  label: string;
  unit: Unit;
  capacity: number | null;
  committed: number | null;
  unlimited: number;
  used: number;
  note: string;
  status?: { tone: 'neutral' | 'warn' | 'bad'; text: string } | null;
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatusKey;
  planName: string | null;
  runsAutomations: boolean;
  storage: { usedMb: number; limitMb: number | null };
  users: { active: number; limit: number | null };
  technicians: { active: number; included: number | null };
  whatsapp: { feature: boolean; connected: boolean; sentMonth: number; limitMonth: number | null };
  porto: { feature: boolean; automationEnabled: boolean; runsMonth: number; limitMonth: number | null; minutesPerNight: number | null; nightsMeasured: number; estimatedMinutes: number };
  ai: { feature: boolean; monthlyCredits: number; creditsUsedMonth: number; costMonth: number };
};

type Capacity = {
  resources: Resource[];
  organizations: Organization[];
  totals: { organizations: number; runningAutomations: number; withPorto: number; portoRoom: number };
  settings: {
    storageGb: number | null;
    storageLot: { sizeGb: number; reservePercent: number } | null;
    databaseGb: number | null;
    aiMonthlyBudget: number | null;
    portoBaseMinutes: number;
    portoMinutesPerTechnician: number;
    browserMemoryMb: number;
    pools: { whatsappMessagesMonth: number | null; portoRunsMonth: number | null; maxUsers: number | null };
  };
  maxBrowsers: number;
};

/** What the committed bar is called for each resource. */
const COMMITTED_LABELS: Record<Resource['key'], string> = {
  porto_night: 'Reservado pelas empresas',
  vps_memory: 'Previsto no pico',
  storage: 'Distribuído às empresas',
  database: 'Prometido nos planos',
  whatsapp: 'Distribuído às empresas',
  ai: 'Previsto pelos planos',
};

const RED = '#bd6150';
/** Literal so Tailwind generates it. */
const OVER_CLASS = 'text-[#bd6150]';
const YELLOW = '#d2a54a';

export function amount(value: number, unit: Unit) {
  if (unit === 'money') return money(value);
  if (unit === 'minutes') return `${Math.round(value).toLocaleString('pt-BR')} min`;
  if (unit === 'messages') return value.toLocaleString('pt-BR');
  if (value > 0 && value < 1) return `${Math.max(1, Math.round(value * 1024)).toLocaleString('pt-BR')} KB`;
  return value >= 1024 ? `${(value / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB` : `${Math.round(value).toLocaleString('pt-BR')} MB`;
}

/** Overall state of a resource: what was promised (or projected) against what the platform has. */
function verdict(resource: Resource): { tone: 'good' | 'warn' | 'bad' | 'neutral'; text: string } {
  if (resource.status) return resource.status;
  if (resource.capacity === null) {
    if (resource.key === 'whatsapp') return { tone: 'neutral', text: 'Sem total definido' };
    return { tone: 'warn', text: 'Capacidade não informada' };
  }
  const reference = Math.max(resource.committed ?? 0, resource.used);
  const ratio = resource.capacity > 0 ? reference / resource.capacity : 0;
  if (ratio > 1) return { tone: 'bad', text: 'Prometido além do que tem' };
  if (ratio >= 0.7) return { tone: 'warn', text: 'Perto do limite' };
  if (resource.unlimited > 0) return { tone: 'warn', text: `${resource.unlimited} com plano ilimitado` };
  return { tone: 'good', text: 'Com folga' };
}

export function Bar({ label, value, capacity, unit }: { label: string; value: number; capacity: number | null; unit: Unit }) {
  const percent = capacity ? (value / capacity) * 100 : null;
  const color = percent === null ? undefined : percent > 100 ? RED : percent >= 70 ? YELLOW : undefined;
  return (
    <div>
      <div className="flex justify-between gap-3 text-[13px] text-[#718078]">
        <span>{label}</span>
        <span className="text-[#213b31]">
          {amount(value, unit)}
          {capacity !== null && <> de {amount(capacity, unit)} · {Math.round(percent ?? 0)}%</>}
        </span>
      </div>
      {capacity !== null && (
        <div className="nr-progress">
          <span style={{ width: `${Math.min(100, percent ?? 0)}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

function ResourceRow({ resource }: { resource: Resource }) {
  const state = verdict(resource);
  return (
    <div className="border-b border-[#f0f3ef] py-5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="text-[15px] font-semibold">{resource.label}</strong>
          <small className="mt-1 block max-w-3xl text-[13px] text-[#7a897e]">{resource.note}</small>
        </div>
        <span className={`nr-badge ${state.tone}`}>
          <i />
          {state.text}
        </span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {resource.committed !== null ? (
          <Bar label={COMMITTED_LABELS[resource.key]} value={resource.committed} capacity={resource.capacity} unit={resource.unit} />
        ) : (
          <div className="text-[13px] text-[#718078]">{resource.key === 'database' ? 'Os planos não prometem espaço de banco.' : resource.key === 'whatsapp' ? 'Sem limite: cada empresa usa o próprio número.' : 'Previsão indisponível por enquanto.'}</div>
        )}
        <Bar label={resource.unit === 'messages' || resource.unit === 'money' ? 'Usado neste mês' : 'Em uso'} value={resource.used} capacity={resource.capacity} unit={resource.unit} />
      </div>
    </div>
  );
}

/** Operação → Capacidade: what the platform has, what each plan promised, what is really used. */
export function CapacityTab() {
  const notify = useNotify();
  const data = useResource<Capacity>('/capacity');
  const [editing, setEditing] = useState(false);
  // Bumped when the totals change, so the allocation panel reloads its free amount.
  const [allocationVersion, setAllocationVersion] = useState(0);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  const capacity = data.data!;
  const byKey = Object.fromEntries(capacity.resources.map((resource) => [resource.key, resource])) as Record<Resource['key'], Resource>;
  const porto = byKey.porto_night;
  const memory = byKey.vps_memory;
  const storage = byKey.storage;

  return (
    <>
      <div className="nr-metrics">
        <Metric label="Empresas atendidas" value={capacity.totals.organizations} detail={`${capacity.totals.runningAutomations} com automações rodando`} />
        <Metric
          label="Janela do Porto reservada"
          value={porto.capacity ? `${Math.round(((porto.committed ?? 0) / porto.capacity) * 100)}%` : '—'}
          detail={`${capacity.totals.withPorto} empresa(s) · cabem mais ~${capacity.totals.portoRoom}`}
          accent
        />
        <Metric
          label="Memória no pico da noite"
          value={memory.capacity && memory.committed !== null ? `${amount(memory.committed, 'mb')}` : '—'}
          detail={memory.capacity ? `de ${amount(memory.capacity, 'mb')} da VPS` : 'Sem métricas da VPS'}
        />
        <Metric
          label="Armazenamento distribuído"
          value={amount(storage.committed ?? 0, 'mb')}
          detail={storage.capacity !== null ? `de ${amount(storage.capacity, 'mb')} contratados` : storage.status?.text ?? 'Contratado: não informado'}
        />
      </div>

      <Panel
        title="O que a plataforma tem × o que foi prometido"
        description="Cada recurso com o total disponível, a soma do que as empresas recebem (plano ou ajuste seu) e o uso real. Vermelho: você distribuiu mais do que tem."
        action={<button className="nr-btn" onClick={() => setEditing(true)}>Definir capacidades</button>}
      >
        <div className="nr-pad">
          {capacity.resources.map((resource) => (
            <ResourceRow key={resource.key} resource={resource} />
          ))}
        </div>
      </Panel>

      <AllocationPanel key={allocationVersion} onChanged={data.reload} />

      {editing && (
        <Editor
          title="Definir capacidades"
          description="O que a plataforma tem fora da VPS (não dá para ler automaticamente) e as estimativas da noite do Porto. Deixe vazio o que ainda não sabe."
          fields={[
            { key: 'storageGb', label: 'Armazenamento: teto fixo (GB)', type: 'number', hint: 'Opcional; vale mais que os containers de Operação → Armazenamento. Vazio: a soma dos containers (ou o limite do Hobby da Vercel).' },
            { key: 'portoRunsMonth', label: 'Total de execuções do Porto por mês', type: 'number', hint: 'Vazio = sem total.' },
            { key: 'maxUsers', label: 'Total de usuários ativos', type: 'number', hint: 'Vazio = sem total.' },
            { key: 'databaseGb', label: 'Banco de dados contratado (GB)', type: 'number', hint: 'Vazio: o limite que o próprio Neon informa.' },
            { key: 'aiMonthlyBudget', label: 'Orçamento mensal de IA (R$)', type: 'number', hint: 'Quanto você aceita gastar com o DeepSeek por mês.' },
            { key: 'portoBaseMinutes', label: 'Porto: minutos fixos por empresa (por noite)', type: 'number', required: true, hint: 'Login e importação de horas. Medido: ~4 min (2 dias × ~2 min).' },
            { key: 'portoMinutesPerTechnician', label: 'Porto: minutos por técnico (por noite)', type: 'number', required: true, hint: 'Escala de cada técnico. Medido: ~1,2 min (68 s). Só vale para quem ainda não tem tempo medido.' },
            { key: 'browserMemoryMb', label: 'Memória por navegador do Porto (MB)', type: 'number', required: true, min: 100, hint: 'Quanto um navegador ocupa na VPS enquanto roda. Padrão: 800.' },
          ]}
          initial={{
            storageGb: capacity.settings.storageGb ?? '',
            databaseGb: capacity.settings.databaseGb ?? '',
            aiMonthlyBudget: capacity.settings.aiMonthlyBudget ?? '',
            portoRunsMonth: capacity.settings.pools.portoRunsMonth ?? '',
            maxUsers: capacity.settings.pools.maxUsers ?? '',
            portoBaseMinutes: capacity.settings.portoBaseMinutes,
            portoMinutesPerTechnician: capacity.settings.portoMinutesPerTechnician,
            browserMemoryMb: capacity.settings.browserMemoryMb,
          }}
          onClose={() => setEditing(false)}
          onSave={async (values) => {
            const optional = (value: unknown) => (value === '' || value === undefined ? null : Number(value));
            await api('/settings', {
              method: 'PUT',
              body: {
                capacity: {
                  storageGb: optional(values.storageGb),
                  databaseGb: optional(values.databaseGb),
                  aiMonthlyBudget: optional(values.aiMonthlyBudget),
                  portoBaseMinutes: Number(values.portoBaseMinutes),
                  portoMinutesPerTechnician: Number(values.portoMinutesPerTechnician),
                  browserMemoryMb: Number(values.browserMemoryMb),
                  pools: {
                    whatsappMessagesMonth: null,
                    portoRunsMonth: optional(values.portoRunsMonth),
                    maxUsers: optional(values.maxUsers),
                  },
                },
              },
            });
            notify('Capacidades salvas.');
            data.reload();
            setAllocationVersion((version) => version + 1);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Distributing resources among organizations
// ---------------------------------------------------------------------------------------------

type ResourceKey = 'storageMb' | 'portoRunsMonth' | 'maxUsers';

type AllocationRow = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatusKey;
  planName: string;
  planValue: number | null;
  adjusted: boolean;
  allocated: number | null;
  used: number;
};

type Allocation = {
  resource: ResourceKey;
  label: string;
  unit: 'mb' | 'count';
  monthly: boolean;
  pool: number | null;
  allocated: number;
  unlimited: number;
  free: number | null;
  poolNote: string | null;
  used: number;
  unsubscribed: number;
  organizations: AllocationRow[];
};

const ALLOCATABLE: Array<{ key: ResourceKey; label: string }> = [
  { key: 'storageMb', label: 'Armazenamento' },
  { key: 'portoRunsMonth', label: 'Execuções do Porto por mês' },
  { key: 'maxUsers', label: 'Usuários ativos' },
];

function share(value: number | null, allocation: Pick<Allocation, 'unit'>) {
  if (value === null) return 'Sem limite';
  return allocation.unit === 'mb' ? amount(value, 'mb') : value.toLocaleString('pt-BR');
}

/** Storage is typed in GB and stored in MB; the rest are whole counts. */
function toStored(value: unknown, allocation: Pick<Allocation, 'unit'>) {
  const parsed = Number(value);
  return allocation.unit === 'mb' ? Math.round(parsed * 1024) : Math.round(parsed);
}

function fromStored(value: number, allocation: Pick<Allocation, 'unit'>) {
  return allocation.unit === 'mb' ? Math.round((value / 1024) * 100) / 100 : value;
}

function AllocationPanel({ onChanged }: { onChanged: () => void }) {
  const notify = useNotify();
  const [resource, setResource] = useState<ResourceKey>('storageMb');
  const data = useResource<Allocation>(`/allocation?resource=${resource}`);
  const [adjusting, setAdjusting] = useState<AllocationRow | null>(null);
  const [transferring, setTransferring] = useState<AllocationRow | null>(null);

  const picker = (
    <select aria-label="Recurso" value={resource} onChange={(event) => setResource(event.target.value as ResourceKey)}>
      {ALLOCATABLE.map((item) => (
        <option key={item.key} value={item.key}>
          {item.label}
        </option>
      ))}
    </select>
  );

  function changed(message: string) {
    notify(message);
    data.reload();
    onChanged();
  }

  const allocation = data.data;
  const unitLabel = allocation?.unit === 'mb' ? ' (GB)' : '';

  return (
    <Panel
      title="Distribuir recursos"
      description="Quanto cada empresa recebe do total da plataforma. Aumente, diminua, volte ao plano ou transfira de uma empresa para outra: nada passa do que está livre, nem fica abaixo do que a empresa já usa."
      action={picker}
    >
      {data.loading && !allocation ? (
        <Loading />
      ) : data.error || !allocation ? (
        <ErrorState message={data.error ?? 'Sem dados.'} onRetry={data.reload} />
      ) : (
        <>
          <div className="nr-pad">
            <div className="nr-metrics">
              <Metric
                label="Total da plataforma"
                value={share(allocation.pool, allocation)}
                detail={allocation.pool === null ? allocation.poolNote ?? 'Não definido: use "Definir capacidades"' : allocation.monthly ? 'Por mês' : 'Contratado'}
              />
              <Metric
                label="Distribuído"
                value={share(allocation.allocated, allocation)}
                detail={`${allocation.organizations.length} empresa(s)${allocation.unlimited ? ` · ${allocation.unlimited} sem limite` : ''}`}
              />
              <Metric
                label="Livre para distribuir"
                value={allocation.free === null ? '—' : allocation.free < 0 ? `−${share(-allocation.free, allocation)}` : share(allocation.free, allocation)}
                detail={allocation.free !== null && allocation.free < 0 ? 'Distribuído além do total' : 'Total − distribuído'}
                accent
              />
              <Metric label={allocation.monthly ? 'Usado neste mês' : 'Em uso'} value={share(allocation.used, allocation)} detail="Soma de todas as empresas" />
            </div>
            {allocation.pool !== null && (
              <Bar label="Distribuído do total" value={allocation.allocated} capacity={allocation.pool} unit={allocation.unit === 'mb' ? 'mb' : 'messages'} />
            )}
            {allocation.pool !== null && allocation.unlimited > 0 && (
              <p className="nr-alert mt-4">
                {allocation.unlimited} empresa(s) estão sem limite deste recurso e ficam fora da conta. Com um total definido, dê um valor a elas em “Ajustar”.
              </p>
            )}
            {allocation.unsubscribed > 0 && (
              <p className="mt-3 text-[13px] text-[#7a897e]">
                {allocation.unsubscribed} empresa(s) sem plano ativo não aparecem aqui: sem plano não há limites para distribuir.
              </p>
            )}
          </div>
          <DataTable
            rows={allocation.organizations.map((row) => ({ ...row, spare: row.allocated === null ? Number.MAX_SAFE_INTEGER : row.allocated - row.used }))}
            defaultSort="name"
            columns={[
              {
                key: 'name',
                label: 'Organização',
                render: (row) => (
                  <span>
                    {row.name}
                    <small>
                      {row.planName} · {ORGANIZATION_STATUS_LABELS[row.status] ?? row.status}
                    </small>
                  </span>
                ),
              },
              { key: 'planValue', label: 'O plano dá', render: (row) => share(row.planValue, allocation) },
              {
                key: 'allocated',
                label: 'Recebe',
                render: (row) => (
                  <span>
                    <strong className="font-semibold">{share(row.allocated, allocation)}</strong>
                    <small>{row.adjusted ? 'Ajustado por você' : 'Igual ao plano'}</small>
                  </span>
                ),
              },
              {
                key: 'used',
                label: allocation.monthly ? 'Usou no mês' : 'Usa',
                render: (row) => (
                  <span className={row.allocated !== null && row.used > row.allocated ? OVER_CLASS : ''}>
                    {share(row.used, allocation)}
                    {row.allocated ? <small>{Math.round((row.used / row.allocated) * 100)}% do que recebe</small> : null}
                  </span>
                ),
              },
              {
                key: 'spare',
                label: 'Pode ceder',
                render: (row) => (row.allocated === null ? '—' : share(Math.max(0, row.allocated - row.used), allocation)),
              },
            ]}
            actions={(row) => (
              <>
                <button onClick={() => setAdjusting(row)}>Ajustar</button>
                {allocation.organizations.length > 1 && <button onClick={() => setTransferring(row)}>Transferir</button>}
              </>
            )}
            emptyText="Nenhuma empresa com plano ativo."
          />
        </>
      )}

      {adjusting && allocation && (
        <Editor
          title={`Ajustar · ${adjusting.name}`}
          description={
            `${allocation.label}: recebe ${share(adjusting.allocated, allocation)} e usa ${share(adjusting.used, allocation)}` +
            `${allocation.monthly ? ' neste mês' : ''}. O plano ${adjusting.planName} dá ${share(adjusting.planValue, allocation)}.` +
            (allocation.free === null ? '' : ` Livre na plataforma: ${share(Math.max(0, allocation.free), allocation)}.`)
          }
          fields={[
            {
              key: 'mode',
              label: 'Quanto ela recebe',
              type: 'select',
              required: true,
              options: [
                { value: 'value', label: 'Um valor definido por mim' },
                { value: 'plan', label: `Igual ao plano (${share(adjusting.planValue, allocation)})` },
                { value: 'unlimited', label: 'Sem limite' },
              ],
            },
            { key: 'value', label: `Valor${unitLabel}`, type: 'number', hint: 'Só para "um valor definido por mim".' },
          ]}
          initial={{ mode: 'value', value: adjusting.allocated === null ? '' : fromStored(adjusting.allocated, allocation) }}
          reason
          submit="Salvar ajuste"
          validate={(values) => (values.mode === 'value' && values.value === '' ? 'Informe o valor.' : '')}
          onClose={() => setAdjusting(null)}
          onSave={async (values, reason) => {
            await api(`/allocation/${adjusting.id}`, {
              method: 'PUT',
              body: { resource, mode: values.mode, value: values.mode === 'value' ? toStored(values.value, allocation) : null, reason },
            });
            changed(`${adjusting.name}: ${allocation.label.toLowerCase()} ajustado.`);
          }}
        />
      )}

      {transferring && allocation && (
        <Editor
          title={`Transferir de ${transferring.name}`}
          description={
            transferring.allocated === null
              ? `${transferring.name} está sem limite: ajuste para um valor antes de transferir.`
              : `${transferring.name} recebe ${share(transferring.allocated, allocation)} e pode ceder até ${share(Math.max(0, transferring.allocated - transferring.used), allocation)}. O total da plataforma não muda.`
          }
          fields={[
            {
              key: 'to',
              label: 'Para a empresa',
              type: 'select',
              required: true,
              options: allocation.organizations
                .filter((row) => row.id !== transferring.id)
                .map((row) => ({ value: row.id, label: `${row.name} (recebe ${share(row.allocated, allocation)})` })),
            },
            { key: 'amount', label: `Quantidade${unitLabel}`, type: 'number', required: true },
          ]}
          initial={{ to: allocation.organizations.find((row) => row.id !== transferring.id)?.id ?? '', amount: '' }}
          reason
          submit="Transferir"
          onClose={() => setTransferring(null)}
          onSave={async (values, reason) => {
            await api('/allocation/transfer', {
              method: 'POST',
              body: { resource, from: transferring.id, to: values.to, amount: toStored(values.amount, allocation), reason },
            });
            changed('Transferência feita.');
          }}
        />
      )}
    </Panel>
  );
}
