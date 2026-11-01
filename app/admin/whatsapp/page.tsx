'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, History, Loader2, MessageCircle, Power, Settings2, TriangleAlert } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { HelpDot } from '@/components/modal-kit';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAppSession } from '@/hooks/use-app-session';
import { createDefaultNotificationSettings, NOTIFICATION_TYPES, type NotificationType } from '@/lib/whatsapp/notification-types';
import { validatePhone } from '@/lib/whatsapp/phone';
import '../dashboard-gerencial/management-dashboard.css';
import './whatsapp.css';
import { ConnectionPanel } from './connection-panel';
import { EnableAutomationDialog } from './enable-automation-dialog';
import { HistoryPanel } from './history-panel';
import { NotificationsPanel } from './notifications-panel';
import type { TechnicianOption, WhatsAppConfigForm } from './types';

const emptyForm: WhatsAppConfigForm = {
  enabled: false,
  testPhone: '',
  appUrl: '',
  notifications: createDefaultNotificationSettings(),
};

type Tab = 'connection' | 'notifications' | 'history';

const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2 }> = [
  { id: 'connection', label: 'Conexão', icon: Settings2 },
  { id: 'notifications', label: 'Notificações', icon: MessageCircle },
  { id: 'history', label: 'Histórico', icon: History },
];

