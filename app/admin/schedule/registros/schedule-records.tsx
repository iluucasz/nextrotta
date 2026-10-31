'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Search } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { brasiliaDateKey, formatDate, normalizeText } from '@/lib/formatters';
import { getScheduleDisplayLabel, getScheduleDisplayTone, getScheduleObservation, getScheduleTimeLabel } from '@/lib/schedule-display';
import { getScheduleRange } from '@/lib/schedule-planner';
import type { Schedule, Technician } from '@/lib/types';

const PAGE_SIZE = 100;

const inputClassName = 'min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';

function dateKeyOf(value: string) {
  return String(value).slice(0, 10);
}

export function ScheduleRecords() {
  const { user, loading } = useAppSession();
  const { settings } = useOrganizationSettings();
  const [records, setRecords] = useState<Schedule[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [month, setMonth] = useState(() => brasiliaDateKey().slice(0, 7));
  const [allHistory, setAllHistory] = useState(false);
  const [technicianId, setTechnicianId] = useState('all');
  const [statusLabel, setStatusLabel] = useState('all');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setIsLoading(true);
    setError('');

    const params = new URLSearchParams();
    const [year, monthNumber] = month.split('-').map(Number);
    if (!allHistory && Number.isInteger(year) && Number.isInteger(monthNumber)) {
      const range = getScheduleRange('month', year, monthNumber);
      params.set('startDate', range.startDate);
      params.set('endDate', range.endDate);
    }

    Promise.all([
      fetch(params.size ? `/api/schedule?${params.toString()}` : '/api/schedule').then((response) => (response.ok ? response.json() : Promise.reject(new Error('escala')))),
      fetch('/api/technicians').then((response) => (response.ok ? response.json() : Promise.reject(new Error('técnicos')))),
    ])
      .then(([scheduleData, techniciansData]) => {
        if (cancelled) return;
        setRecords(Array.isArray(scheduleData.schedules) ? scheduleData.schedules : []);
        setTechnicians(Array.isArray(techniciansData.technicians) ? techniciansData.technicians : []);
      })
      .catch((failure: Error) => {
        if (!cancelled) setError(`Não foi possível carregar os registros (${failure.message}). Tente de novo em instantes.`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, month, allHistory]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [technicianId, statusLabel, query, month, allHistory]);

  const activeTechnicians = useMemo(
    () => technicians.filter((technician) => technician.status === 'active').sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')),
    [technicians],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(records.map((item) => getScheduleDisplayLabel(item)))).sort((left, right) => left.localeCompare(right, 'pt-BR')),
    [records],
  );

  const filtered = useMemo(() => {
    const search = normalizeText(query);

    return records
      .filter((item) => technicianId === 'all' || item.technician_id === technicianId)
      .filter((item) => statusLabel === 'all' || getScheduleDisplayLabel(item) === statusLabel)
      .filter((item) => {
        if (!search) return true;
        const text = normalizeText(`${item.technician_name || ''} ${formatDate(item.date)} ${dateKeyOf(item.date)} ${getScheduleDisplayLabel(item)} ${getScheduleObservation(item)}`);
        return text.includes(search);
      })
      .sort((left, right) => dateKeyOf(right.date).localeCompare(dateKeyOf(left.date)) || (left.technician_name || '').localeCompare(right.technician_name || '', 'pt-BR'));
  }, [records, technicianId, statusLabel, query]);

  if (loading || !user) {
    return <LoadingShell role="admin" />;
  }

  const shown = filtered.slice(0, visibleCount);
  const periodLabel = allHistory ? 'todo o histórico' : 'no mês escolhido';

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Planejamento"
        title="Registros da escala"
        description="O histórico da escala: cada dia de cada técnico, com o horário, a situação e a observação. Para montar ou mudar a escala, use a página Escala."
      />

      <DataPanel
        title="Histórico"
        description={isLoading ? 'Carregando…' : `${filtered.length === 1 ? '1 registro' : `${filtered.length} registros`} ${allHistory ? 'em' : ''} ${periodLabel}.`.replace(/\s+/g, ' ')}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto]">
          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Técnico</span>
            <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)} className={inputClassName}>
              <option value="all">Todos os técnicos</option>
              {activeTechnicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Mês</span>
            <input
              type="month"
              value={month}
              disabled={allHistory}
              onChange={(event) => event.target.value && setMonth(event.target.value)}
              className={inputClassName}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1.5 block font-medium">Situação</span>
            <select value={statusLabel} onChange={(event) => setStatusLabel(event.target.value)} className={inputClassName}>
              <option value="all">Todas</option>
              {statusOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button type="button" variant={allHistory ? 'default' : 'outline'} className="min-h-10 w-full" onClick={() => setAllHistory((value) => !value)}>
              {allHistory ? 'Voltar para um mês' : 'Ver todo o histórico'}
            </Button>
          </div>
        </div>

        <div className="mb-4 flex min-h-10 items-center gap-2 rounded-lg border border-input bg-background px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por técnico, data, situação ou observação"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>

        {error ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

        {shown.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pr-4 font-medium">Data</th>
                    <th className="py-3 pr-4 font-medium">Técnico</th>
                    <th className="py-3 pr-4 font-medium">Horário</th>
                    <th className="py-3 pr-4 font-medium">Situação</th>
                    <th className="py-3 font-medium">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 whitespace-nowrap">{formatDate(item.date)}</td>
                      <td className="py-3 pr-4">{item.technician_name || item.technician_id}</td>
                      <td className="py-3 pr-4 whitespace-nowrap">{getScheduleTimeLabel(item, settings.defaultShiftStart, settings.defaultShiftEnd)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge tone={getScheduleDisplayTone(item)}>{getScheduleDisplayLabel(item)}</StatusBadge>
                      </td>
                      <td className="py-3 text-muted-foreground">{getScheduleObservation(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {shown.length < filtered.length ? (
              <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>
                  Mostrando {shown.length} de {filtered.length}.
                </span>
                <Button type="button" variant="outline" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                  Mostrar mais {Math.min(PAGE_SIZE, filtered.length - shown.length)}
                </Button>
              </div>
            ) : null}
          </>
        ) : isLoading ? null : (
          <EmptyState
            icon={CalendarDays}
            title="Nenhum registro encontrado"
            description={
              records.length
                ? 'Nenhum registro bate com os filtros escolhidos. Limpe a busca ou troque o técnico e a situação.'
                : allHistory
                  ? 'Ainda não há escala salva. Monte a escala na página Escala e os registros vão aparecer aqui.'
                  : 'Não há escala salva neste mês. Escolha outro mês ou veja todo o histórico.'
            }
          />
        )}
      </DataPanel>
    </AppShell>
  );
}
