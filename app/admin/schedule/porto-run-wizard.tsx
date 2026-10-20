'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2, PlayCircle, Users, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  actionSummaryLabel,
  jobDetailActionLabel,
  formatDetailExtra,
  pollJobLog,
  type PortoJobResult,
} from '@/lib/porto-ui-helpers';

type WizardStep = 'intro' | 'match' | 'period' | 'schedule' | 'hours' | 'done';
type PeriodMode = 'month' | 'week' | 'day';

type PortoSocorristaRow = { qra: string; name: string; cpf?: string; status: string };
type MatchTechnician = {
  id: string;
  qra: string | null;
  porto_name_hint: string | null;
  name: string;
  email: string;
  commission_percentage: number;
  base_salary: number;
  va_allowance: number;
  vr_allowance: number;
  status: string;
};

type PortoConfigSummary = {
  automation_enabled: boolean;
  dry_run_only: boolean;
};

const inputClassName = 'min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring';

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDaysToKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthStartKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function periodEstimate(mode: PeriodMode) {
  switch (mode) {
    case 'month':
      return 'Estimativa: 1h30 a 2h na primeira vez (medido: 85 a 114 min por rodadas reais). Dias já importados antes são pulados, então uma segunda rodada no mesmo mês é bem mais rápida.';
    case 'week':
      return 'Estimativa: 20 a 40 minutos na primeira vez para esse período. Varia bastante com quantos serviços existirem nos dias.';
    case 'day':
      return 'Estimativa: poucos minutos (5 a 15) na maioria dos casos.';
  }
}

function periodLabel(mode: PeriodMode, day: string) {
  if (mode === 'month') return `${monthStartKey()} a ${todayKey()} (mês atual até hoje)`;
  if (mode === 'week') return `${addDaysToKey(todayKey(), -6)} a ${todayKey()} (últimos 7 dias)`;
  return day;
}

function periodRange(mode: PeriodMode, day: string): { start: string; end: string } | null {
  if (mode === 'month') return null; // omit dateRange -> job defaults to month-start..today, same as automation
  if (mode === 'week') return { start: addDaysToKey(todayKey(), -6), end: todayKey() };
  return { start: day, end: day };
}

