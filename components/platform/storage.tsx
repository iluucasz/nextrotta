'use client';

import { useState } from 'react';
import { api, date, ORGANIZATION_STATUS_LABELS, useResource, type OrganizationStatusKey } from './api';
import { amount, Bar } from './capacity';
import { useNotify } from './notice';
import { Confirm, DataTable, Editor, ErrorState, Loading, Metric, Panel } from './ui';

type Container = {
  id: string;
  name: string;
  notes: string | null;
  sizeMb: number;
  reservePercent: number;
  usableMb: number;
  allocatedMb: number;
  usedMb: number;
  freeMb: number;
  createdAt: string;
  organizations: number;
};

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatusKey;
  planName: string | null;
  limitMb: number | null;
  usedMb: number;
  containerId: string | null;
  since: string | null;
};

type Storage = {
  containers: Container[];
  organizations: Organization[];
  defaults: { sizeGb: number; reservePercent: number } | null;
  totals: { sizeMb: number; usableMb: number; allocatedMb: number; usedMb: number };
  vercel: { plan: 'hobby' | 'pro' | 'enterprise' | null; hobbyRoomMb: number | null; blocked: string | null };
};

const mb = (value: number) => amount(value, 'mb');
const percent = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Operação → Armazenamento: the storage containers and which organization is in each. */
export function StorageTab() {
  const notify = useNotify();
  const data = useResource<Storage>('/storage');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Container | null>(null);
  const [archiving, setArchiving] = useState<Container | null>(null);
  const [moving, setMoving] = useState<Organization | null>(null);
  const [defaults, setDefaults] = useState(false);
  const [distributing, setDistributing] = useState(false);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  const storage = data.data!;
  const byId = new Map(storage.containers.map((container) => [container.id, container]));
  const withoutContainer = storage.organizations.filter((organization) => !organization.containerId);
  const placeable = withoutContainer.filter((organization) => organization.limitMb !== null);
  const hobbyOver = storage.vercel.hobbyRoomMb !== null && storage.totals.allocatedMb > storage.vercel.hobbyRoomMb;

  async function changed(promise: Promise<unknown>, message: string) {
    await promise;
    notify(message);
    data.reload();
  }

  return (
    <>
      <div className="nr-metrics">
        <Metric label="Containers" value={storage.containers.length} detail={`${mb(storage.totals.sizeMb)} no total`} accent />
        <Metric label="Para as empresas" value={mb(storage.totals.usableMb)} detail={`${mb(storage.totals.sizeMb - storage.totals.usableMb)} de folga`} />
        <Metric label="Distribuído" value={mb(storage.totals.allocatedMb)} detail={`${mb(Math.max(0, storage.totals.usableMb - storage.totals.allocatedMb))} livres nos containers`} />
        <Metric label="Em uso" value={mb(storage.totals.usedMb)} detail={`${withoutContainer.length} empresa(s) sem container`} />
      </div>

      {storage.vercel.blocked && <div className="nr-alert">Blob bloqueado pela Vercel: {storage.vercel.blocked}. Os envios de arquivo não funcionam.</div>}
      {storage.vercel.plan === 'hobby' && (
        <div className="nr-alert">
          A conta da Vercel está no Hobby: o teto real é {mb(storage.vercel.hobbyRoomMb ?? 0)} (o 1 GB da conta, dividido com os outros projetos)
          {hobbyOver ? `, e você já distribuiu ${mb(storage.totals.allocatedMb)}` : ''}. Os containers só valem de verdade com a conta no Pro.
        </div>
      )}

      <Panel
        title="Containers de armazenamento"
        description={
          'Cada container tem um tamanho e uma folga que nunca é distribuída. As empresas ficam dentro deles, cada uma na própria pasta da mesma loja do Vercel Blob, ' +
          'com o limite dela conferido em cada envio. Empresa nova entra sozinha no primeiro container com espaço.'
        }
        action={
          <div className="flex flex-wrap gap-2">
            <button className="nr-btn" onClick={() => setDefaults(true)}>
              Padrão de novos containers
            </button>
            <button className="nr-btn primary" onClick={() => setCreating(true)}>
              Novo container
            </button>
          </div>
        }
      >
        <DataTable
          rows={storage.containers.map((container) => ({ ...container, members: storage.organizations.filter((item) => item.containerId === container.id) }))}
          defaultSort="createdAt"
          columns={[
            {
              key: 'name',
              label: 'Container',
              render: (container) => (
                <span>
                  {container.name}
                  <small>
                    {mb(container.sizeMb)} · {percent(container.reservePercent)}% de folga · {mb(container.usableMb)} para as empresas
                  </small>
                </span>
              ),
            },
            {
              key: 'organizations',
              label: 'Empresas',
              render: (container) =>
                container.members.length ? (
                  <span>
                    {container.members.map((item) => (
                      <span key={item.id} className="block">
                        {item.name}
                        <small>
                          {item.planName ?? 'Sem plano'} · recebe {item.limitMb === null ? 'sem limite' : mb(item.limitMb)} · usa {mb(item.usedMb)}
                        </small>
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-[#7a897e]">Vazio</span>
                ),
            },
            {
              key: 'allocatedMb',
              label: 'Distribuído',
              render: (container) => (
                <span className="block min-w-[200px]">
                  <Bar label={container.freeMb < 0 ? 'Acima do que cabe' : `${mb(container.freeMb)} livres`} value={container.allocatedMb} capacity={container.usableMb} unit="mb" />
                </span>
              ),
            },
            { key: 'usedMb', label: 'Em uso', render: (container) => mb(container.usedMb) },
          ]}
          actions={(container) => (
            <>
              <button onClick={() => setEditing(container)}>Editar</button>
              {container.organizations === 0 && <button onClick={() => setArchiving(container)}>Arquivar</button>}
            </>
          )}
          emptyText="Nenhum container ainda. Crie o primeiro em “Novo container”."
        />
      </Panel>

      <Panel
        title="Empresas"
        description="Em que container cada empresa está. Transfira entre containers ou tire de um: nada é apagado e os arquivos não mudam de lugar."
        action={
          placeable.length ? (
            <button className="nr-btn" onClick={() => setDistributing(true)}>
              Colocar as {placeable.length} sem container
            </button>
          ) : undefined
        }
      >
        <DataTable
          rows={storage.organizations.map((organization) => ({
            ...organization,
            container: organization.containerId ? byId.get(organization.containerId)?.name ?? '—' : 'Sem container',
          }))}
          defaultSort="name"
          filters={[{ key: 'container', label: 'Container', options: ['Sem container', ...storage.containers.map((container) => container.name)] }]}
          columns={[
            {
              key: 'name',
              label: 'Organização',
              render: (organization) => (
                <span>
                  {organization.name}
                  <small>
                    {organization.planName ?? 'Sem plano'} · {ORGANIZATION_STATUS_LABELS[organization.status] ?? organization.status}
                  </small>
                </span>
              ),
            },
            {
              key: 'container',
              label: 'Container',
              render: (organization) => (
                <span>
                  {organization.container}
                  {organization.since && <small>desde {date(organization.since)}</small>}
                </span>
              ),
            },
            { key: 'limitMb', label: 'Recebe', render: (organization) => (organization.limitMb === null ? 'Sem limite' : mb(organization.limitMb)) },
            { key: 'usedMb', label: 'Usa', render: (organization) => mb(organization.usedMb) },
          ]}
          actions={(organization) => (
            <button onClick={() => setMoving(organization)}>{organization.containerId ? 'Transferir' : 'Atribuir'}</button>
          )}
          emptyText="Nenhuma empresa."
        />
      </Panel>

      {(creating || editing) && (
        <Editor
          title={editing ? `Editar · ${editing.name}` : 'Novo container'}
          description={
            editing
              ? `As empresas dele recebem ${mb(editing.allocatedMb)}: o tamanho menos a folga não pode ficar abaixo disso.`
              : 'Um espaço para distribuir entre empresas. A folga fica sempre livre, como margem de segurança.'
          }
          fields={[
            { key: 'name', label: 'Nome', required: true },
            { key: 'sizeGb', label: 'Tamanho (GB)', type: 'number', required: true },
            { key: 'reservePercent', label: 'Folga (%)', type: 'number', hint: 'Ex.: 10 GB com 5% = 9,5 GB para as empresas.' },
            { key: 'notes', label: 'Observações', type: 'textarea' },
          ]}
          initial={
            editing
              ? { name: editing.name, sizeGb: Math.round((editing.sizeMb / 1024) * 100) / 100, reservePercent: editing.reservePercent, notes: editing.notes ?? '' }
              : {
                  name: `Armazenamento ${storage.containers.length + 1}`,
                  sizeGb: storage.defaults?.sizeGb ?? 10,
                  reservePercent: storage.defaults?.reservePercent ?? 5,
                  notes: '',
                }
          }
          submit={editing ? 'Salvar alterações' : 'Criar container'}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (values) => {
            const body = { name: values.name, sizeGb: values.sizeGb, reservePercent: values.reservePercent, notes: values.notes };
            await changed(
              editing ? api(`/storage/containers/${editing.id}`, { method: 'PUT', body }) : api('/storage/containers', { method: 'POST', body }),
              editing ? 'Container atualizado.' : 'Container criado.',
            );
          }}
        />
      )}

      {archiving && (
        <Confirm
          title={`Arquivar ${archiving.name}?`}
          description="O container está vazio. Ele sai da lista e da capacidade, mas fica guardado no banco."
          onClose={() => setArchiving(null)}
          onConfirm={() => changed(api(`/storage/containers/${archiving.id}/archive`, { method: 'POST' }), 'Container arquivado.')}
        />
      )}

      {moving && (
        <Editor
          title={`${moving.containerId ? 'Transferir' : 'Atribuir'} · ${moving.name}`}
          description={
            `${moving.name} recebe ${moving.limitMb === null ? 'armazenamento sem limite' : mb(moving.limitMb)} e usa ${mb(moving.usedMb)}. ` +
            (moving.containerId ? `Hoje está em “${byId.get(moving.containerId)?.name ?? '—'}”. ` : '') +
            'Só os containers onde ela cabe aceitam. Os arquivos não mudam de lugar.'
          }
          fields={[
            {
              key: 'containerId',
              label: 'Container',
              type: 'select',
              required: true,
              options: [
                ...storage.containers
                  .filter((container) => container.id !== moving.containerId)
                  .map((container) => ({
                    value: container.id,
                    label: `${container.name} — ${mb(Math.max(0, container.freeMb))} livres${
                      moving.limitMb !== null && moving.limitMb > container.freeMb ? ' (não cabe)' : ''
                    }`,
                  })),
                ...(moving.containerId ? [{ value: 'none', label: 'Nenhum (tirar do container)' }] : []),
              ],
            },
          ]}
          initial={{ containerId: storage.containers.find((container) => container.id !== moving.containerId)?.id ?? (moving.containerId ? 'none' : '') }}
          reason
          submit={moving.containerId ? 'Transferir' : 'Atribuir'}
          onClose={() => setMoving(null)}
          onSave={async (values, reason) => {
            const containerId = values.containerId === 'none' ? null : values.containerId;
            await changed(
              api(`/storage/organizations/${moving.id}`, { method: 'PUT', body: { containerId, reason } }),
              containerId ? `${moving.name} agora está em “${byId.get(String(containerId))?.name}”.` : `${moving.name} saiu do container.`,
            );
          }}
        />
      )}

      {defaults && (
        <Editor
          title="Padrão de novos containers"
          description="Quando uma empresa nova não cabe em nenhum container, a plataforma abre um com este tamanho. Deixe o tamanho vazio para nunca abrir sozinha."
          fields={[
            { key: 'sizeGb', label: 'Tamanho (GB)', type: 'number' },
            { key: 'reservePercent', label: 'Folga (%)', type: 'number' },
          ]}
          initial={{ sizeGb: storage.defaults?.sizeGb ?? '', reservePercent: storage.defaults?.reservePercent ?? 5 }}
          onClose={() => setDefaults(false)}
          onSave={async (values) => {
            await changed(api('/storage/defaults', { method: 'PUT', body: { sizeGb: values.sizeGb, reservePercent: values.reservePercent } }), 'Padrão salvo.');
          }}
        />
      )}

      {distributing && (
        <Confirm
          title={`Colocar ${placeable.length} empresa(s) em containers?`}
          description="Cada uma entra no primeiro container com espaço, por ordem de chegada. Se nenhum couber, abre um novo com o tamanho padrão."
          onClose={() => setDistributing(false)}
          onConfirm={async () => {
            const result = await api<{ placed: unknown[]; skipped: Array<{ organization: string; reason: string }> }>('/storage/auto-assign', { method: 'POST' });
            notify(
              `${result.placed.length} empresa(s) colocadas.` +
                (result.skipped.length ? ` Ficaram de fora: ${result.skipped.map((item) => `${item.organization} (${item.reason})`).join('; ')}.` : ''),
            );
            data.reload();
          }}
        />
      )}
    </>
  );
}
