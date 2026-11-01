'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { modeFlags, type PortoConfigLite, type PortoMode, type TechnicianLite } from '@/lib/porto-status';
import { logToJobResult, pollJobLog, type PortoJobResult, type PortoSyncLog } from '@/lib/porto-ui-helpers';

export type PortoConfig = PortoConfigLite & {
  last_hours_import_at: string | null;
  last_schedule_check_at: string | null;
  updated_at: string | null;
};

export type FullTechnician = TechnicianLite & {
  email: string;
  porto_name_hint: string | null;
  commission_percentage: number;
  base_salary: number;
  va_allowance: number;
  vr_allowance: number;
};

export type LoginResult = { success: boolean; message: string; screenshotUrl?: string | null };

const EMPTY: PortoConfig = {
  cpf: '',
  has_password: false,
  automation_enabled: false,
  dry_run_only: true,
  last_hours_import_at: null,
  last_schedule_check_at: null,
  updated_at: null,
};

async function readJson(response: Response) {
  return response.json().catch(() => ({}) as Record<string, unknown>);
}

/**
 * Everything the Config. Porto screen needs: the settings and the last runs, the technicians, whether the robot's
 * server answers, and the few things the person can do (save the account or the mode, test the login, simulate).
 */
export function usePorto() {
  const [config, setConfig] = useState<PortoConfig>(EMPTY);
  const [logs, setLogs] = useState<PortoSyncLog[]>([]);
  const [technicians, setTechnicians] = useState<FullTechnician[]>([]);
  const [serverDown, setServerDown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);

  // The simulation window: opens on a run, follows it to the end, and can be reopened on any past run.
  const [running, setRunning] = useState<'hours' | 'schedule' | null>(null);
  const [jobDialog, setJobDialog] = useState<{ job: 'hours' | 'schedule'; result: PortoJobResult | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configResponse, techniciansResponse, statusResponse] = await Promise.all([
        fetch('/api/porto-config', { cache: 'no-store' }),
        fetch('/api/technicians', { cache: 'no-store' }),
        fetch('/api/system-status', { cache: 'no-store' }).catch(() => null),
      ]);
      if (!configResponse.ok) throw new Error('Não foi possível carregar a configuração do Porto.');
      const data = await configResponse.json();
      const techniciansData = techniciansResponse.ok ? await techniciansResponse.json() : { technicians: [] };
      const status = statusResponse?.ok ? await statusResponse.json().catch(() => null) : null;
      if (!mounted.current) return;
      setConfig({ ...EMPTY, ...data.config });
      setLogs(data.logs ?? []);
      setTechnicians(Array.isArray(techniciansData.technicians) ? techniciansData.technicians : []);
      setServerDown(status?.porto === 'down');
      setLoaded(true);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  /** Saves the account and/or the mode. Anything left out keeps what is saved. The password is only sent when typed. */
  async function save(change: { cpf?: string; password?: string; mode?: PortoMode }) {
    const flags = change.mode ? modeFlags(change.mode) : { automation_enabled: config.automation_enabled, dry_run_only: config.dry_run_only };
    const response = await fetch('/api/porto-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: change.cpf ?? config.cpf, password: change.password || undefined, ...flags }),
    });
    const data = await readJson(response);
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Não foi possível salvar.');
    setConfig({ ...EMPTY, ...(data.config as PortoConfig) });
  }

  async function testLogin(): Promise<LoginResult> {
    try {
      const response = await fetch('/api/porto-config/test-login', { method: 'POST' });
      const data = await readJson(response);
      await load();
      if (!response.ok) return { success: false, message: typeof data.error === 'string' ? data.error : 'Não foi possível entrar no Porto.', screenshotUrl: (data.screenshotUrl as string | null) ?? null };
      return { success: true, message: typeof data.message === 'string' ? data.message : 'Login realizado com sucesso.' };
    } catch {
      return { success: false, message: 'Não foi possível falar com o servidor do robô. Tente de novo em instantes.' };
    }
  }

  /** Runs a job without writing anything and follows it to the end in the dialog. `range` is for the hours job only. */
  async function simulate(job: 'hours' | 'schedule', range?: { start: string; end: string }) {
    setRunning(job);
    setJobDialog({ job, result: null });
    try {
      const params = new URLSearchParams();
      if (job === 'hours' && range?.start) {
        params.set('start', range.start);
        params.set('end', range.end || range.start);
      }
      const response = await fetch(`/api/cron/porto-${job === 'hours' ? 'hours' : 'schedule'}${params.toString() ? `?${params}` : ''}`);
      const text = await response.text();
      let data: PortoJobResult;
      try {
        data = JSON.parse(text);
      } catch {
        // The route always answers JSON; anything else means the platform cut the call off.
        setJobDialog({ job, result: { status: 'error', error: `A execução não terminou a tempo (status ${response.status}). Tente de novo.` } });
        return;
      }

      if (data.status === 'started' && data.logId) {
        // The robot answers at once and keeps working: follow its log until it is done (a month can take minutes).
        await pollJobLog(data.logId, (result, _log, fresh) => {
          setJobDialog({ job, result });
          if (fresh.length) setLogs(fresh);
        });
        return;
      }
      setJobDialog({ job, result: data });
    } catch (reason) {
      setJobDialog({ job, result: { status: 'error', error: reason instanceof Error ? reason.message : 'Não foi possível simular.' } });
    } finally {
      setRunning(null);
      void load();
    }
  }

  function openRun(log: PortoSyncLog) {
    setJobDialog({ job: log.job_type, result: logToJobResult(log) });
  }

  return { config, logs, technicians, serverDown, loading, loaded, error, load, save, testLogin, simulate, running, jobDialog, closeJobDialog: () => setJobDialog(null), openRun };
}

export type PortoApi = ReturnType<typeof usePorto>;
