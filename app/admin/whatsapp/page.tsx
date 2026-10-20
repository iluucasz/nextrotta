'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, History, Loader2, MessageCircle, Power, Settings2, TriangleAlert } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { LoadingShell } from '@/components/page-skeleton';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAppSession } from '@/hooks/use-app-session';
import { createDefaultNotificationSettings, NOTIFICATION_TYPES, type NotificationType } from '@/lib/whatsapp/notification-types';
import { validatePhone } from '@/lib/whatsapp/phone';
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

export default function AdminWhatsAppPage() {
  const { user, loading } = useAppSession();
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
      <PageHeader
        eyebrow="Integrações"
        title="WhatsApp"
        description="WhatsApp da empresa, notificações automáticas para os técnicos e histórico de envios."
      >
        {form.testPhone ? <StatusBadge tone="warning">Modo teste: envios desviados</StatusBadge> : null}
        {/* The master switch: every automatic notification depends on it. */}
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors ${
            form.enabled ? 'border-emerald-300 bg-emerald-50' : 'border-border bg-card'
          } ${isLoading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <span
            className={`grid h-9 w-9 place-items-center rounded-lg ${form.enabled ? 'bg-emerald-600 text-white' : 'bg-secondary text-muted-foreground'}`}
            aria-hidden="true"
          >
            <Power className="h-4 w-4" />
          </span>
          <span className="text-sm leading-tight">
            <span className="block font-semibold">{form.enabled ? 'Automação ligada' : 'Automação desligada'}</span>
            <span className="block text-xs text-muted-foreground">
              {form.enabled ? 'Notificações automáticas ativas' : 'Nenhuma notificação automática sai'}
            </span>
          </span>
          <Switch
            checked={form.enabled}
            onCheckedChange={(enabled) => (enabled ? setAskNotifications(true) : updateForm({ enabled: false }))}
            disabled={isLoading}
            aria-label="Ligar ou desligar a automação do WhatsApp"
          />
        </label>
      </PageHeader>

      {loadError ? <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{loadError}</div> : null}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando...
        </div>
      ) : (
        <Tabs defaultValue="connection" className="gap-5">
          <TabsList>
            <TabsTrigger value="connection">
              <Settings2 className="h-4 w-4" />
              Conexão
            </TabsTrigger>
            <TabsTrigger value="notifications">
              <MessageCircle className="h-4 w-4" />
              Notificações
            </TabsTrigger>
            <TabsTrigger value="history">
              <History className="h-4 w-4" />
              Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connection" className="space-y-5">
            <ConnectionPanel form={form} onChange={updateForm} technicians={technicians} unsaved={unsaved} />
          </TabsContent>

          <TabsContent value="notifications" className="space-y-5">
            <NotificationsPanel form={form} onChange={updateForm} unsaved={unsaved} />
          </TabsContent>

          <TabsContent value="history">
            <HistoryPanel technicians={technicians} />
          </TabsContent>
        </Tabs>
      )}

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
