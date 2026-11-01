'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, LoaderCircle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { AccountDialog } from '@/components/porto/account-dialog';
import { Activity } from '@/components/porto/activity';
import { JobDialog } from '@/components/porto/job-dialog';
import { MatchDialog } from '@/components/porto/match-dialog';
import { Advanced, LiveConfirm } from '@/components/porto/panels';
import { Settings } from '@/components/porto/settings';
import { Hero, Problems, type PortoAction } from '@/components/porto/status';
import { usePorto } from '@/components/porto/use-porto';
import '@/components/porto/porto.css';
import '../dashboard-gerencial/management-dashboard.css';
import { useAppSession } from '@/hooks/use-app-session';
import { useOrganizationSettings } from '@/hooks/use-organization-settings';
import { buildPortoStatus, modeOf, type PortoMode } from '@/lib/porto-status';
import { PortoRunWizard } from './porto-run-wizard';

type Dialog = 'account' | 'match' | 'live' | null;

export default function ConfigPortoPage() {
  const { user, loading: sessionLoading } = useAppSession();
  const { settings } = useOrganizationSettings();
  const api = usePorto();
  const { config, logs, technicians, serverDown, loaded, error, loading } = api;

  const [dialog, setDialog] = useState<Dialog>(null);
  const [wizardSignal, setWizardSignal] = useState(0);
  const [savingMode, setSavingMode] = useState(false);
  const [testingLogin, setTestingLogin] = useState(false);
  const [toast, setToast] = useState<{ message: string; bad?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "hoje às 23:00" must not go stale while the page stays open.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const notify = useCallback((message: string, bad = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, bad });
    toastTimer.current = setTimeout(() => setToast(null), bad ? 6000 : 4000);
  }, []);

  const times = useMemo(() => ({ hours: settings.portoHoursImportTime, schedule: settings.portoScheduleImportTime }), [settings.portoHoursImportTime, settings.portoScheduleImportTime]);
  const status = useMemo(
    () => buildPortoStatus({ config, logs, technicians, times, now, serverDown }),
    [config, logs, technicians, times, now, serverDown],
  );

  const hasCredentials = Boolean(config.cpf) && config.has_password;
  const loginFailed = hasCredentials && config.last_login_test_ok === false;
  const mode = modeOf(config);
  const busy = api.running !== null;

  async function changeMode(next: PortoMode) {
    setSavingMode(true);
    try {
      await api.save({ mode: next });
      notify(next === 'off' ? 'Importação desligada.' : next === 'test' ? 'Em teste: nada será gravado.' : 'Ligada de verdade. O robô grava todo dia.');
      setDialog(null);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Não foi possível salvar.', true);
    } finally {
      setSavingMode(false);
    }
  }

  async function testLogin() {
    setTestingLogin(true);
    const result = await api.testLogin();
    setTestingLogin(false);
    notify(result.success ? 'O login no Porto funcionou.' : result.message, !result.success);
  }

  function act(action: PortoAction) {
    switch (action) {
      case 'connect':
      case 'account':
        return setDialog('account');
      case 'test-login':
        return void testLogin();
      case 'match':
        return setDialog('match');
      case 'simulate':
        return void api.simulate('hours');
      case 'mode-test':
        return void changeMode('test');
      case 'mode-live':
        return setDialog('live');
      case 'wizard':
        return setWizardSignal((value) => value + 1);
      case 'logs':
        return document.getElementById('atividade')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  if (sessionLoading || !user) {
    return (
      <AppShell role="admin" userName={user?.name || user?.email}>
        <div className="mg-dashboard">
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={25} />
            <strong>Carregando</strong>
          </div>
        </div>
      </AppShell>
    );
  }

  // The first problem is already the hero's headline when it needs attention: the list shows the others.
  const listed = status.overall === 'attention' ? status.problems.slice(1) : status.problems;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <div className="mg-dashboard">
        <header className="mg-page-heading">
          <div>
            <div className="mg-eyebrow">
              <span /> AUTOMAÇÃO <span className="mg-eyebrow-divider">/</span> NEXTROTTA
            </div>
            <h1>
              Porto<span>.</span>
            </h1>
            <p>Horas e escala do Portal do Prestador, todo dia.</p>
          </div>
          <div className="mg-header-actions po-header-actions">
            <PortoRunWizard openSignal={wizardSignal} />
          </div>
        </header>

        {error ? (
          <div className="mg-error" role="alert">
            <CircleHelp size={23} />
            <div>
              <strong>Não foi possível carregar</strong>
              <p>{error}</p>
            </div>
            <button className="mg-button" onClick={() => void api.load()}>
              Tentar novamente
            </button>
          </div>
        ) : null}

        {!loaded && !error ? (
          <div className="mg-loading" role="status">
            <LoaderCircle className="mg-spin" size={25} />
            <strong>Carregando o robô do Porto</strong>
          </div>
        ) : null}

        {loaded ? (
          <div className="po-stack" aria-busy={loading}>
            <Hero status={status} hasCredentials={hasCredentials} loginFailed={loginFailed} onAction={act} />
            <Problems problems={listed} onAction={act} />
            <Settings
              api={api}
              status={status}
              mode={mode}
              times={times}
              now={now}
              saving={savingMode}
              testing={testingLogin}
              onMode={(next) => (next === 'live' ? setDialog('live') : void changeMode(next))}
              onAccount={() => setDialog('account')}
              onTest={() => void testLogin()}
              onMatch={() => setDialog('match')}
            />
            {logs.length ? (
              <div id="atividade">
                <Activity status={status} logs={logs} running={busy} onOpen={api.openRun} />
              </div>
            ) : null}
            <Advanced busy={busy} onSimulate={(job, range) => void api.simulate(job, range)} />
          </div>
        ) : null}

        {toast ? (
          <div className={`po-toast${toast.bad ? ' bad' : ''}`} role="status">
            {toast.message}
          </div>
        ) : null}
      </div>

      {dialog === 'account' ? (
        <AccountDialog
          api={api}
          onClose={() => setDialog(null)}
          onSaved={(message) => notify(message)}
        />
      ) : null}
      {dialog === 'match' ? (
        <MatchDialog
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            notify(message);
            void api.load();
          }}
        />
      ) : null}
      {dialog === 'live' ? <LiveConfirm saving={savingMode} onCancel={() => setDialog(null)} onConfirm={() => void changeMode('live')} /> : null}
      {api.jobDialog ? <JobDialog job={api.jobDialog.job} result={api.jobDialog.result} running={busy} onClose={api.closeJobDialog} /> : null}
    </AppShell>
  );
}