export default function AdminWhatsAppPage() {
  const { user, loading } = useAppSession();
  const [tab, setTab] = useState<Tab>('connection');
  const [form, setForm] = useState<WhatsAppConfigForm>(emptyForm);
  const [technicians, setTechnicians] = useState<TechnicianOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [askNotifications, setAskNotifications] = useState(false);
  // What the server already has. Compared after each save so edits made *while* saving aren't
  // marked as saved, and so nothing is sent when nothing actually changed.
  const savedPayload = useRef('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');

    try {
      const [configResponse, techniciansResponse] = await Promise.all([fetch('/api/whatsapp/config'), fetch('/api/technicians')]);
      const configData = await configResponse.json().catch(() => null);
      const techniciansData = await techniciansResponse.json().catch(() => null);

      if (!configResponse.ok) throw new Error(configData?.error || 'Não foi possível carregar a configuração.');

      setForm({
        enabled: Boolean(configData.enabled),
        testPhone: configData.testPhone ?? '',
        appUrl: configData.appUrl ?? '',
        notifications: configData.notifications ?? createDefaultNotificationSettings(),
      });
      setTechnicians(
        (Array.isArray(techniciansData?.technicians) ? techniciansData.technicians : []).map((technician: Record<string, unknown>) => ({
          id: String(technician.id),
          name: String(technician.name ?? ''),
          phone: technician.phone ? String(technician.phone) : '',
          status: technician.status === 'inactive' ? 'inactive' : 'active',
        })),
      );
      savedPayload.current = JSON.stringify({
        enabled: Boolean(configData.enabled),
        testPhone: configData.testPhone ?? '',
        appUrl: configData.appUrl ?? '',
        notifications: configData.notifications ?? createDefaultNotificationSettings(),
      });
      setDirty(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar a configuração.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [load, user]);

  const updateForm = useCallback((patch: Partial<WhatsAppConfigForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setDirty(true);
    setSaveError('');
  }, []);

  const payload = JSON.stringify({
    enabled: form.enabled,
    testPhone: form.testPhone,
    appUrl: form.appUrl,
    notifications: form.notifications,
  });

  // A half-typed test number would make every keystroke fail against the server, so autosave waits
  // until it's either empty or complete.
  const testPhoneReady = ['empty', 'valid'].includes(validatePhone(form.testPhone).status);

  const save = useCallback(async (body: string) => {
    setIsSaving(true);
    setSaveError('');

    try {
      const response = await fetch('/api/whatsapp/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error || 'Não foi possível salvar.');

      savedPayload.current = body;
      setSavedAt(Date.now());
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Não foi possível salvar.');
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Autosave: saves shortly after you stop changing things, so nothing has to be confirmed by hand.
  useEffect(() => {
    if (isLoading || isSaving || !dirty || !testPhoneReady) return;
    if (payload === savedPayload.current) {
      setDirty(false);
      return;
    }

    const timer = setTimeout(() => void save(payload), 800);
    return () => clearTimeout(timer);
  }, [dirty, isLoading, isSaving, payload, save, testPhoneReady]);

  // Clears the "Salvo" pill a few seconds after the last save.
  useEffect(() => {
    if (!savedAt) return;
    const timer = setTimeout(() => setSavedAt(null), 2500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  if (loading || !user) {
    return <LoadingShell role="admin" />;
  }

  const unsaved = dirty && payload !== savedPayload.current;

  // Fixed to the viewport, not to the top of the form: the notification cards are long, and the
  // state of the save has to stay visible wherever you are on the page.
  const saveStatus =
    saveError || isSaving || unsaved || savedAt ? (
      <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card px-4 py-2 text-sm shadow-[0_8px_30px_#25233726]">
        {saveError ? (
          <>
            <TriangleAlert className="h-4 w-4 text-rose-600" />
            <span className="text-rose-700">{saveError}</span>
            <Button type="button" size="sm" onClick={() => void save(payload)} disabled={isSaving}>
              Tentar de novo
            </Button>
          </>
        ) : isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Salvando...</span>
          </>
        ) : unsaved ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">{testPhoneReady ? 'Salvando alterações...' : 'Complete o número de teste para salvar'}</span>
          </>
        ) : (
          <>
            <Check className="h-4 w-4 text-emerald-600" />
            <span className="text-emerald-700">Salvo</span>
          </>
        )}
      </div>
    ) : null;

  return (
    <AppShell role="admin" userName={user.name || user.email}>
      <div className="mg-dashboard wa-page">
        <header className="mg-page-heading">
          <div>
            <div className="mg-eyebrow">
              <span /> INTEGRAÇÕES <span className="mg-eyebrow-divider">/</span> NEXTROTTA
            </div>
            <h1>
              WhatsApp<span>.</span>
            </h1>
          </div>
          <div className="mg-header-actions wa-header-actions">
            {form.testPhone ? <span className="wa-test-badge">Modo teste: envios desviados</span> : null}
            {/* The master switch: every automatic notification depends on it. */}
            <label className={`wa-master ${form.enabled ? 'on' : ''} ${isLoading ? 'busy' : ''}`}>
              <span className="wa-master-icon" aria-hidden="true">
                <Power size={18} />
              </span>
              <span className="wa-master-text">
                {form.enabled ? 'Automação ligada' : 'Automação desligada'}
                <HelpDot
                  label="Automação"
                  text="É a chave geral: com ela desligada, nenhuma notificação automática sai. Cada notificação ainda tem a sua própria chave na aba Notificações."
                />
              </span>
              <Switch
                checked={form.enabled}
                onCheckedChange={(enabled) => (enabled ? setAskNotifications(true) : updateForm({ enabled: false }))}
                disabled={isLoading}
                aria-label="Ligar ou desligar a automação do WhatsApp"
              />
            </label>
          </div>
        </header>

        <nav className="wa-tabs" aria-label="Seções do WhatsApp">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
              <Icon size={20} />
              {label}
            </button>
          ))}
        </nav>

        {loadError ? <div className="mg-error" role="alert"><div><strong>Não foi possível carregar</strong><p>{loadError}</p></div></div> : null}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : (
          <div className="wa-body">
            {tab === 'connection' ? <ConnectionPanel form={form} onChange={updateForm} technicians={technicians} unsaved={unsaved} /> : null}
            {tab === 'notifications' ? (
              <div className="space-y-5">
                <NotificationsPanel form={form} onChange={updateForm} unsaved={unsaved} />
              </div>
            ) : null}
            {tab === 'history' ? <HistoryPanel technicians={technicians} /> : null}
          </div>
        )}
      </div>

      <EnableAutomationDialog
        open={askNotifications}
        notifications={form.notifications}
        onCancel={() => setAskNotifications(false)}
        onConfirm={(types: NotificationType[]) => {
          const chosen = new Set(types);
          updateForm({
            enabled: true,
            notifications: Object.fromEntries(
              NOTIFICATION_TYPES.map((type) => [type, { ...form.notifications[type], enabled: chosen.has(type) }]),
            ) as typeof form.notifications,
          });
          setAskNotifications(false);
        }}
      />

      {saveStatus}
    </AppShell>
  );
}
