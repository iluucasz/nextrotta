'use client';

import { useState } from 'react';
import { api, useResource } from './api';
import { amount, Bar } from './capacity';
import { useNotify } from './notice';
import { Editor, ErrorState, Loading, Metric, Panel } from './ui';

type Container = { id: string; name: string; sizeMb: number; usableMb: number; allocatedMb: number; freeMb: number };
type StorageOrganization = { id: string; name: string; limitMb: number | null; usedMb: number; containerId: string | null; since: string | null };
type Storage = { containers: Container[]; organizations: StorageOrganization[] };

const mb = (value: number) => amount(value, 'mb');
const toGb = (value: number) => Math.round((value / 1024) * 100) / 100;

/**
 * Organization detail → Limites e recursos → Armazenamento: what it receives, what it uses and how
 * far it can grow inside its storage container. Changes go through the same rules as Operação.
 */
export function OrganizationStoragePanel({ organizationId, planMb, onChanged }: { organizationId: string; planMb: number | null; onChanged: () => void }) {
  const notify = useNotify();
  const data = useResource<Storage>('/storage');
  const [adjusting, setAdjusting] = useState(false);
  const [moving, setMoving] = useState(false);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  const storage = data.data!;
  const organization = storage.organizations.find((item) => item.id === organizationId);
  if (!organization) return null;
  const container = storage.containers.find((item) => item.id === organization.containerId) ?? null;
  // How far its limit can go without overflowing the container.
  const maxMb = container ? (organization.limitMb ?? 0) + container.freeMb : null;
  const adjusted = organization.limitMb !== planMb;

  function changed(message: string) {
    notify(message);
    data.reload();
    onChanged();
  }

  return (
    <Panel
      title="Armazenamento"
      description={
        container
          ? `Está no container “${container.name}”: o limite só cresce até onde o container comporta. Para mais, transfira para um container com espaço.`
          : 'Fora de qualquer container de armazenamento: coloque-a em um para o limite ficar protegido pela capacidade.'
      }
      action={
        <div className="flex flex-wrap gap-2">
          <button className="nr-btn" onClick={() => setMoving(true)}>
            {container ? 'Trocar de container' : 'Colocar num container'}
          </button>
          <button className="nr-btn primary" onClick={() => setAdjusting(true)}>
            Ajustar limite
          </button>
        </div>
      }
    >
      <div className="nr-pad">
        <div className="nr-metrics">
          <Metric
            label="Recebe"
            value={organization.limitMb === null ? 'Sem limite' : mb(organization.limitMb)}
            detail={adjusted ? `Ajustado (o plano dá ${planMb === null ? 'sem limite' : mb(planMb)})` : 'Igual ao plano'}
            accent
          />
          <Metric label="Usa" value={mb(organization.usedMb)} detail={organization.limitMb ? `${Math.round((organization.usedMb / organization.limitMb) * 100)}% do que recebe` : undefined} />
          <Metric label="Container" value={container ? container.name : '—'} detail={container ? `${mb(Math.max(0, container.freeMb))} livres de ${mb(container.usableMb)}` : 'Sem container'} />
          <Metric label="Pode ir até" value={maxMb === null ? '—' : mb(maxMb)} detail={maxMb === null ? 'Sem container: só o total da plataforma limita' : 'Sem trocar de container'} />
        </div>
        {organization.limitMb !== null && <Bar label="Em uso do que recebe" value={organization.usedMb} capacity={organization.limitMb} unit="mb" />}
      </div>

      {adjusting && (
        <Editor
          title={`Ajustar armazenamento · ${organization.name}`}
          description={
            `Recebe ${organization.limitMb === null ? 'sem limite' : mb(organization.limitMb)} e usa ${mb(organization.usedMb)}. ` +
            (maxMb !== null ? `No container “${container!.name}” ela pode ir até ${mb(maxMb)}.` : 'Sem container: só o total da plataforma limita.')
          }
          fields={[
            {
              key: 'mode',
              label: 'Quanto ela recebe',
              type: 'select',
              required: true,
              options: [
                { value: 'value', label: 'Um valor definido por mim' },
                { value: 'plan', label: `Igual ao plano (${planMb === null ? 'sem limite' : mb(planMb)})` },
              ],
            },
            {
              key: 'value',
              label: 'Valor (GB)',
              type: 'number',
              hint: maxMb !== null ? `Entre ${toGb(organization.usedMb)} e ${toGb(maxMb)} GB.` : `Pelo menos ${toGb(organization.usedMb)} GB (o que já usa).`,
            },
          ]}
          initial={{ mode: 'value', value: organization.limitMb === null ? '' : toGb(organization.limitMb) }}
          reason
          submit="Salvar limite"
          validate={(values) => {
            if (values.mode !== 'value') return '';
            const value = Number(values.value);
            if (values.value === '' || !Number.isFinite(value) || value <= 0) return 'Informe o valor em GB.';
            if (maxMb !== null && value * 1024 > maxMb) return `Não cabe no container: até ${mb(maxMb)}.`;
            if (value * 1024 < organization.usedMb) return `Ela já usa ${mb(organization.usedMb)}.`;
            return '';
          }}
          onClose={() => setAdjusting(false)}
          onSave={async (values, reason) => {
            await api(`/allocation/${organizationId}`, {
              method: 'PUT',
              body: { resource: 'storageMb', mode: values.mode, value: values.mode === 'value' ? Math.round(Number(values.value) * 1024) : null, reason },
            });
            changed('Limite de armazenamento salvo.');
          }}
        />
      )}

      {moving && (
        <Editor
          title={`${container ? 'Trocar de container' : 'Colocar num container'} · ${organization.name}`}
          description={`Ela recebe ${organization.limitMb === null ? 'sem limite' : mb(organization.limitMb)}. Só os containers onde ela cabe aceitam; os arquivos não mudam de lugar.`}
          fields={[
            {
              key: 'containerId',
              label: 'Container',
              type: 'select',
              required: true,
              options: [
                ...storage.containers
                  .filter((item) => item.id !== organization.containerId)
                  .map((item) => ({
                    value: item.id,
                    label: `${item.name} — ${mb(Math.max(0, item.freeMb))} livres${organization.limitMb !== null && organization.limitMb > item.freeMb ? ' (não cabe)' : ''}`,
                  })),
                ...(container ? [{ value: 'none', label: 'Nenhum (tirar do container)' }] : []),
              ],
            },
          ]}
          initial={{ containerId: storage.containers.find((item) => item.id !== organization.containerId)?.id ?? (container ? 'none' : '') }}
          reason
          submit="Salvar"
          onClose={() => setMoving(false)}
          onSave={async (values, reason) => {
            const containerId = values.containerId === 'none' ? null : values.containerId;
            await api(`/storage/organizations/${organizationId}`, { method: 'PUT', body: { containerId, reason } });
            changed(containerId ? 'Container trocado.' : 'Empresa tirada do container.');
          }}
        />
      )}
    </Panel>
  );
}
