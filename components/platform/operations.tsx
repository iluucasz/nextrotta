'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, date, ORGANIZATION_STATUS_LABELS, useResource, type OrganizationStatusKey } from './api';
import { useNotify } from './notice';
import { Badge, DataTable, Editor, Empty, ErrorState, Loading, Metric, Panel, Title } from './ui';
import { CapacityTab } from './capacity';
import { StorageTab } from './storage';
import { AlertsTab, CleanupTab, ContainersTab, CostsTab, PortoQueueTab, VpsTab } from './vps';

const TABS = ['Visão geral', 'Capacidade', 'Armazenamento', 'VPS', 'Containers', 'Limpeza', 'Gastos', 'Fila do Porto', 'Alertas'] as const;
type Tab = (typeof TABS)[number];

type Operations = {
  workers: Array<{ id: string; version: string | null; startedAt: string; lastSeenAt: string; online: boolean }>;
  runs: Array<{
    id: string;
    job: string;
    organizationId: string | null;
    organizationName: string | null;
    startedAt: string;
    finishedAt: string | null;
    durationSeconds: number | null;
    status: string;
    error: string | null;
  }>;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    status: OrganizationStatusKey;
    whatsappEnabled: boolean;
    whatsappInstance: string | null;
    whatsappState: string | null;
    whatsappNumber: string | null;
    whatsappMonth: number;
    portoEnabled: boolean;
    portoConfigured: boolean;
    portoLastError: string | null;
    storageMb: number;
  }>;
  databaseMb: number;
  maintenance: { enabled: boolean; message: string };
  backupsConfigured: boolean;
};

const JOB_LABELS: Record<string, string> = {
  porto_hours: 'Porto · importação de horas',
  porto_schedule: 'Porto · checagem de escala',
  billing: 'Inadimplência',
  coupons: 'Encerramento de cupons',
  ai_credits: 'Cota mensal de créditos de IA',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Em andamento',
  success: 'Concluída',
  partial: 'Concluída com avisos',
  error: 'Falhou',
  skipped: 'Ignorada',
  dry_run: 'Modo teste',
};

