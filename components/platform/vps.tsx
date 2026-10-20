'use client';

import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { api, date, errorMessage, money, useResource } from './api';
import { useNotify } from './notice';
import { Badge, Confirm, DataTable, Editor, Empty, ErrorState, Loading, Metric, Panel } from './ui';

/**
 * Operação → VPS, Containers, Limpeza, Gastos, Fila do Porto e Alertas. Data from the VPS agent
 * through /api/platform/vps/* (docs/saas/vps.md). The VPS is shared with the original client's
 * production system: each container shows whose it is, and actions only appear where the agent
 * allows them.
 */

type Range = '24h' | '7d' | '30d';

type Host = {
  checkedAt: string;
  cpu: { percent: number; cores: number | null; load: number[] };
  memory: { total: number; available: number; used: number; swapTotal: number };
  disk: { total: number; used: number; free: number; percent: number };
  network: { rxBytes: number; txBytes: number };
  uptimeSeconds: number;
  os: string | null;
};

type VpsOverview = {
  agentConfigured: boolean;
  host: Host | null;
  agentError: string | null;
  range: Range;
  history: Array<{ at: string; cpuPercent: number; cpuMaxPercent: number; memoryUsedBytes: number; memoryTotalBytes: number; diskPercent: number; networkRxBytes: number; networkTxBytes: number }>;
  capacity: { maxBrowsers: number; windowMinutes: number; nights: Array<{ night: string; browserMinutes: number; occupancyPercent: number; lastFinishedAt: string | null }> };
  autoCleanup: boolean;
};

type Owner = 'nextrotta' | 'production' | 'shared' | 'unknown';

type Container = {
  id: string;
  name: string;
  owner: Owner;
  image: string;
  state: string;
  status: string;
  startedAt: string | null;
  restartCount: number;
  restartPolicy: string | null;
  ports: string[];
  sizeRootFs: number | null;
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number | null;
  logBytes: number | null;
  logRotation: Record<string, string>;
};

type Image = { id: string; tags: string[]; sizeBytes: number; createdAt: string; usedBy: string[]; owner: Owner };

type CleanupAction = { kind: string; target: string; bytes: number; reason: string; ok?: boolean; error?: string };

type CleanupRun = {
  id: string;
  trigger: 'manual' | 'auto';
  dryRun: boolean;
  startedAt: string;
  freedBytes: number;
  diskBefore: number | null;
  diskAfter: number | null;
  actions: CleanupAction[];
  error: string | null;
};

