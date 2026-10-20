'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileSpreadsheet, Loader2, MessageCircle, RefreshCw, RotateCw } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  MESSAGE_STATUS_LABELS,
  MESSAGE_STATUSES,
  MESSAGE_TRIGGER_LABELS,
  MESSAGE_TYPE_LABELS,
  NOTIFICATION_TYPES,
  type MessageStatus,
  type MessageTrigger,
} from '@/lib/whatsapp/notification-types';
import { inputClassName, type TechnicianOption } from './types';

type PeriodMode = 'daily' | 'monthly' | 'yearly' | 'custom' | 'all';

const periodModes: Array<{ value: PeriodMode; label: string }> = [
  { value: 'daily', label: 'Diário' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly', label: 'Anual' },
  { value: 'custom', label: 'Personalizado' },
  { value: 'all', label: 'Tudo' },
];

interface HistoryMessage {
  id: string;
  technician_id: string | null;
  technician_name: string | null;
  phone: string | null;
  type: string;
  trigger_kind: MessageTrigger;
  reference_date: string | null;
  message: string;
  status: MessageStatus;
  error: string | null;
  redirected_to_test: boolean;
  created_at: string;
  sent_at: string | null;
}

interface HistoryResponse {
  messages: HistoryMessage[];
  total: number;
  byStatus: Partial<Record<MessageStatus, number>>;
  page: number;
  pageSize: number;
  truncated?: boolean;
}

const statusTone: Record<MessageStatus, 'success' | 'danger' | 'warning' | 'info'> = {
  sent: 'success',
  failed: 'danger',
  skipped: 'warning',
  pending: 'info',
};

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function lastDayOfMonth(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return `${monthKey}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}

function formatDateKey(value: string | null) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

interface MultiSelectProps {
  label: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
}

/** Empty selection means "all" — the filter only narrows once something is ticked. */
function MultiSelect({ label, allLabel, options, selected, onChange }: MultiSelectProps) {
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((option) => option.value === selected[0])?.label ?? '1 selecionado'
        : `${selected.length} selecionados`;

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  return (
    <div className="text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={`${inputClassName} flex items-center justify-between gap-2 text-left`}>
            <span className="truncate">{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {options.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary">
                <Checkbox checked={selected.includes(option.value)} onCheckedChange={() => toggle(option.value)} />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
          </div>
          {selected.length ? (
            <button type="button" onClick={() => onChange([])} className="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-secondary">
              Limpar seleção
            </button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface HistoryPanelProps {
  technicians: TechnicianOption[];
}

export function HistoryPanel({ technicians }: HistoryPanelProps) {
  const today = todayLocal();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('monthly');
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [customStart, setCustomStart] = useState(`${today.slice(0, 7)}-01`);
  const [customEnd, setCustomEnd] = useState(today);
  const [technicianIds, setTechnicianIds] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [confirmResend, setConfirmResend] = useState<HistoryMessage | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const range = useMemo(() => {
    if (periodMode === 'daily') return { start: day, end: day, label: day };
    if (periodMode === 'monthly') return { start: `${month}-01`, end: lastDayOfMonth(month), label: month };
    if (periodMode === 'yearly') return { start: `${year}-01-01`, end: `${year}-12-31`, label: year };
    if (periodMode === 'custom') return { start: customStart, end: customEnd, label: `${customStart}_a_${customEnd}` };
    return { start: '', end: '', label: 'completo' };
  }, [customEnd, customStart, day, month, periodMode, year]);

  const buildQuery = useCallback(
    (extra: Record<string, string>) => {
      const params = new URLSearchParams(extra);
      if (range.start) params.set('start', range.start);
      if (range.end) params.set('end', range.end);
      if (technicianIds.length) params.set('technicianIds', technicianIds.join(','));
      if (types.length) params.set('types', types.join(','));
      if (statuses.length) params.set('statuses', statuses.join(','));
      return params.toString();
    },
    [range.end, range.start, statuses, technicianIds, types],
  );

  // Any filter change goes back to the first page.
  useEffect(() => {
    setPage(1);
  }, [buildQuery]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setIsLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/whatsapp/messages?${buildQuery({ page: String(page) })}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || 'Não foi possível carregar o histórico.');
        if (mounted) setData(body);
      } catch (loadError) {
        if (mounted) setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o histórico.');
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, [buildQuery, page, reloadToken]);

  const technicianOptions = useMemo(
    () =>
      technicians.map((technician) => ({
        value: technician.id,
        label: technician.status === 'inactive' ? `${technician.name} (inativo)` : technician.name,
      })),
    [technicians],
  );
  const typeOptions = [...NOTIFICATION_TYPES, 'test' as const, 'parts_sale' as const].map((type) => ({ value: type, label: MESSAGE_TYPE_LABELS[type] }));
  const statusOptions = MESSAGE_STATUSES.map((status) => ({ value: status, label: MESSAGE_STATUS_LABELS[status] }));
  const yearOptions = Array.from({ length: 5 }, (_, index) => String(Number(today.slice(0, 4)) - index));

  async function handleExport(format: 'xlsx' | 'csv') {
    setExporting(format);
    setError('');

    try {
      const response = await fetch(`/api/whatsapp/messages?${buildQuery({ export: '1' })}`);
      const body = (await response.json().catch(() => null)) as HistoryResponse | null;
      if (!response.ok || !body) throw new Error((body as { error?: string } | null)?.error || 'Não foi possível exportar.');

      const rows = body.messages.map((message) => ({
        'Data do envio': formatDateTime(message.created_at),
        Técnico: message.technician_name ?? '-',
        Telefone: message.phone ?? '-',
        Notificação: MESSAGE_TYPE_LABELS[message.type as keyof typeof MESSAGE_TYPE_LABELS] ?? message.type,
        Origem: MESSAGE_TRIGGER_LABELS[message.trigger_kind] ?? message.trigger_kind,
        Status: MESSAGE_STATUS_LABELS[message.status] ?? message.status,
        Erro: message.error ?? '',
        'Data de referência': formatDateKey(message.reference_date),
        'Desviada para teste': message.redirected_to_test ? 'Sim' : 'Não',
        Mensagem: message.message,
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Envios');

      const technicianLabel =
        technicianIds.length === 1
          ? (technicians.find((technician) => technician.id === technicianIds[0])?.name ?? 'tecnico').replace(/\s+/g, '-').toLowerCase()
          : technicianIds.length
            ? `${technicianIds.length}-tecnicos`
            : 'todos';
      XLSX.writeFile(workbook, `whatsapp-envios_${range.label}_${technicianLabel}.${format}`, { bookType: format });

      if (body.truncated) {
        setError(`A exportação foi limitada às ${body.messages.length} mensagens mais recentes. Refine os filtros para exportar o restante.`);
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Não foi possível exportar.');
    } finally {
      setExporting(null);
    }
  }

  async function handleResend(message: HistoryMessage) {
    setConfirmResend(null);
    setResendingId(message.id);
    setError('');

    try {
      const response = await fetch('/api/whatsapp/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend', id: message.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Não foi possível reenviar.');
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Não foi possível reenviar.');
    } finally {
      setResendingId(null);
      setReloadToken((value) => value + 1);
    }
  }

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <DataPanel
        title="Filtros"
        description="Escolha exatamente o que ver e baixar. Sem técnico, tipo ou status marcados, entram todos."
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((value) => value + 1)} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
            <Button type="button" size="sm" onClick={() => handleExport('xlsx')} disabled={Boolean(exporting) || !data?.total} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {exporting === 'xlsx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Baixar Excel
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={Boolean(exporting) || !data?.total}>
              {exporting === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Baixar CSV
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Período</span>
            <select value={periodMode} onChange={(event) => setPeriodMode(event.target.value as PeriodMode)} className={inputClassName}>
              {periodModes.map((mode) => (
                <option key={mode.value} value={mode.value}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>

          <div className="text-sm">
            <span className="mb-1.5 block font-medium">
              {periodMode === 'daily' ? 'Dia' : periodMode === 'monthly' ? 'Mês' : periodMode === 'yearly' ? 'Ano' : periodMode === 'custom' ? 'De / até' : 'Datas'}
            </span>
            {periodMode === 'daily' ? (
              <input type="date" value={day} onChange={(event) => event.target.value && setDay(event.target.value)} className={inputClassName} />
            ) : periodMode === 'monthly' ? (
              <input type="month" value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} className={inputClassName} />
            ) : periodMode === 'yearly' ? (
              <select value={year} onChange={(event) => setYear(event.target.value)} className={inputClassName}>
                {yearOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : periodMode === 'custom' ? (
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={customStart} onChange={(event) => event.target.value && setCustomStart(event.target.value)} className={inputClassName} />
                <input type="date" value={customEnd} onChange={(event) => event.target.value && setCustomEnd(event.target.value)} className={inputClassName} />
              </div>
            ) : (
              <p className="flex min-h-10 items-center text-muted-foreground">Todo o histórico</p>
            )}
          </div>

          <MultiSelect label="Técnicos" allLabel="Todos os técnicos" options={technicianOptions} selected={technicianIds} onChange={setTechnicianIds} />
          <MultiSelect label="Notificação" allLabel="Todas" options={typeOptions} selected={types} onChange={setTypes} />
          <MultiSelect label="Status" allLabel="Todos" options={statusOptions} selected={statuses} onChange={setStatuses} />
        </div>
      </DataPanel>

      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

      <DataPanel
        title="Envios"
        description={data ? `${data.total} mensagem(ns) no filtro.` : 'Carregando...'}
        action={
          data ? (
            <div className="flex flex-wrap gap-2">
              {MESSAGE_STATUSES.filter((status) => data.byStatus[status]).map((status) => (
                <StatusBadge key={status} tone={statusTone[status]}>
                  {MESSAGE_STATUS_LABELS[status]}: {data.byStatus[status]}
                </StatusBadge>
              ))}
            </div>
          ) : null
        }
      >
        {data && data.messages.length ? (
          <div className="overflow-hidden rounded-md border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-240 text-sm">
                <thead className="bg-secondary text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-3 text-left font-medium">Envio</th>
                    <th className="px-3 py-3 text-left font-medium">Técnico</th>
                    <th className="px-3 py-3 text-left font-medium">Notificação</th>
                    <th className="px-3 py-3 text-left font-medium">Status</th>
                    <th className="px-3 py-3 text-left font-medium">Mensagem</th>
                    <th className="px-3 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {data.messages.map((message) => {
                    const expanded = expandedId === message.id;

                    return (
                      <tr key={message.id} className="border-t border-border align-top">
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatDateTime(message.created_at)}</td>
                        <td className="px-3 py-3">
                          <span className="block font-medium">{message.technician_name ?? '—'}</span>
                          <span className="block text-xs text-muted-foreground">
                            {message.phone ?? 'sem telefone'}
                            {message.redirected_to_test ? ' · número de teste' : ''}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="block">{MESSAGE_TYPE_LABELS[message.type as keyof typeof MESSAGE_TYPE_LABELS] ?? message.type}</span>
                          <span className="block text-xs text-muted-foreground">
                            {MESSAGE_TRIGGER_LABELS[message.trigger_kind] ?? message.trigger_kind}
                            {message.reference_date ? ` · ref. ${formatDateKey(message.reference_date)}` : ''}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={statusTone[message.status] ?? 'neutral'}>{MESSAGE_STATUS_LABELS[message.status] ?? message.status}</StatusBadge>
                          {message.error ? <span className="mt-1 block max-w-56 text-xs text-rose-700">{message.error}</span> : null}
                        </td>
                        <td className="max-w-md px-3 py-3">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : message.id)}
                            className={`text-left text-muted-foreground hover:text-foreground ${expanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}`}
                            title={expanded ? 'Recolher' : 'Ver mensagem completa'}
                          >
                            {message.message}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {message.status !== 'pending' ? (
                            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmResend(message)} disabled={resendingId === message.id}>
                              {resendingId === message.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                              Reenviar
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border bg-card px-3 py-2 text-sm text-muted-foreground">
              <span>
                Página {page} de {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1 || isLoading}
                aria-label="Página anterior"
                className="rounded-md p-1 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                disabled={page >= pageCount || isLoading}
                aria-label="Próxima página"
                className="rounded-md p-1 transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <EmptyState icon={MessageCircle} title="Nenhum envio no filtro" description="Ajuste o período, os técnicos ou o status para ver outros envios." />
        )}
      </DataPanel>

      <AlertDialog open={Boolean(confirmResend)} onOpenChange={(open) => !open && setConfirmResend(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reenviar esta mensagem?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <span className="block space-y-2">
                <span className="block">
                  O mesmo texto vai de novo para {confirmResend?.technician_name ?? 'o destinatário'}, no número cadastrado hoje.
                </span>
                <span className="block max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-2 text-xs">
                  {confirmResend?.message}
                </span>
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button type="button" onClick={() => confirmResend && handleResend(confirmResend)}>
              Reenviar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
