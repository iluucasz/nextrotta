'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { RESERVED_SUBDOMAINS } from '@/lib/tenant-host';
import { api, date, errorMessage, useResource } from './api';
import { useNotify } from './notice';
import { Badge, Confirm, ErrorState, Fields, Loading, Metric, Panel, Title, type FormValues } from './ui';

type PlatformSettings = {
  defaultGraceDays: number;
  readOnlyDays: number;
  reservedSubdomains: string[];
  maintenance: { enabled: boolean; message: string };
  ai: { inputCostPerMillion: number; outputCostPerMillion: number; creditsPerUse: number };
  porto: { maxBrowsers: number };
  alerts: { phone: string; instanceName: string };
  vps: { autoCleanup: boolean };
  updatedAt: string | null;
};

type AlertsWhatsApp = {
  serverConfigured: boolean;
  instanceName: string;
  created: boolean;
  state: 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown';
  number: string | null;
  phone: string;
  error: string | null;
};

type Integration = { name: string; state: 'ok' | 'error' | 'missing'; detail: string };

const STATE_LABELS = { ok: 'Conectado', error: 'Falha', missing: 'Não configurado' };

const TABS = ['Cobrança', 'Integrações', 'Alertas e robô', 'Subdomínios', 'Minha conta'] as const;

