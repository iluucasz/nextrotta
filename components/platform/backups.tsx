'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, date, errorMessage } from './api';
import { useNotify } from './notice';
import { Badge, Confirm, DataTable, Metric, Panel } from './ui';

export type BackupOverview = {
  storageConfigured: boolean;
  nextRunAt: string;
  runs: Array<{ job: string; status: string; startedAt: string; finishedAt: string | null; error: string | null }>;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
    copies: number;
    sizeBytes: number;
    lastBackupAt: string | null;
    lastError: string | null;
  }>;
  platform: {
    backups: Array<{
      id: string;
      kind: 'daily' | 'manual';
      status: 'running' | 'completed' | 'failed' | 'expired';
      backupDate: string;
      createdAt: string;
      sizeBytes: number;
      tableCount: number;
      rowCount: number;
      error: string | null;
    }>;
    last: { createdAt: string; sizeBytes: number } | null;
    retentionDays: number;
    blocker: string | null;
  };
};

const RUN_STATUS: Record<string, string> = { running: 'Em andamento', success: 'Concluída', error: 'Falhou', partial: 'Com avisos', skipped: 'Ignorada' };
const PLATFORM_STATUS: Record<string, string> = { completed: 'Concluído', running: 'Em andamento', failed: 'Falhou', expired: 'Vencido' };
const HOUR = 60 * 60 * 1000;

/** Companies that don't change (suspended, canceled) stop getting a nightly copy, so they are never "late". */
function companyState(row: BackupOverview['organizations'][number]) {
  if (row.lastBackupAt === null) return row.lastError ? 'Com falha' : 'Sem backup';
  if (!['active', 'past_due'].includes(row.status)) return 'Sem mudanças';
  return Date.now() - new Date(row.lastBackupAt).getTime() > 36 * HOUR ? 'Atrasado' : 'Em dia';
}

function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`;
}

export function BackupsTab({ overview, reload }: { overview: BackupOverview; reload: () => void }) {
  const notify = useNotify();
  const [confirming, setConfirming] = useState(false);
  const platform = overview.platform;
  const nightly = overview.runs.find((run) => run.job === 'backups');
  const nightlyPlatform = overview.runs.find((run) => run.job === 'platform_backup');
  const rows = overview.organizations.map((row) => ({ ...row, state: companyState(row) }));
  const late = rows.filter((row) => row.state === 'Atrasado' || row.state === 'Com falha').length;

  return (
    <>
      <div className="nr-metrics">
        <Metric
          label="Backup das empresas"
          value={nightly ? RUN_STATUS[nightly.status] ?? nightly.status : 'Sem registro'}
          detail={nightly ? `Última rotina: ${date(nightly.startedAt, true)}` : 'O worker ainda não registrou a rotina da noite.'}
          accent={nightly?.status === 'success'}
        />
        <Metric label="Empresas com atraso" value={late} detail={`de ${rows.length} empresas`} />
        <Metric
          label="Backup da plataforma"
          value={platform.last ? date(platform.last.createdAt, true) : 'Nenhum ainda'}
          detail={platform.last ? `${size(platform.last.sizeBytes)} · rotina da noite: ${nightlyPlatform ? RUN_STATUS[nightlyPlatform.status] ?? nightlyPlatform.status : 'sem registro'}` : 'Faça o primeiro agora.'}
          accent={Boolean(platform.last)}
        />
        <Metric label="Próxima rotina" value={date(overview.nextRunAt, true)} detail="Todo dia às 00:00 (Brasília)" />
      </div>

      <Panel
        title="Backup da plataforma inteira (Neon)"
        description={`Todas as tabelas do banco numa cópia cifrada, guardada ${platform.retentionDays} dias (a mais recente nunca é removida). Restauração: node scripts/restore-platform-backup.cjs (veja docs/backups.md).`}
        action={
          <button className="nr-btn primary" disabled={Boolean(platform.blocker)} onClick={() => setConfirming(true)}>
            Fazer backup agora
          </button>
        }
      >
        {platform.blocker && <div className="nr-alert">{platform.blocker}</div>}
        <DataTable
          rows={platform.backups.map((backup) => ({ ...backup, kindText: backup.kind === 'daily' ? 'Diário' : 'Manual', statusText: PLATFORM_STATUS[backup.status] ?? backup.status }))}
          defaultSort="createdAt"
          defaultDescending
          columns={[
            { key: 'createdAt', label: 'Feito em', render: (row) => date(row.createdAt, true) },
            { key: 'kindText', label: 'Tipo' },
            { key: 'sizeBytes', label: 'Tamanho', render: (row) => (row.status === 'completed' ? size(row.sizeBytes) : '—') },
            { key: 'tableCount', label: 'Tabelas', render: (row) => (row.status === 'completed' ? row.tableCount : '—') },
            { key: 'rowCount', label: 'Linhas', render: (row) => (row.status === 'completed' ? row.rowCount.toLocaleString('pt-BR') : '—') },
            { key: 'statusText', label: 'Estado', render: (row) => <Badge tone={row.status === 'failed' ? 'bad' : row.status === 'completed' ? 'good' : 'neutral'}>{row.statusText}</Badge> },
            { key: 'error', label: 'Falha', render: (row) => <span className="block max-w-72 truncate">{row.error ?? '—'}</span> },
          ]}
          actions={(row) => (row.status === 'completed' ? <a href={`/api/platform/backups/${row.id}`}>Baixar</a> : null)}
          emptyText="Nenhum backup da plataforma ainda. A rotina da noite faz o primeiro, ou use o botão acima."
        />
      </Panel>

      <Panel title="Backups das empresas">
        <DataTable
          rows={rows}
          defaultSort="name"
          filters={[{ key: 'state', label: 'Estado', options: ['Em dia', 'Atrasado', 'Com falha', 'Sem backup', 'Sem mudanças'] }]}
          columns={[
            { key: 'name', label: 'Empresa' },
            { key: 'state', label: 'Estado', render: (row) => <Badge tone={row.state === 'Em dia' ? 'good' : row.state === 'Sem mudanças' ? 'neutral' : 'bad'}>{row.state}</Badge> },
            { key: 'lastBackupAt', label: 'Último backup', render: (row) => (row.lastBackupAt ? date(row.lastBackupAt, true) : '—') },
            { key: 'copies', label: 'Cópias guardadas' },
            { key: 'sizeBytes', label: 'Espaço', render: (row) => size(row.sizeBytes) },
            { key: 'lastError', label: 'Última falha', render: (row) => <span className="block max-w-72 truncate">{row.lastError ?? '—'}</span> },
          ]}
          actions={(row) => <Link href={`/plataforma/organizacoes/${row.id}`}>Abrir</Link>}
          emptyText="Nenhuma empresa cadastrada."
        />
      </Panel>

      {confirming && (
        <Confirm
          title="Fazer o backup da plataforma agora?"
          description="Lê todas as tabelas do banco, cifra e guarda a cópia. Leva alguns segundos e não atrapalha ninguém."
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await api('/backups', { method: 'POST', body: {} });
              notify('Backup da plataforma concluído.');
            } catch (reason) {
              notify(errorMessage(reason));
            }
            reload();
          }}
        />
      )}
    </>
  );
}
