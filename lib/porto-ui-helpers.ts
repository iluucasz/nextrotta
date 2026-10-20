// Pure display helpers shared between app/admin/config-porto (test runs, history) and
// app/admin/schedule's "Rodar agora" wizard — both render the same job-result/job-log shape.

export type PortoJobDetail = Record<string, unknown> & {
  qra?: string;
  action?: string;
  technician_name?: string;
  porto_name?: string;
};

export type PortoJobResult = {
  status: string;
  technicians_processed?: number;
  would_write?: number;
  rows_written?: number;
  range?: { start: string; end: string };
  summary?: Record<string, number>;
  details?: PortoJobDetail[];
  error?: string;
  logId?: string;
};

export type PortoSyncLog = {
  id: string;
  job_type: 'hours' | 'schedule';
  started_at: string;
  finished_at: string | null;
  status: string;
  technicians_processed: number;
  rows_written: number;
  error_message: string | null;
  details: PortoJobDetail[] | null;
  range_start: string | null;
  range_end: string | null;
  /** The run points at a Porto screen change (lib/porto-layout.ts). */
  layout_suspect?: boolean;
};

export function jobDetailActionLabel(action: string | undefined) {
  switch (action) {
    case 'imported':
    case 'would_import':
      return 'Importado';
    case 'skipped_no_match':
      return 'Sem técnico correspondente no sistema';
    case 'no_services':
      return 'Nenhum serviço encontrado no período';
    case 'already_imported':
      return 'Já importado antes (pulado)';
    case 'no_completion_time':
      return 'Sem horário de conclusão encontrado';
    case 'invalid_hours':
      return 'Horas calculadas inválidas';
    case 'escala_fetch_failed':
    case 'escala_fetch_failed_fallback_0800':
      return 'Falha ao buscar escala (usou 08:00 como aproximação)';
    case 'check_only':
      return 'Só checagem — mês já importado';
    case 'time_budget_exceeded_stopping_early':
      return 'Execução parou por limite de tempo (continua na próxima)';
    case 'service_detail_failed':
      return 'Falha ao abrir detalhe de um serviço (pulado)';
    case 'start_time_fallback_escala':
      return 'Sem "Hora Prevista" válida — usou horário da escala como aproximação';
    case 'start_from_timeline':
      return 'Hora Prevista depois do fim — início pelo horário "Em Execução" do serviço';
    case 'no_escala_on_porto':
      return 'Sem escala no Porto neste mês — escala do sistema mantida';
    case 'next_month_not_published':
      return 'Escala do mês seguinte ainda não publicada no Porto (não importada)';
    case 'warning_kept':
      return 'Dia com advertência — mantido, não é recalculado';
    case 'manual_entry_kept':
      return 'Dia lançado à mão — mantido, o robô não sobrescreve';
    case 'no_concluded_service':
      return 'Nenhum serviço concluído no dia (só cancelados/aceitos)';
    case 'laudo_unreadable_used_concluido':
      return 'Laudo não pôde ser lido — usou o Concluído, sem advertência';
    case 'technician_not_in_porto_list':
      return 'Técnico ativo com QRA que não aparece na lista do Porto';
    case 'service_name_not_in_porto_list':
      return 'Serviços com nome de socorrista fora da lista do Porto (ignorados)';
    case 'ambiguous_service_name':
      return 'Nome de socorrista que bate com mais de um técnico (ignorado)';
    default:
      return action || '-';
  }
}

export function formatDetailExtra(detail: PortoJobDetail) {
  const { qra, action, technician_id, technician_name, porto_name, ...rest } = detail;
  const entries = Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return '-';
  return entries.map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join('; ');
}

export function actionSummaryLabel(action: string, count: number) {
  return `${jobDetailActionLabel(action)}: ${count}`;
}

export function summarizeDetails(details: PortoJobDetail[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const detail of details) {
    const action = typeof detail.action === 'string' ? detail.action : 'unknown';
    counts[action] = (counts[action] ?? 0) + 1;
  }
  return counts;
}

export function formatDateTime(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

export function statusLabel(status: string | null) {
  if (status === 'success') return 'Sucesso';
  if (status === 'partial') return 'Parcial';
  if (status === 'error') return 'Erro';
  if (status === 'skipped') return 'Ignorado (automação desligada)';
  if (status === 'running') return 'Em execução';
  if (status === 'dry_run') return 'Modo teste (simulado, nada gravado)';
  return '-';
}

export function jobTypeLabel(jobType: string) {
  return jobType === 'hours' ? 'Apontamento de horas' : 'Escala';
}

export function logToJobResult(log: PortoSyncLog): PortoJobResult {
  const details = log.details ?? [];
  return {
    status: log.status,
    technicians_processed: log.technicians_processed,
    rows_written: log.rows_written,
    range: log.range_start ? { start: log.range_start, end: log.range_end || log.range_start } : undefined,
    summary: details.length ? summarizeDetails(details) : undefined,
    details,
    error: log.error_message || undefined,
  };
}

export const JOB_POLL_INTERVAL_MS = 4000;
export const JOB_POLL_MAX_MS = 30 * 60 * 1000; // generous ceiling for a full-month sweep with no server-side time limit

/**
 * Polls GET /api/porto-config for a specific sync_log row (by id) until it leaves 'running',
 * calling onUpdate with the mapped result each tick (including while still running, so a caller
 * can show live progress) — used by both the admin UI's manual test button and the "Rodar agora"
 * wizard, since both trigger a job asynchronously (see worker/server.ts) and need to watch for it
 * to finish without blocking on Vercel's own execution-time limit.
 */
export async function pollJobLog(logId: string, onUpdate: (result: PortoJobResult, log: PortoSyncLog | null, allLogs: PortoSyncLog[]) => void): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < JOB_POLL_MAX_MS) {
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    try {
      const response = await fetch('/api/porto-config');
      const data = await response.json();
      const freshLogs: PortoSyncLog[] = data.logs ?? [];
      const match = freshLogs.find((log) => log.id === logId) ?? null;
      if (match && match.status !== 'running') {
        onUpdate(logToJobResult(match), match, freshLogs);
        return;
      }
    } catch {
      // transient hiccup while polling — just try again next tick
    }
  }
  onUpdate(
    {
      status: 'error',
      error: 'A execução continua rodando na VPS, mas parei de acompanhar por aqui depois de 30 minutos. Confira o resultado mais tarde no histórico de execuções (Config. Porto).',
    },
    null,
    [],
  );
}