export function PlatformSettings() {
  const notify = useNotify();
  const data = useResource<{ settings: PlatformSettings; integrations: Integration[] }>('/settings');
  const [tab, setTab] = useState<(typeof TABS)[number]>('Cobrança');
  const [values, setValues] = useState<FormValues | null>(null);
  const [confirmBilling, setConfirmBilling] = useState(false);

  // The profile menu links straight to the account tab (?aba=conta).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('aba') === 'conta') setTab('Minha conta');
  }, []);

  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;

  const { settings, integrations } = data.data!;
  const gateway = integrations.find((item) => item.name === 'Gateway Asaas');

  async function save(body: Record<string, unknown>, message: string) {
    try {
      await api('/settings', { method: 'PUT', body });
      notify(message);
      setValues(null);
      data.reload();
    } catch (reason) {
      notify(errorMessage(reason));
    }
  }

  const billingValues = values ?? { defaultGraceDays: settings.defaultGraceDays, readOnlyDays: settings.readOnlyDays };
  const subdomainValues = values ?? { reservedSubdomains: settings.reservedSubdomains.join(', ') };

  return (
    <>
      <Title title="Configurações da plataforma" description="As regras e conexões que sustentam a sua operação." />
      <div className="nr-tabs" role="tablist">
        {TABS.map((name) => (
          <button key={name} role="tab" aria-selected={name === tab} onClick={() => { setTab(name); setValues(null); }}>{name}</button>
        ))}
      </div>

      {tab === 'Cobrança' && (
        <>
          <div className="nr-metrics">
            {integrations.filter((item) => item.name === 'Gateway Asaas' || item.name === 'Webhook de cobrança').map((item) => (
              <Metric key={item.name} label={item.name} value={STATE_LABELS[item.state]} detail={item.detail} />
            ))}
          </div>
          <Panel title="Cobrança" description="A carência padrão vale para as próximas assinaturas; as existentes mantêm a delas (editável na aba Assinatura de cada organização). O prazo de consulta vale para todas as empresas suspensas ou canceladas.">
            <form className="nr-pad" onSubmit={(event) => { event.preventDefault(); setConfirmBilling(true); }}>
              <Fields
                fields={[
                  { key: 'defaultGraceDays', label: 'Dias de carência padrão', type: 'number', required: true, hint: 'Dias de acesso normal depois do vencimento, antes do modo somente leitura.' },
                  { key: 'readOnlyDays', label: 'Dias de consulta após suspensão ou cancelamento', type: 'number', required: true, hint: 'Durante esse prazo a empresa vê tudo sem poder alterar. Depois, só consegue baixar os dados. Nada é apagado.' },
                ]}
                values={billingValues}
                setValues={setValues}
              />
              <p className="mt-4 text-xs text-muted-foreground">
                Ambiente do gateway: {gateway?.state === 'ok' ? gateway.detail : 'definido por ASAAS_ENVIRONMENT no servidor'}. Os lembretes de vencimento são enviados pelo próprio Asaas, conforme a configuração de notificações da sua conta lá.
              </p>
              <button className="nr-btn primary mt-6">Salvar alterações</button>
            </form>
          </Panel>
        </>
      )}

      {tab === 'Integrações' && (
        <Panel title="Integrações" description="Estado real de cada serviço externo, verificado agora. As chaves ficam nas variáveis de ambiente do servidor, nunca no banco.">
          <div className="nr-pad">
            {integrations.map((item) => (
              <div className="nr-detail-row" key={item.name}>
                <span>
                  {item.name}
                  <small>{item.detail}</small>
                </span>
                <Badge>{STATE_LABELS[item.state]}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === 'Subdomínios' && (
        <Panel title="Subdomínios reservados" description="Nenhuma organização nova pode usar estes endereços.">
          <form
            className="nr-pad"
            onSubmit={(event) => {
              event.preventDefault();
              void save({ reservedSubdomains: String(subdomainValues.reservedSubdomains) }, 'Subdomínios reservados salvos.');
            }}
          >
            <p className="mb-4 text-xs text-muted-foreground">Sempre reservados pelo sistema: {[...RESERVED_SUBDOMAINS].join(', ')}.</p>
            <Fields
              fields={[{ key: 'reservedSubdomains', label: 'Reservas adicionais (separadas por vírgula)', type: 'textarea' }]}
              values={subdomainValues}
              setValues={setValues}
            />
            <button className="nr-btn primary mt-6">Salvar alterações</button>
          </form>
        </Panel>
      )}

      {tab === 'Alertas e robô' && <AlertsRobotTab settings={settings} onSaved={data.reload} />}

      {tab === 'Minha conta' && <AccountTab />}

      {settings.updatedAt && <p className="text-xs text-muted-foreground">Última alteração das configurações: {date(settings.updatedAt, true)}</p>}

      {confirmBilling && (
        <Confirm
          title="Confirmar configurações de cobrança"
          description={`Carência padrão: ${billingValues.defaultGraceDays} dias (próximas assinaturas). Consulta após suspensão ou cancelamento: ${billingValues.readOnlyDays} dias (vale para todas as empresas).`}
          onClose={() => setConfirmBilling(false)}
          onConfirm={() => save({ defaultGraceDays: Number(billingValues.defaultGraceDays), readOnlyDays: Number(billingValues.readOnlyDays) }, 'Configurações de cobrança salvas.')}
        />
      )}
    </>
  );
}

function AccountTab() {
  const notify = useNotify();
  const account = useResource<{ account: { name: string; email: string; lastLoginAt: string | null } }>('/account');
  const [profile, setProfile] = useState<FormValues | null>(null);
  const [password, setPassword] = useState<FormValues>({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (account.loading && !account.data) return <Loading />;
  if (account.error) return <ErrorState message={account.error} onRetry={account.reload} />;

  const current = account.data!.account;
  const profileValues = profile ?? { name: current.name, email: current.email };

  return (
    <div className="nr-equal nr-grid-2">
      <Panel title="Minha conta" description={`Último acesso: ${date(current.lastLoginAt, true)}`}>
        <form
          className="nr-pad"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api('/account', { method: 'PATCH', body: profileValues });
              notify('Dados da conta salvos.');
              setProfile(null);
              account.reload();
            } catch (reason) {
              notify(errorMessage(reason));
            }
          }}
        >
          <Fields
            fields={[
              { key: 'name', label: 'Nome', required: true },
              { key: 'email', label: 'E-mail de acesso', type: 'email', required: true },
            ]}
            values={profileValues}
            setValues={setProfile}
          />
          <button className="nr-btn primary mt-6">Salvar alterações</button>
        </form>
      </Panel>
      <Panel title="Trocar senha" description="Pelo menos 10 caracteres.">
        <form
          className="nr-pad"
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            if (password.newPassword !== password.confirmPassword) {
              setError('A confirmação não confere com a nova senha.');
              return;
            }
            setSaving(true);
            try {
              await api('/account', { method: 'PUT', body: { currentPassword: password.currentPassword, newPassword: password.newPassword } });
              setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' });
              notify('Senha alterada.');
            } catch (reason) {
              setError(errorMessage(reason));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Fields
            fields={[
              { key: 'currentPassword', label: 'Senha atual', type: 'password', required: true },
              { key: 'newPassword', label: 'Nova senha', type: 'password', required: true },
              { key: 'confirmPassword', label: 'Confirmar nova senha', type: 'password', required: true },
            ]}
            values={password}
            setValues={setPassword}
          />
          {error && <p className="nr-error" role="alert">{error}</p>}
          <button className="nr-btn primary mt-6" disabled={saving}>{saving ? 'Salvando…' : 'Trocar senha'}</button>
        </form>
      </Panel>
    </div>
  );
}

const WHATSAPP_STATE_LABELS: Record<AlertsWhatsApp['state'], string> = {
  not_created: 'Não conectado',
  connected: 'Conectado',
  connecting: 'Aguardando leitura',
  disconnected: 'Desconectado',
  unknown: 'Sem resposta',
};

function formatPhone(digits: string | null) {
  if (!digits) return '—';
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  return local.length === 11 ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}` : `+${digits}`;
}

/** The owner's own alerts (WhatsApp of the platform), the Porto browsers limit and the VPS cleanup. */
function AlertsRobotTab({ settings, onSaved }: { settings: PlatformSettings; onSaved: () => void }) {
  const notify = useNotify();
  const whatsapp = useResource<AlertsWhatsApp>('/alerts-whatsapp');
  const [phone, setPhone] = useState<FormValues>({ phone: settings.alerts.phone });
  const [robot, setRobot] = useState<FormValues>({ maxBrowsers: settings.porto.maxBrowsers, autoCleanup: settings.vps.autoCleanup });
  const [qr, setQr] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const reloadWhatsapp = whatsapp.reload;

  // While the QR code is open: check every 4 s whether it was read.
  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(async () => {
      try {
        const status = await api<AlertsWhatsApp>('/alerts-whatsapp');
        if (status.state === 'connected') {
          setQr(null);
          notify('WhatsApp de alertas conectado.');
          reloadWhatsapp();
        }
      } catch {
        // The next check tries again.
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [qr, notify, reloadWhatsapp]);

  async function connect() {
    setConnecting(true);
    try {
      const result = await api<{ status: AlertsWhatsApp; qr: { base64: string | null } | null }>('/alerts-whatsapp', { method: 'POST' });
      if (result.status.state === 'connected' || !result.qr?.base64) {
        notify(result.status.state === 'connected' ? 'O WhatsApp de alertas já está conectado.' : 'O servidor não devolveu o QR Code. Tente de novo.');
        reloadWhatsapp();
      } else {
        setQr(result.qr.base64);
      }
    } catch (reason) {
      notify(errorMessage(reason));
    } finally {
      setConnecting(false);
    }
  }

  async function save(body: Record<string, unknown>, message: string) {
    try {
      await api('/settings', { method: 'PUT', body });
      notify(message);
      onSaved();
      reloadWhatsapp();
    } catch (reason) {
      notify(errorMessage(reason));
    }
  }

  const status = whatsapp.data;

  return (
    <>
      <Panel
        title="WhatsApp de alertas da plataforma"
        description="Recebe os alertas que são seus: o Portal do Porto mudou de tela, execução travada, fila noturna atrasada, disco ou memória da VPS. Sai por uma instância só da plataforma (nextrotta-alertas), nunca pela de um cliente."
        action={
          status && status.serverConfigured ? (
            <div className="nr-actions">
              {status.state === 'connected' ? (
                <button className="nr-btn" onClick={() => setConfirmDisconnect(true)}>Trocar número</button>
              ) : (
                <button className="nr-btn primary" disabled={connecting} onClick={() => void connect()}>{connecting ? 'Gerando…' : 'Conectar WhatsApp'}</button>
              )}
            </div>
          ) : null
        }
      >
        <div className="nr-pad">
          {whatsapp.loading && !status ? (
            <Loading />
          ) : whatsapp.error ? (
            <ErrorState message={whatsapp.error} onRetry={reloadWhatsapp} />
          ) : (
            <>
              <div className="nr-detail-row">
                <span>
                  Conexão
                  <small>{status!.serverConfigured ? `Instância ${status!.instanceName}${status!.error ? ` · ${status!.error}` : ''}` : 'Servidor do WhatsApp (EVOLUTION_API_URL/KEY) não configurado.'}</small>
                </span>
                <Badge>{WHATSAPP_STATE_LABELS[status!.state]}</Badge>
              </div>
              <div className="nr-detail-row">
                <span>
                  Número que envia
                  <small>O celular que leu o QR Code.</small>
                </span>
                <span>{formatPhone(status!.number)}</span>
              </div>
              <form
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({ alerts: { phone: phone.phone } }, 'Número de alertas salvo.');
                }}
              >
                <Fields
                  fields={[{ key: 'phone', label: 'WhatsApp que recebe os alertas', hint: 'Com DDD. Vazio = alertas só aparecem em Operação → Alertas.' }]}
                  values={phone}
                  setValues={setPhone}
                />
                <button className="nr-btn primary mt-6">Salvar número</button>
              </form>
            </>
          )}
        </div>
      </Panel>
      <Panel title="Robô do Porto e VPS" description="Valem para todas as organizações. A VPS é compartilhada com o sistema original do cliente.">
        <form
          className="nr-pad"
          onSubmit={(event) => {
            event.preventDefault();
            void save({ porto: { maxBrowsers: Number(robot.maxBrowsers) }, vps: { autoCleanup: Boolean(robot.autoCleanup) } }, 'Configurações do robô e da VPS salvas.');
          }}
        >
          <Fields
            fields={[
              { key: 'maxBrowsers', label: 'Navegadores do Porto ao mesmo tempo', type: 'number', min: 1, required: true, hint: 'De 1 a 4. Mais navegadores aceleram a fila noturna, mas arriscam a memória da VPS (sem swap) e bloqueio do IP pelo Porto. Recomendado: 2.' },
              { key: 'autoCleanup', label: 'Limpeza automática da VPS (04:30)', type: 'checkbox', hint: 'Ligue depois de comparar a prévia em Operação → Limpeza.' },
            ]}
            values={robot}
            setValues={setRobot}
          />
          <button className="nr-btn primary mt-6">Salvar alterações</button>
        </form>
      </Panel>
      {qr && (
        <Dialog open onOpenChange={(open) => !open && setQr(null)}>
          <DialogContent className="nr-dialog sm:max-w-lg">
            <DialogTitle>Conectar o WhatsApp de alertas</DialogTitle>
            <DialogDescription>No celular: WhatsApp → Dispositivos conectados → Conectar dispositivo, e aponte para o código. Esta janela fecha sozinha quando conectar.</DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR Code para conectar o WhatsApp de alertas" className="mx-auto h-64 w-64 rounded-lg border bg-white p-2" />
            <div className="nr-dialog-actions">
              <button className="nr-btn" onClick={() => setQr(null)}>Fechar</button>
              <button className="nr-btn primary" disabled={connecting} onClick={() => void connect()}>Gerar novo código</button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {confirmDisconnect && (
        <Confirm
          title="Trocar o número de alertas"
          description="O número atual é desconectado da instância da plataforma. Até outro número ler o QR Code, os alertas só aparecem em Operação → Alertas."
          onClose={() => setConfirmDisconnect(false)}
          onConfirm={async () => {
            await api('/alerts-whatsapp', { method: 'DELETE' });
            notify('Número desconectado.');
            reloadWhatsapp();
          }}
        />
      )}
    </>
  );
}