const OWNER_LABELS: Record<Owner, string> = { nextrotta: 'NextRotta', production: 'Produção', shared: 'Compartilhado', unknown: 'Outro sistema' };
const OWNER_HINTS: Record<Owner, string> = {
  nextrotta: 'Do NextRotta: pode ser reiniciado.',
  production: 'Do sistema original do cliente, em produção: só leitura.',
  shared: 'WhatsApp de todos os sistemas: reiniciar derruba o WhatsApp da produção por alguns segundos.',
  unknown: 'De outro sistema da VPS: só leitura.',
};

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function bytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value >= GB) return `${(value / GB).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  if (value >= MB) return `${Math.round(value / MB).toLocaleString('pt-BR')} MB`;
  return `${Math.max(0, Math.round(value / 1024)).toLocaleString('pt-BR')} KB`;
}

function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days ? `${days} dia${days === 1 ? '' : 's'} e ${hours}h` : `${hours}h`;
}

function AgentMissing() {
  return (
    <Panel>
      <Empty
        title="Agente da VPS não configurado"
        text="Configure VPS_AGENT_URL e VPS_AGENT_SECRET no servidor do app (e no worker, para o histórico). O passo a passo está em docs/saas/vps.md."
      />
    </Panel>
  );
}

function RangePicker({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  return (
    <div className="nr-actions" role="group" aria-label="Período dos gráficos">
      {(['24h', '7d', '30d'] as Range[]).map((range) => (
        <button key={range} className={`nr-btn ${range === value ? 'primary' : ''}`} aria-pressed={range === value} onClick={() => onChange(range)}>
          {range === '24h' ? '24 horas' : range === '7d' ? '7 dias' : '30 dias'}
        </button>
      ))}
    </div>
  );
}

function UsageChart({ id, label, data, dataKey, unit, max }: { id: string; label: string; data: Array<Record<string, number | string>>; dataKey: string; unit: string; max?: number }) {
  if (!data.length) return <Empty title="Sem histórico ainda" text="O worker grava uma amostra a cada 5 minutos quando o agente está configurado." />;
  return (
    <div className="nr-chart" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 4, right: 20, top: 12, bottom: 0 }}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#63ad8d" stopOpacity={0.23} />
              <stop offset="100%" stopColor="#63ad8d" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="#edf1ed" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#89968c' }} minTickGap={24} />
          <YAxis domain={[0, max ?? 'auto']} tickFormatter={(value) => `${Number(value).toLocaleString('pt-BR')}${unit}`} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#89968c' }} width={56} />
          <Tooltip formatter={(value) => `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${unit}`} contentStyle={{ borderRadius: 10, border: '1px solid #e5ebe7', fontSize: 12 }} />
          <Area dataKey={dataKey} name={label} stroke="#368b69" strokeWidth={2.5} fill={`url(#${id}-fill)`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// VPS: machine, history, night capacity
// ---------------------------------------------------------------------------------------------

export function VpsTab() {
  const [range, setRange] = useState<Range>('24h');
  const data = useResource<VpsOverview>(`/vps?range=${range}`);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  const vps = data.data!;
  if (!vps.agentConfigured) return <AgentMissing />;

  const host = vps.host;
  const label = (at: string) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...(range === '24h' ? { hour: '2-digit', minute: '2-digit' } : range === '7d' ? { day: '2-digit', month: '2-digit', hour: '2-digit' } : { day: '2-digit', month: '2-digit' }) }).format(new Date(at));
  const history = vps.history.map((row) => ({
    label: label(row.at),
    cpu: row.cpuPercent,
    memory: Number((row.memoryUsedBytes / GB).toFixed(2)),
    disk: row.diskPercent,
  }));
  const lastNight = vps.capacity.nights[0];

  return (
    <>
      {vps.agentError && <div className="nr-alert">O agente da VPS não respondeu agora: {vps.agentError}</div>}
      <div className="nr-metrics">
        <Metric label="CPU" value={host ? `${host.cpu.percent.toLocaleString('pt-BR')}%` : '—'} detail={host ? `${host.cpu.cores ?? '?'} núcleos · carga ${host.cpu.load.map((value) => value.toLocaleString('pt-BR')).join(' / ')}` : 'Sem resposta do agente'} />
        <Metric
          label="Memória"
          value={host ? bytes(host.memory.used) : '—'}
          detail={host ? `de ${bytes(host.memory.total)} · ${bytes(host.memory.available)} disponíveis${host.memory.swapTotal ? '' : ' · sem swap'}` : undefined}
        />
        <Metric label="Disco" value={host ? `${host.disk.percent.toLocaleString('pt-BR')}%` : '—'} detail={host ? `${bytes(host.disk.free)} livres de ${bytes(host.disk.total)}` : undefined} accent={Boolean(host && host.disk.percent >= 80)} />
        <Metric label="Ligada há" value={host ? uptime(host.uptimeSeconds) : '—'} detail={host ? `${host.os ?? 'Linux'} · lido às ${date(host.checkedAt, true).split(' ').pop()}` : undefined} />
      </div>
      <Panel title="Uso da máquina" description="Média de cada intervalo. A VPS é compartilhada com o sistema original do cliente." action={<RangePicker value={range} onChange={setRange} />}>
        <div className="nr-grid-3 nr-pad">
          <div>
            <p className="text-xs text-muted-foreground">CPU (%)</p>
            <UsageChart id="cpu" label="CPU" data={history} dataKey="cpu" unit="%" max={100} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Memória usada (GB)</p>
            <UsageChart id="memory" label="Memória" data={history} dataKey="memory" unit=" GB" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Disco (%)</p>
            <UsageChart id="disk" label="Disco" data={history} dataKey="disk" unit="%" max={100} />
          </div>
        </div>
      </Panel>
      <Panel
        title="Janela noturna do robô do Porto"
        description={`Minutos de navegador usados pelas execuções automáticas entre 23:00 e 06:00, contra a capacidade de ${vps.capacity.maxBrowsers} navegador(es) ao mesmo tempo (${vps.capacity.windowMinutes.toLocaleString('pt-BR')} min por noite).`}
      >
        {lastNight && lastNight.occupancyPercent >= 70 && (
          <div className="nr-alert mx-6">A última noite usou {lastNight.occupancyPercent.toLocaleString('pt-BR')}% da janela: considere mais navegadores ao mesmo tempo ou outra VPS.</div>
        )}
        <DataTable
          rows={vps.capacity.nights.map((night) => ({ id: night.night, ...night }))}
          defaultSort="night"
          defaultDescending
          columns={[
            { key: 'night', label: 'Noite de', render: (row) => date(row.night) },
            { key: 'browserMinutes', label: 'Minutos de navegador', render: (row) => row.browserMinutes.toLocaleString('pt-BR') },
            {
              key: 'occupancyPercent',
              label: 'Ocupação',
              render: (row) => (
                <span className="block w-48">
                  {row.occupancyPercent.toLocaleString('pt-BR')}%
                  <span className="nr-progress block"><span style={{ width: `${Math.min(100, row.occupancyPercent)}%` }} /></span>
                </span>
              ),
            },
            { key: 'lastFinishedAt', label: 'Última execução terminou', render: (row) => date(row.lastFinishedAt, true) },
          ]}
          emptyText="Nenhuma execução automática do Porto nas últimas noites."
        />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Containers and images
// ---------------------------------------------------------------------------------------------

function LogsDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [tail, setTail] = useState(200);
  const logs = useResource<{ logs: string }>(`/vps/containers/${encodeURIComponent(name)}/logs?tail=${tail}`);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="nr-dialog sm:max-w-5xl">
        <DialogTitle>Logs de {name}</DialogTitle>
        <DialogDescription>Últimas {tail} linhas, só leitura.</DialogDescription>
        {logs.loading && !logs.data ? <Loading /> : logs.error ? <ErrorState message={logs.error} onRetry={logs.reload} /> : <pre className="nr-code max-h-[60vh] overflow-auto">{logs.data?.logs || 'Sem linhas de log.'}</pre>}
        <div className="nr-dialog-actions">
          {tail < 2000 && <button className="nr-btn" onClick={() => setTail(Math.min(2000, tail * 5))}>Mostrar mais</button>}
          <button className="nr-btn" onClick={logs.reload}>Atualizar</button>
          <button className="nr-btn primary" onClick={onClose}>Fechar</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ContainersTab() {
  const notify = useNotify();
  const containers = useResource<{ containers: Container[] }>('/vps/containers');
  const images = useResource<{ images: Image[] }>('/vps/images');
  const [logs, setLogs] = useState<string | null>(null);
  const [restart, setRestart] = useState<Container | null>(null);

  if (containers.loading && !containers.data) return <Loading />;
  if (containers.error) return containers.error.includes('não está configurado') ? <AgentMissing /> : <ErrorState message={containers.error} onRetry={containers.reload} />;

  const rows = containers.data!.containers.map((container) => ({
    ...container,
    ownerText: OWNER_LABELS[container.owner],
    stateText: container.state === 'running' ? 'Online' : 'Offline',
    cpu: container.cpuPercent ?? -1,
    memory: container.memoryBytes ?? -1,
    log: container.logBytes ?? -1,
  }));

  return (
    <>
      <div className="nr-alert">A VPS é compartilhada com o sistema original do cliente (em produção). Containers da produção e de outros sistemas são só leitura; o WhatsApp é compartilhado.</div>
      <Panel title="Containers" description="Estado e uso agora. Reiniciar só aparece onde é permitido.">
        <DataTable
          rows={rows}
          defaultSort="ownerText"
          filters={[
            { key: 'ownerText', label: 'Dono', options: [...new Set(rows.map((row) => row.ownerText))] },
            { key: 'stateText', label: 'Estado', options: ['Online', 'Offline'] },
          ]}
          columns={[
            { key: 'name', label: 'Container', render: (row) => <span>{row.name}<small>{row.image}</small></span> },
            { key: 'ownerText', label: 'Dono', render: (row) => <span title={OWNER_HINTS[row.owner]}><Badge>{row.ownerText}</Badge></span> },
            { key: 'stateText', label: 'Estado', render: (row) => <span><Badge>{row.stateText}</Badge><small>{row.status}</small></span> },
            { key: 'cpu', label: 'CPU', render: (row) => (row.cpuPercent === null ? '—' : `${row.cpuPercent.toLocaleString('pt-BR')}%`) },
            { key: 'memory', label: 'Memória', render: (row) => <span>{bytes(row.memoryBytes)}<small>{row.memoryLimitBytes ? `limite ${bytes(row.memoryLimitBytes)}` : 'sem limite'}</small></span> },
            { key: 'restartCount', label: 'Reinícios', render: (row) => <span>{row.restartCount}<small>{row.restartPolicy ?? '—'}</small></span> },
            { key: 'log', label: 'Log', render: (row) => <span>{bytes(row.logBytes)}<small>{row.logRotation['max-size'] ? `rotação ${row.logRotation['max-size']} × ${row.logRotation['max-file'] ?? 1}` : 'sem rotação'}</small></span> },
          ]}
          actions={(row) => (
            <>
              <button onClick={() => setLogs(row.name)}>Logs</button>
              {(row.owner === 'nextrotta' || row.owner === 'shared') && <button onClick={() => setRestart(row)}>Reiniciar</button>}
            </>
          )}
          emptyText="Nenhum container encontrado."
        />
      </Panel>
      <Panel title="Imagens" description="Espaço ocupado por imagem, quem usa e de quem é. A limpeza remove só o que as regras permitem (aba Limpeza).">
        {images.loading && !images.data ? (
          <Loading />
        ) : images.error ? (
          <ErrorState message={images.error} onRetry={images.reload} />
        ) : (
          <DataTable
            rows={images.data!.images.map((image) => ({
              ...image,
              tag: image.tags.join(', ') || '(sem nome)',
              ownerText: OWNER_LABELS[image.owner],
              used: image.usedBy.length ? image.usedBy.join(', ') : 'Sem uso',
            }))}
            defaultSort="sizeBytes"
            defaultDescending
            filters={[{ key: 'ownerText', label: 'Dono', options: Object.values(OWNER_LABELS) }]}
            columns={[
              { key: 'tag', label: 'Imagem' },
              { key: 'ownerText', label: 'Dono', render: (row) => <Badge>{row.ownerText}</Badge> },
              { key: 'sizeBytes', label: 'Tamanho', render: (row) => bytes(row.sizeBytes) },
              { key: 'createdAt', label: 'Criada em', render: (row) => date(row.createdAt, true) },
              { key: 'used', label: 'Usada por' },
            ]}
          />
        )}
      </Panel>
      {logs && <LogsDialog name={logs} onClose={() => setLogs(null)} />}
      {restart && (
        <Confirm
          title={`Reiniciar ${restart.name}`}
          description={
            restart.owner === 'shared'
              ? 'Este container é o WhatsApp de TODOS os sistemas da VPS, inclusive o do cliente em produção. Ele fica fora do ar por alguns segundos. Só confirme se for realmente necessário.'
              : 'O container do NextRotta reinicia na hora. Execuções do robô que estiverem rodando nele são interrompidas e ficam para a próxima.'
          }
          strong={restart.owner === 'shared' ? 'REINICIAR WHATSAPP' : undefined}
          onClose={() => setRestart(null)}
          onConfirm={async () => {
            await api(`/vps/containers/${encodeURIComponent(restart.name)}/restart`, { method: 'POST', body: { confirmShared: restart.owner === 'shared' } });
            notify(`${restart.name} reiniciado.`);
            containers.reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Cleanup and disk
// ---------------------------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  container: 'Container',
  image: 'Imagem',
  dangling_images: 'Imagens sem nome',
  build_cache: 'Cache de build',
  log: 'Log',
  apt_cache: 'Pacotes do apt',
};

type DiskReport = {
  disk: { percent: number; free: number; total: number };
  docker: { imagesBytes: number; containersBytes: number; volumesBytes: number; buildCacheBytes: number };
  directories: Array<{ path: string; bytes: number }>;
  legacyCleanupLog: string[];
};

function ActionsTable({ actions }: { actions: CleanupAction[] }) {
  return (
    <DataTable
      rows={actions.map((action, index) => ({ id: String(index), ...action, kindText: ACTION_LABELS[action.kind] ?? action.kind, result: action.ok === undefined ? '' : action.ok ? 'Concluída' : 'Falhou' }))}
      columns={[
        { key: 'kindText', label: 'Tipo' },
        { key: 'target', label: 'Item' },
        { key: 'bytes', label: 'Libera', render: (row) => bytes(row.bytes) },
        { key: 'reason', label: 'Motivo', render: (row) => <span className="block max-w-96 whitespace-normal">{row.reason}</span> },
        ...(actions.some((action) => action.ok !== undefined) ? [{ key: 'result', label: 'Resultado', render: (row: { result: string; error?: string }) => <span><Badge>{row.result}</Badge>{row.error && <small>{row.error}</small>}</span> }] : []),
      ]}
      emptyText="Nada a remover: o disco já está dentro das regras."
    />
  );
}

export function CleanupTab() {
  const notify = useNotify();
  const disk = useResource<DiskReport>('/vps/disk');
  const history = useResource<{ cleanups: CleanupRun[] }>('/vps/cleanup');
  const overview = useResource<VpsOverview>('/vps');
  const [preview, setPreview] = useState<{ actions: CleanupAction[]; freedBytes: number } | null>(null);
  const [result, setResult] = useState<CleanupRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [confirmAuto, setConfirmAuto] = useState(false);

  if (disk.loading && !disk.data) return <Loading />;
  if (disk.error) return disk.error.includes('não está configurado') ? <AgentMissing /> : <ErrorState message={disk.error} onRetry={disk.reload} />;
  const report = disk.data!;
  const autoCleanup = overview.data?.autoCleanup ?? false;

  async function runPreview() {
    setBusy(true);
    try {
      const response = await api<{ actions: CleanupAction[]; freedBytes: number }>('/vps/cleanup', { method: 'POST', body: { dryRun: true } });
      setPreview(response);
      setResult(null);
      history.reload();
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="nr-metrics">
        <Metric label="Disco" value={`${report.disk.percent.toLocaleString('pt-BR')}%`} detail={`${bytes(report.disk.free)} livres de ${bytes(report.disk.total)}`} accent={report.disk.percent >= 80} />
        <Metric label="Imagens Docker" value={bytes(report.docker.imagesBytes)} detail={`Containers: ${bytes(report.docker.containersBytes)}`} />
        <Metric label="Cache de build" value={bytes(report.docker.buildCacheBytes)} detail="Só acelera o próximo build" />
        <Metric label="Limpeza automática" value={autoCleanup ? 'Ligada' : 'Desligada'} detail={autoCleanup ? 'Todo dia às 04:30 (Brasília)' : 'Compare a prévia com a limpeza antiga antes de ligar'} accent={autoCleanup} />
      </div>
      <Panel
        title="Limpeza do disco"
        description="Mesmas regras da limpeza antiga da VPS, mais as imagens do NextRotta. Nunca toca volumes, /opt, containers rodando ou o que é de outros sistemas."
        action={
          <div className="nr-actions">
            <button className="nr-btn" disabled={busy} onClick={() => setConfirmAuto(true)}>{autoCleanup ? 'Desligar automática' : 'Ligar automática'}</button>
            <button className="nr-btn primary" disabled={busy} onClick={() => void runPreview()}>{busy ? 'Verificando…' : 'Ver prévia'}</button>
          </div>
        }
      >
        {preview ? (
          <>
            <div className="nr-pad">
              <div className="nr-detail-row">
                <span>
                  Prévia: {preview.actions.length} item(ns)
                  <small>Nada foi removido ainda.</small>
                </span>
                <span className="nr-actions">
                  <strong>{bytes(preview.freedBytes)} a liberar</strong>
                  {preview.actions.length > 0 && <button className="nr-btn danger" onClick={() => setConfirmRun(true)}>Executar limpeza</button>}
                </span>
              </div>
            </div>
            <ActionsTable actions={preview.actions} />
          </>
        ) : result ? (
          <>
            <div className="nr-pad">
              <div className="nr-detail-row">
                <span>
                  Limpeza executada
                  <small>Disco: {result.diskBefore ?? '—'}% → {result.diskAfter ?? '—'}%</small>
                </span>
                <strong>{bytes(result.freedBytes)} liberados</strong>
              </div>
            </div>
            <ActionsTable actions={result.actions} />
          </>
        ) : (
          <Empty title="Gere a prévia" text="A prévia lista o que sairia, o motivo de cada item e quanto libera, sem remover nada." />
        )}
      </Panel>
      <Panel title="Histórico de limpezas" description="Prévias, execuções manuais e automáticas.">
        {history.loading && !history.data ? (
          <Loading />
        ) : history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : (
          <DataTable
            rows={history.data!.cleanups.map((run) => ({
              ...run,
              kindText: run.dryRun ? 'Prévia' : run.trigger === 'auto' ? 'Automática' : 'Manual',
              statusText: run.error ? 'Falhou' : run.actions.some((action) => action.ok === false) ? 'Falhou em parte' : 'Concluída',
              items: run.actions.length,
            }))}
            defaultSort="startedAt"
            defaultDescending
            filters={[{ key: 'kindText', label: 'Tipo', options: ['Prévia', 'Manual', 'Automática'] }]}
            columns={[
              { key: 'startedAt', label: 'Quando', render: (row) => date(row.startedAt, true) },
              { key: 'kindText', label: 'Tipo' },
              { key: 'items', label: 'Itens' },
              { key: 'freedBytes', label: 'Libera / liberou', render: (row) => bytes(row.freedBytes) },
              { key: 'diskBefore', label: 'Disco', render: (row) => (row.diskBefore === null ? '—' : `${row.diskBefore}%${row.diskAfter !== null ? ` → ${row.diskAfter}%` : ''}`) },
              { key: 'statusText', label: 'Resultado', render: (row) => <span><Badge>{row.statusText}</Badge>{row.error && <small>{row.error}</small>}</span> },
            ]}
            emptyText="Nenhuma limpeza registrada ainda."
          />
        )}
      </Panel>
      <div className="nr-grid-2 nr-equal">
        <Panel title="Onde está o espaço" description="Pastas conhecidas do servidor.">
          <div className="nr-pad">
            {report.directories.map((dir) => (
              <div className="nr-detail-row" key={dir.path}>
                <span>{dir.path}</span>
                <strong>{bytes(dir.bytes)}</strong>
              </div>
            ))}
            <div className="nr-detail-row">
              <span>Volumes Docker<small>Sessões do WhatsApp e banco da Evolution: nunca são limpos</small></span>
              <strong>{bytes(report.docker.volumesBytes)}</strong>
            </div>
          </div>
        </Panel>
        <Panel title="Limpeza antiga da VPS" description="Últimas linhas do log do script que esta limpeza substitui (vps-cleanup.sh).">
          <div className="nr-pad">
            {report.legacyCleanupLog.length ? <pre className="nr-code max-h-80 overflow-auto">{report.legacyCleanupLog.slice(-20).join('\n')}</pre> : <Empty title="Sem registro" text="O log da limpeza antiga não foi encontrado." />}
          </div>
        </Panel>
      </div>
      {confirmRun && preview && (
        <Confirm
          title="Executar limpeza"
          description={`Remove ${preview.actions.length} item(ns) e libera cerca de ${bytes(preview.freedBytes)}. Imagens e containers removidos não voltam (só reconstruindo); logs zerados são perdidos.`}
          onClose={() => setConfirmRun(false)}
          onConfirm={async () => {
            const response = await api<CleanupRun>('/vps/cleanup', { method: 'POST', body: { dryRun: false } });
            setResult(response);
            setPreview(null);
            notify(`Limpeza concluída: ${bytes(response.freedBytes)} liberados.`);
            history.reload();
            disk.reload();
          }}
        />
      )}
      {confirmAuto && (
        <Confirm
          title={autoCleanup ? 'Desligar a limpeza automática' : 'Ligar a limpeza automática'}
          description={autoCleanup ? 'O disco deixa de ser limpo sozinho. Lembre de rodar a limpeza manualmente.' : 'Todo dia às 04:30 (Brasília) o worker roda a limpeza com as regras da prévia. Falhas viram alerta para você.'}
          reason
          onClose={() => setConfirmAuto(false)}
          onConfirm={async (reason) => {
            await api('/settings', { method: 'PUT', body: { vps: { autoCleanup: !autoCleanup }, reason } });
            notify(autoCleanup ? 'Limpeza automática desligada.' : 'Limpeza automática ligada.');
            overview.reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Costs and the split per organization
// ---------------------------------------------------------------------------------------------

type Cost = { id: string; month: string; category: string; categoryLabel: string; description: string; amount: number; createdAt: string };
type Allocation = {
  month: string;
  costs: Array<{ category: string; label: string; total: number }>;
  totalCost: number;
  totalRevenue: number;
  organizations: Array<{ organizationId: string; name: string; slug: string; status: string; portoBrowserMinutes: number; portoRuns: number; whatsappMessages: number; estimatedCost: number; monthlyRevenue: number; margin: number }>;
  method: string;
};

function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
}

export function CostsTab() {
  const notify = useNotify();
  const [month, setMonth] = useState(currentMonth());
  const costs = useResource<{ costs: Cost[]; categories: Record<string, string> }>(`/vps/costs?month=${month}`);
  const allocation = useResource<Allocation>(`/vps/costs/allocation?month=${month}`);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<Cost | null>(null);

  if ((costs.loading && !costs.data) || (allocation.loading && !allocation.data)) return <Loading />;
  if (costs.error) return <ErrorState message={costs.error} onRetry={costs.reload} />;
  if (allocation.error) return <ErrorState message={allocation.error} onRetry={allocation.reload} />;
  const split = allocation.data!;
  const categories = costs.data!.categories;

  return (
    <>
      <div className="nr-period">
        <label className="text-xs text-muted-foreground" htmlFor="costs-month">Mês</label>
        <input id="costs-month" type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} />
      </div>
      <div className="nr-metrics">
        <Metric label="Custo de infraestrutura" value={money(split.totalCost)} detail="Lançado à mão neste mês" />
        <Metric label="Receita mensal" value={money(split.totalRevenue)} detail="Assinaturas (anuais ÷ 12)" />
        <Metric label="Margem" value={money(split.totalRevenue - split.totalCost)} detail={split.totalRevenue ? `${Math.round(((split.totalRevenue - split.totalCost) / split.totalRevenue) * 100)}% da receita` : '—'} accent />
        <Metric label="Organizações" value={split.organizations.length} detail="Ativas, em atraso ou suspensas" />
      </div>
      <Panel title="Gastos do mês" description="VPS, Vercel, banco, domínio, WhatsApp, IA… Um lançamento errado é arquivado, não apagado." action={<button className="nr-btn primary" onClick={() => setAdding(true)}>Lançar gasto</button>}>
        <DataTable
          rows={costs.data!.costs}
          defaultSort="createdAt"
          defaultDescending
          columns={[
            { key: 'categoryLabel', label: 'Categoria' },
            { key: 'description', label: 'Descrição', render: (row) => row.description || '—' },
            { key: 'amount', label: 'Valor', render: (row) => money(row.amount) },
            { key: 'createdAt', label: 'Lançado em', render: (row) => date(row.createdAt, true) },
          ]}
          actions={(row) => <button onClick={() => setArchiving(row)}>Arquivar</button>}
          emptyText="Nenhum gasto lançado neste mês."
        />
      </Panel>
      <Panel title="Quanto cada organização custa" description={split.method}>
        <DataTable
          rows={split.organizations.map((row) => ({ ...row, id: row.organizationId }))}
          defaultSort="margin"
          columns={[
            { key: 'name', label: 'Organização', render: (row) => <span>{row.name}<small>{row.slug}</small></span> },
            { key: 'portoBrowserMinutes', label: 'Navegador do Porto', render: (row) => <span>{row.portoBrowserMinutes.toLocaleString('pt-BR')} min<small>{row.portoRuns} execução(ões)</small></span> },
            { key: 'whatsappMessages', label: 'Mensagens de WhatsApp', render: (row) => row.whatsappMessages.toLocaleString('pt-BR') },
            { key: 'estimatedCost', label: 'Custo estimado', render: (row) => money(row.estimatedCost) },
            { key: 'monthlyRevenue', label: 'Paga por mês', render: (row) => money(row.monthlyRevenue) },
            { key: 'margin', label: 'Margem', render: (row) => <span className={row.margin < 0 ? 'text-[#bd6150]' : ''}>{money(row.margin)}</span> },
          ]}
        />
      </Panel>
      {adding && (
        <Editor
          title="Lançar gasto"
          description="Valor pago no mês, por categoria."
          fields={[
            { key: 'category', label: 'Categoria', type: 'select', required: true, options: Object.entries(categories).map(([value, label]) => ({ value, label })) },
            { key: 'amount', label: 'Valor (R$)', type: 'number', required: true },
            { key: 'month', label: 'Mês (AAAA-MM)', required: true },
            { key: 'description', label: 'Descrição', hint: 'Ex.: Oracle VPS, Vercel Pro, domínio .com.br' },
          ]}
          initial={{ category: 'vps', amount: '', month, description: '' }}
          submit="Lançar"
          onClose={() => setAdding(false)}
          onSave={async (values) => {
            await api('/vps/costs', { method: 'POST', body: values });
            notify('Gasto lançado.');
            costs.reload();
            allocation.reload();
          }}
        />
      )}
      {archiving && (
        <Confirm
          title="Arquivar lançamento"
          description={`${archiving.categoryLabel} · ${money(archiving.amount)}. Ele sai dos totais e fica guardado no banco.`}
          onClose={() => setArchiving(null)}
          onConfirm={async () => {
            await api(`/vps/costs/${archiving.id}`, { method: 'DELETE' });
            notify('Lançamento arquivado.');
            costs.reload();
            allocation.reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Porto queue and owner alerts
// ---------------------------------------------------------------------------------------------

type Queue = {
  capacity: { maxBrowsers: number; activeBrowsers: number; waiting: number };
  running: Array<{ organizationId: string; name: string; heldForMs: number }>;
  queue: Array<{ organizationId: string; job: 'hours' | 'schedule'; runDay: string; enqueuedAt: string; startedAt: string | null }>;
};

export function PortoQueueTab({ organizationNames }: { organizationNames: Map<string, string> }) {
  const queue = useResource<Queue>('/porto-queue');
  if (queue.loading && !queue.data) return <Loading />;
  if (queue.error) {
    return (
      <Panel>
        <Empty title="Worker indisponível" text={`${queue.error} A fila só existe enquanto o worker do NextRotta está rodando.`} />
      </Panel>
    );
  }
  const data = queue.data!;
  const name = (id: string) => organizationNames.get(id) ?? id;
  return (
    <>
      <div className="nr-metrics">
        <Metric label="Navegadores em uso" value={`${data.capacity.activeBrowsers} de ${data.capacity.maxBrowsers}`} detail="Limite em Configurações → Alertas e robô" accent={data.capacity.activeBrowsers > 0} />
        <Metric label="Rodando agora" value={data.running.length} detail="Uma sessão do Porto por organização" />
        <Metric label="Na fila" value={data.queue.filter((item) => !item.startedAt).length} detail={`${data.capacity.waiting} esperando navegador`} />
        <Metric label="Atualizado" value={new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(new Date())} detail="Ao vivo, do worker" />
      </div>
      <Panel title="Execuções" description="Cada organização entra na fila no horário de importação de horas dela; a escala entra logo depois das horas." action={<button className="nr-btn" onClick={queue.reload}>Atualizar</button>}>
        <DataTable
          rows={data.queue.map((item) => ({
            id: `${item.organizationId}:${item.job}`,
            organization: name(item.organizationId),
            jobText: item.job === 'hours' ? 'Importação de horas' : 'Importação da escala',
            stateText: item.startedAt ? 'Em andamento' : 'Pendente',
            enqueuedAt: item.enqueuedAt,
            startedAt: item.startedAt,
          }))}
          defaultSort="enqueuedAt"
          columns={[
            { key: 'organization', label: 'Organização' },
            { key: 'jobText', label: 'Execução' },
            { key: 'stateText', label: 'Estado', render: (row) => <Badge>{row.stateText}</Badge> },
            { key: 'enqueuedAt', label: 'Entrou na fila', render: (row) => date(row.enqueuedAt, true) },
            { key: 'startedAt', label: 'Começou', render: (row) => date(row.startedAt, true) },
          ]}
          emptyText="Nenhuma execução automática na fila agora. Ações da tela das empresas (testar login, rodar agora) aparecem em Rodando agora."
        />
      </Panel>
      {data.running.length > 0 && (
        <Panel title="Sessões abertas no Porto">
          <div className="nr-pad">
            {data.running.map((item) => (
              <div className="nr-detail-row" key={item.organizationId}>
                <span>
                  {name(item.organizationId)}
                  <small>{item.name}</small>
                </span>
                <span>{Math.round(item.heldForMs / 60000)} min</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

type OwnerAlert = { key: string; kind: string; title: string; body: string; organizationIds: string[]; createdAt: string; sentAt: string | null; error: string | null };

const ALERT_KIND_LABELS: Record<string, string> = {
  porto_layout: 'Porto mudou de tela',
  porto_stuck: 'Execução travada',
  porto_queue_late: 'Fila atrasada',
  vps: 'VPS',
  worker: 'Worker',
};

export function AlertsTab({ organizationNames }: { organizationNames: Map<string, string> }) {
  const alerts = useResource<{ alerts: OwnerAlert[] }>('/alerts?limit=200');
  const [open, setOpen] = useState<OwnerAlert | null>(null);
  if (alerts.loading && !alerts.data) return <Loading />;
  if (alerts.error) return <ErrorState message={alerts.error} onRetry={alerts.reload} />;
  return (
    <>
      <Panel title="Alertas da plataforma" description="O que chegou (ou deveria ter chegado) no seu WhatsApp de alertas. Cada incidente alerta uma vez. Número e conexão em Configurações → Alertas e robô.">
        <DataTable
          rows={alerts.data!.alerts.map((alert) => ({
            ...alert,
            id: alert.key,
            kindText: ALERT_KIND_LABELS[alert.kind] ?? alert.kind,
            delivery: alert.sentAt ? 'Enviado' : 'Falhou',
            organizations: alert.organizationIds.map((id) => organizationNames.get(id) ?? id).join(', ') || '—',
          }))}
          defaultSort="createdAt"
          defaultDescending
          filters={[{ key: 'kindText', label: 'Tipo', options: Object.values(ALERT_KIND_LABELS) }]}
          columns={[
            { key: 'createdAt', label: 'Quando', render: (row) => date(row.createdAt, true) },
            { key: 'kindText', label: 'Tipo', render: (row) => <Badge>{row.kindText}</Badge> },
            { key: 'title', label: 'Alerta', render: (row) => <span className="block max-w-96 truncate">{row.title}</span> },
            { key: 'organizations', label: 'Organizações', render: (row) => <span className="block max-w-60 truncate">{row.organizations}</span> },
            { key: 'delivery', label: 'WhatsApp', render: (row) => <span title={row.error ?? ''}><Badge>{row.delivery}</Badge></span> },
          ]}
          actions={(row) => <button onClick={() => setOpen(row)}>Ver</button>}
          emptyText="Nenhum alerta enviado. Eles aparecem quando o Porto muda de tela, uma execução trava, a fila noturna atrasa ou a VPS aperta."
        />
      </Panel>
      {open && (
        <Dialog open onOpenChange={(value) => !value && setOpen(null)}>
          <DialogContent className="nr-dialog sm:max-w-2xl">
            <DialogTitle>{open.title}</DialogTitle>
            <DialogDescription>
              {date(open.createdAt, true)} · {open.sentAt ? 'enviado por WhatsApp' : `não enviado: ${open.error ?? 'motivo desconhecido'}`}
            </DialogDescription>
            <pre className="nr-code">{open.body}</pre>
            <div className="nr-dialog-actions">
              <button className="nr-btn primary" onClick={() => setOpen(null)}>Fechar</button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