function JobResultView({ result }: { result: PortoJobResult }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
          result.status === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : result.status === 'skipped'
              ? 'border-border bg-secondary/40 text-muted-foreground'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
        }`}
      >
        {result.status === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
        <span>
          {result.status}
          {result.error ? ` — ${result.error}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <p className="text-muted-foreground">Técnicos processados</p>
          <p className="text-lg font-semibold text-foreground">{result.technicians_processed ?? '-'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Linhas gravadas</p>
          <p className="text-lg font-semibold text-foreground">{result.rows_written ?? result.would_write ?? '-'}</p>
        </div>
      </div>

      {result.summary && Object.keys(result.summary).length ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          {Object.entries(result.summary).map(([action, count]) => (
            <span key={action}>{actionSummaryLabel(action, count)}</span>
          ))}
        </div>
      ) : null}

      {result.details && result.details.length ? (
        <div className="max-h-60 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-4">QRA</th>
                <th className="py-2 pr-4">Técnico</th>
                <th className="py-2 pr-4">Resultado</th>
                <th className="py-2">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {result.details
                .filter((detail) => detail.qra)
                .map((detail, index) => (
                  <tr key={`${detail.qra}-${index}`} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">{detail.qra}</td>
                    <td className="py-2 pr-4">{detail.technician_name || (detail.porto_name ? `${detail.porto_name} (Porto)` : '-')}</td>
                    <td className="py-2 pr-4">{jobDetailActionLabel(detail.action)}</td>
                    <td className="py-2 text-muted-foreground">{formatDetailExtra(detail)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export function PortoRunWizard() {
  const { settings: organizationSettings } = useOrganizationSettings();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('intro');
  const [config, setConfig] = useState<PortoConfigSummary | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  const [isMatchLoading, setIsMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [matchSaveMessage, setMatchSaveMessage] = useState('');
  const [isSavingMatches, setIsSavingMatches] = useState(false);
  const [portoSocorristas, setPortoSocorristas] = useState<PortoSocorristaRow[]>([]);
  const [matchTechnicians, setMatchTechnicians] = useState<MatchTechnician[]>([]);
  const [matchSelections, setMatchSelections] = useState<Record<string, string>>({});

  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [periodDay, setPeriodDay] = useState(todayKey());

  const [scheduleRunning, setScheduleRunning] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<PortoJobResult | null>(null);

  const [hoursRunning, setHoursRunning] = useState(false);
  const [hoursResult, setHoursResult] = useState<PortoJobResult | null>(null);

  async function handleOpen() {
    setOpen(true);
    setStep('intro');
    setIsLoadingConfig(true);
    try {
      const response = await fetch('/api/porto-config');
      const data = await response.json();
      setConfig({
        automation_enabled: Boolean(data.config?.automation_enabled),
        dry_run_only: data.config?.dry_run_only !== false,
      });
    } catch {
      setConfig(null);
    } finally {
      setIsLoadingConfig(false);
    }
  }

  async function handleOpenMatchStep() {
    setStep('match');
    setIsMatchLoading(true);
    setMatchError('');
    setMatchSaveMessage('');
    setPortoSocorristas([]);
    setMatchTechnicians([]);
    setMatchSelections({});
    try {
      const response = await fetch('/api/porto-config/socorristas', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao buscar técnicos do Porto.');
      const socorristas: PortoSocorristaRow[] = data.socorristas ?? [];
      const technicians: MatchTechnician[] = data.technicians ?? [];
      setPortoSocorristas(socorristas);
      setMatchTechnicians(technicians);
      const initialSelections: Record<string, string> = {};
      for (const socorrista of socorristas) {
        const matched = technicians.find((technician) => technician.qra === socorrista.qra);
        initialSelections[socorrista.qra] = matched?.id ?? '';
      }
      setMatchSelections(initialSelections);
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : 'Falha ao buscar técnicos do Porto.');
    } finally {
      setIsMatchLoading(false);
    }
  }

  async function patchTechnicianMatch(technician: MatchTechnician, overrides: { qra: string | null; porto_name_hint: string | null }) {
    const response = await fetch(`/api/technicians?id=${technician.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        qra: overrides.qra,
        porto_name_hint: overrides.porto_name_hint,
        name: technician.name,
        email: technician.email,
        commission_percentage: technician.commission_percentage,
        base_salary: technician.base_salary,
        va_allowance: technician.va_allowance,
        vr_allowance: technician.vr_allowance,
        status: technician.status,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Falha ao salvar match para o técnico ${technician.name}.`);
    }
  }

  async function handleSaveMatches() {
    setIsSavingMatches(true);
    setMatchError('');
    setMatchSaveMessage('');
    try {
      const selectedIds = Object.values(matchSelections).filter(Boolean);
      const duplicateId = selectedIds.find((id, index) => selectedIds.indexOf(id) !== index);
      if (duplicateId) {
        const duplicateTechnician = matchTechnicians.find((technician) => technician.id === duplicateId);
        throw new Error(`"${duplicateTechnician?.name ?? 'Um técnico'}" foi selecionado para mais de um QRA do Porto — corrija antes de salvar.`);
      }

      let savedCount = 0;
      for (const socorrista of portoSocorristas) {
        const previousTechnician = matchTechnicians.find((technician) => technician.qra === socorrista.qra);
        const selectedId = matchSelections[socorrista.qra] || '';
        const alreadyMatched = (previousTechnician?.id || '') === selectedId;
        if (alreadyMatched) continue;

        if (!selectedId) {
          if (previousTechnician) {
            await patchTechnicianMatch(previousTechnician, { qra: null, porto_name_hint: previousTechnician.porto_name_hint });
            savedCount++;
          }
          continue;
        }

        const technician = matchTechnicians.find((item) => item.id === selectedId);
        if (!technician) continue;
        await patchTechnicianMatch(technician, { qra: socorrista.qra, porto_name_hint: socorrista.name });
        savedCount++;
      }

      setMatchSaveMessage(savedCount ? `${savedCount} match(es) salvo(s) com sucesso.` : 'Nenhuma mudança para salvar.');
    } catch (error) {
      setMatchError(error instanceof Error ? error.message : 'Falha ao salvar matches.');
    } finally {
      setIsSavingMatches(false);
    }
  }

  async function runJob(jobType: 'hours' | 'schedule', range: { start: string; end: string } | null, setRunning: (v: boolean) => void, setResult: (r: PortoJobResult | null) => void) {
    setRunning(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ write: '1' });
      if (jobType === 'hours' && range) {
        params.set('start', range.start);
        params.set('end', range.end);
      }
      const response = await fetch(`/api/cron/porto-${jobType}?${params.toString()}`);
      const rawText = await response.text();
      let data: PortoJobResult;
      try {
        data = JSON.parse(rawText);
      } catch {
        setResult({ status: 'error', error: `Resposta inválida da Vercel (status ${response.status}).` });
        return;
      }

      if (data.status === 'started' && data.logId) {
        await pollJobLog(data.logId, (result) => setResult(result));
        return;
      }

      setResult(data);
    } catch (error) {
      setResult({ status: 'error', error: error instanceof Error ? error.message : 'Falha ao rodar.' });
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setStep('intro');
    setScheduleResult(null);
    setHoursResult(null);
    setMatchSaveMessage('');
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={handleOpen}>
        <PlayCircle className="h-4 w-4" />
        Rodar agora (Porto)
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rodar importação do Porto agora</DialogTitle>
            <DialogDescription>
              {step === 'intro' && 'Passo 1 de 4 — antes de começar'}
              {step === 'match' && 'Passo 2 de 4 — confirmar técnicos'}
              {step === 'period' && 'Passo 3 de 4 — escolher período'}
              {step === 'schedule' && 'Passo 4 de 4 — montar escala'}
              {step === 'hours' && 'Passo 4 de 4 — apontar horas'}
            </DialogDescription>
          </DialogHeader>

          {step === 'intro' ? (
            <div className="flex flex-col gap-4">
              {isLoadingConfig ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">
                      {config?.automation_enabled
                        ? 'A importação automática já está ligada — normalmente você não precisa rodar isso manualmente.'
                        : 'Atenção: a automação está desligada em Config. Porto.'}
                    </p>
                    <p className="mt-1">
                      Apontamento de horas: todo dia às {organizationSettings.portoHoursImportTime} (horário de Brasília), varre o mês
                      inteiro até hoje e pula dias já importados. Escala: todo dia às {organizationSettings.portoScheduleImportTime}{' '}
                      (horário de Brasília), reimporta de hoje até o fim do mês. Os horários ficam em Configurações.
                    </p>
                    <p className="mt-1">
                      Use este assistente só quando quiser forçar uma execução agora — por exemplo, pra ver um resultado sem esperar o
                      horário automático, ou pra importar um período específico.
                      {config && config.dry_run_only ? ' O "Modo teste" está ligado em Config. Porto — mesmo assim, esta execução vai gravar de verdade.' : ''}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button type="button" onClick={handleOpenMatchStep}>
                  Continuar
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'match' ? (
            <div className="flex flex-col gap-4">
              {isMatchLoading ? (
                <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p>Fazendo login e buscando técnicos no Porto...</p>
                </div>
              ) : matchError ? (
                <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{matchError}</span>
                </div>
              ) : (
                <>
                  {matchSaveMessage ? <p className="text-sm text-emerald-700">{matchSaveMessage}</p> : null}
                  <div className="max-h-80 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                          <th className="py-2 pr-4">QRA</th>
                          <th className="py-2 pr-4">Nome no Porto</th>
                          <th className="py-2">Técnico no sistema</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portoSocorristas.map((socorrista) => (
                          <tr key={socorrista.qra} className="border-b border-border last:border-0">
                            <td className="py-2 pr-4">{socorrista.qra}</td>
                            <td className="py-2 pr-4">{socorrista.name}</td>
                            <td className="py-2">
                              <select
                                className={inputClassName}
                                value={matchSelections[socorrista.qra] ?? ''}
                                onChange={(event) => setMatchSelections((previous) => ({ ...previous, [socorrista.qra]: event.target.value }))}
                              >
                                <option value="">-- sem correspondência --</option>
                                {matchTechnicians.map((technician) => (
                                  <option key={technician.id} value={technician.id}>
                                    {technician.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between">
                    <Button type="button" variant="outline" onClick={handleSaveMatches} disabled={isSavingMatches}>
                      {isSavingMatches ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                      Salvar matches
                    </Button>
                    <Button type="button" onClick={() => setStep('period')}>
                      Continuar
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {step === 'period' ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {(['month', 'week', 'day'] as PeriodMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPeriodMode(mode)}
                    className={`rounded-md border p-3 text-left text-sm transition ${
                      periodMode === mode ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary/40'
                    }`}
                  >
                    <p className="font-medium text-foreground">{mode === 'month' ? 'Mensal' : mode === 'week' ? 'Semanal' : 'Um dia'}</p>
                  </button>
                ))}
              </div>

              {periodMode === 'day' ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">Data</label>
                  <input type="date" value={periodDay} onChange={(event) => setPeriodDay(event.target.value)} className={inputClassName} />
                </div>
              ) : null}

              <div className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
                <p>
                  Período: <span className="font-medium text-foreground">{periodLabel(periodMode, periodDay)}</span>
                </p>
                <p className="mt-1">{periodEstimate(periodMode)}</p>
                <p className="mt-1">
                  A escala do Porto só permite importar o <span className="font-medium text-foreground">mês atual</span> — esse período
                  vale só para o apontamento de horas (próxima etapa).
                </p>
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => setStep('schedule')}>
                  Continuar
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'schedule' ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Vai buscar a escala do mês atual no Porto e gravar em <span className="font-medium text-foreground">/admin/schedule</span>.
                Pode levar alguns minutos.
              </p>

              {scheduleRunning ? (
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p>Rodando... você pode fechar essa janela e conferir depois em Config. Porto ou direto em /admin/schedule.</p>
                </div>
              ) : scheduleResult ? (
                <JobResultView result={scheduleResult} />
              ) : null}

              <div className="flex items-center justify-between">
                <Button type="button" variant="outline" onClick={() => runJob('schedule', null, setScheduleRunning, setScheduleResult)} disabled={scheduleRunning}>
                  {scheduleRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  {scheduleResult ? 'Rodar de novo' : 'Montar escala agora'}
                </Button>
                <Button type="button" onClick={() => setStep('hours')} disabled={scheduleRunning}>
                  {scheduleResult ? 'Continuar' : 'Pular esta etapa'}
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}

          {step === 'hours' ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Vai buscar apontamentos no período <span className="font-medium text-foreground">{periodLabel(periodMode, periodDay)}</span> e
                gravar em <span className="font-medium text-foreground">/admin/schedule</span>. {periodEstimate(periodMode)}
              </p>

              {hoursRunning ? (
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <p>Rodando... você pode fechar essa janela e conferir depois em Config. Porto ou direto em /admin/schedule.</p>
                </div>
              ) : hoursResult ? (
                <JobResultView result={hoursResult} />
              ) : null}

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => runJob('hours', periodRange(periodMode, periodDay), setHoursRunning, setHoursResult)}
                  disabled={hoursRunning}
                >
                  {hoursRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  {hoursResult ? 'Rodar de novo' : 'Apontar horas agora'}
                </Button>
                <Button type="button" onClick={() => setOpen(false)} disabled={hoursRunning}>
                  Concluir
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