function duration(seconds: number | null) {
  if (seconds === null) return '—';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export function OperationsScreen() {
  const notify = useNotify();
  const data = useResource<Operations>('/operations');
  const [maintenance, setMaintenance] = useState(false);
  const [tab, setTab] = useState<Tab>('Visão geral');

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  const operations = data.data!;
  const worker = operations.workers[0] ?? null;
  const runs = operations.runs.map((run) => ({
    ...run,
    jobText: JOB_LABELS[run.job] ?? run.job,
    statusText: RUN_STATUS_LABELS[run.status] ?? run.status,
    organization: run.organizationName ?? 'Plataforma',
  }));
  const failures = runs.filter((run) => run.status === 'error').length;
  const totalStorage = operations.organizations.reduce((sum, organization) => sum + organization.storageMb, 0);
  const organizationNames = new Map(operations.organizations.map((organization) => [organization.id, organization.name]));

  return (
    <>
      <Title
        title="Tudo sob acompanhamento."
        description="Saúde dos serviços, automações e proteção dos dados."
        action={<button className="nr-btn" onClick={() => setMaintenance(true)}>{operations.maintenance.enabled ? 'Manutenção ativada' : 'Modo manutenção'}</button>}
      />
      {operations.maintenance.enabled && <div className="nr-alert">Mensagem aos clientes: {operations.maintenance.message}</div>}
      <div className="nr-tabs" role="tablist">
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={name === tab} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>
      {tab === 'Capacidade' && <CapacityTab />}
      {tab === 'Armazenamento' && <StorageTab />}
      {tab === 'VPS' && <VpsTab />}
      {tab === 'Containers' && <ContainersTab />}
      {tab === 'Limpeza' && <CleanupTab />}
      {tab === 'Gastos' && <CostsTab />}
      {tab === 'Fila do Porto' && <PortoQueueTab organizationNames={organizationNames} />}
      {tab === 'Alertas' && <AlertsTab organizationNames={organizationNames} />}
      {tab === 'Visão geral' && (<>
      <div className="nr-metrics">
        <Metric
          label="Worker de automações"
          value={worker ? (worker.online ? 'Online' : 'Offline') : 'Sem sinal'}
          detail={worker ? `Última comunicação: ${date(worker.lastSeenAt, true)}` : 'O worker ainda não se comunicou com a plataforma.'}
          accent={Boolean(worker?.online)}
        />
        <Metric label="Execuções em andamento" value={runs.filter((run) => run.status === 'running').length} detail={`${failures} falha(s) entre as últimas ${runs.length}`} />
        <Metric label="Arquivos das organizações" value={`${totalStorage.toLocaleString('pt-BR')} MB`} detail="Biblioteca de documentos" />
        <Metric label="Banco de dados" value={`${operations.databaseMb.toLocaleString('pt-BR')} MB`} detail="Espaço total utilizado" />
      </div>
      <Panel title="Últimas execuções do worker">
        <DataTable
          rows={runs}
          defaultSort="startedAt"
          defaultDescending
          filters={[
            { key: 'statusText', label: 'Estado', options: [...new Set(runs.map((run) => run.statusText))] },
            { key: 'organization', label: 'Organização', options: [...new Set(runs.map((run) => run.organization))] },
          ]}
          columns={[
            { key: 'organization', label: 'Organização' },
            { key: 'jobText', label: 'Execução' },
            { key: 'startedAt', label: 'Horário', render: (row) => date(row.startedAt, true) },
            { key: 'durationSeconds', label: 'Duração', render: (row) => duration(row.durationSeconds) },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge>{row.statusText}</Badge> },
            { key: 'error', label: 'Falha', render: (row) => <span className="block max-w-72 truncate">{row.error ?? '—'}</span> },
          ]}
          actions={(row) => (row.organizationId ? <Link href={`/plataforma/organizacoes/${row.organizationId}`}>Abrir</Link> : null)}
          emptyText="Nenhuma execução registrada. Elas aparecem quando o worker estiver rodando."
        />
      </Panel>
      <Panel title="Integrações e armazenamento por organização">
        <DataTable
          rows={operations.organizations.map((organization) => ({
            ...organization,
            statusText: ORGANIZATION_STATUS_LABELS[organization.status],
            whatsapp: organization.whatsappState === 'connected' ? 'Conectado' : organization.whatsappInstance ? 'Desconectado' : 'Não conectado',
            automation: organization.whatsappEnabled ? 'Ligada' : 'Desligada',
            porto: organization.portoEnabled ? 'Automação ligada' : organization.portoConfigured ? 'Configurada, automação desligada' : 'Não configurada',
          }))}
          filters={[
            { key: 'whatsapp', label: 'WhatsApp', options: ['Conectado', 'Desconectado', 'Não conectado'] },
            { key: 'porto', label: 'Porto', options: ['Automação ligada', 'Configurada, automação desligada', 'Não configurada'] },
          ]}
          columns={[
            { key: 'name', label: 'Organização' },
            { key: 'statusText', label: 'Situação', render: (row) => <Badge>{row.statusText}</Badge> },
            { key: 'whatsapp', label: 'WhatsApp', render: (row) => <Badge>{row.whatsapp}</Badge> },
            { key: 'whatsappNumber', label: 'Número', render: (row) => (row.whatsappNumber ? `+${row.whatsappNumber}` : '—') },
            { key: 'automation', label: 'Automação' },
            { key: 'whatsappMonth', label: 'Mensagens no mês' },
            { key: 'porto', label: 'Porto Seguro' },
            { key: 'storageMb', label: 'Arquivos (MB)', render: (row) => row.storageMb.toLocaleString('pt-BR') },
          ]}
          actions={(row) => <Link href={`/plataforma/organizacoes/${row.id}`}>Gerenciar</Link>}
        />
      </Panel>
      <Panel title="Backups diários">
        {operations.backupsConfigured ? (
          <Empty title="Nenhum backup gerado ainda" text="A rotina diária do worker registra os backups aqui." />
        ) : (
          <Empty
            title="Rotina de backup não configurada"
            text="Os backups diários por organização dependem de um armazenamento externo (BACKUP_STORAGE_URL) e do worker em execução. Até lá, a exportação completa de cada organização fica na aba Dados dela."
          />
        )}
      </Panel>
      </>)}
      {maintenance && (
        <Editor
          title="Modo manutenção"
          description="Enquanto ativo, todos os usuários das organizações veem esta mensagem no topo do sistema."
          fields={[
            { key: 'enabled', label: 'Ativar manutenção', type: 'checkbox' },
            { key: 'message', label: 'Mensagem para os clientes', type: 'textarea' },
          ]}
          initial={{ enabled: operations.maintenance.enabled, message: operations.maintenance.message }}
          reason
          validate={(values) => (values.enabled && !String(values.message).trim() ? 'Escreva a mensagem que os clientes verão.' : '')}
          onClose={() => setMaintenance(false)}
          onSave={async (values, reason) => {
            await api('/settings', { method: 'PUT', body: { maintenance: { enabled: Boolean(values.enabled), message: values.message }, reason } });
            notify(values.enabled ? 'Modo manutenção ativado.' : 'Modo manutenção desativado.');
            data.reload();
          }}
        />
      )}
    </>
  );
}
